import { json as kitJson } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';
import { sendPushToUser } from '$lib/server/pushNotifications';

const REPORT_REASONS = new Set(['spam', 'harassment', 'inappropriate', 'privacy', 'other']);
const REACTION_EMOJIS = new Set(['👍', '❤️', '😂']);
const MESSAGE_COLUMNS = 'id, conversation_id, sender_id, body, reply_to_id, edited_at, deleted_at, attachment_key, attachment_name, attachment_type, attachment_size, delivered_at, read_at, created_at';
const PAGE_SIZE = 50;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = new Map([
    ['image/jpeg', ['jpg', 'jpeg']],
    ['image/png', ['png']],
    ['image/webp', ['webp']],
    ['image/gif', ['gif']],
    ['application/pdf', ['pdf']],
    ['text/plain', ['txt']],
    ['application/msword', ['doc']],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ['docx']],
    ['application/vnd.ms-excel', ['xls']],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ['xlsx']],
    ['application/vnd.ms-powerpoint', ['ppt']],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', ['pptx']]
]);

function json(body, init = {}) {
    return kitJson(body, {
        ...init,
        headers: { 'Cache-Control': 'private, no-store', ...(init.headers || {}) }
    });
}

function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function cleanText(value, max = 2000) {
    return String(value || '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function nameOfActor(user) {
    return user?.full_name || user?.name_latin || 'CCN-CPD member';
}

async function bodyOf(request) {
    try {
        if ((request.headers.get('content-type') || '').includes('multipart/form-data')) {
            const form = await request.formData();
            return {
                action: form.get('action'),
                conversation_id: form.get('conversation_id'),
                body: form.get('body'),
                reply_to_id: form.get('reply_to_id'),
                file: form.get('file')
            };
        }
        return await request.json();
    } catch {
        return null;
    }
}

async function actor(event, supabase) {
    const id = await getRequestUserId(event);
    if (!validUuid(id)) return null;
    const { data, error } = await supabase
        .from('users')
        .select('id, full_name, name_latin, avatar_url, role')
        .eq('id', id)
        .maybeSingle();
    return error ? null : data;
}

function databaseError(error) {
    console.error('private-chat database error:', error);
    return json({ error: 'Unable to process private chat', code: error?.code }, { status: 500 });
}

async function accessibleConversation(supabase, conversationId, userId) {
    if (!validUuid(conversationId)) return { data: null, error: null };
    return supabase
        .from('private_conversations')
        .select('id, participant_one, participant_two, realtime_topic, last_message_at, created_at')
        .eq('id', conversationId)
        .or(`participant_one.eq.${userId},participant_two.eq.${userId}`)
        .maybeSingle();
}

function otherParticipant(conversation, userId) {
    return conversation.participant_one === userId ? conversation.participant_two : conversation.participant_one;
}

async function blockState(supabase, userId, otherUserId) {
    const { data, error } = await supabase
        .from('private_chat_blocks')
        .select('blocker_id, blocked_id')
        .or(`and(blocker_id.eq.${userId},blocked_id.eq.${otherUserId}),and(blocker_id.eq.${otherUserId},blocked_id.eq.${userId})`);
    if (error) return { error };
    return {
        blocked_by_me: (data || []).some(item => item.blocker_id === userId),
        blocked_by_member: (data || []).some(item => item.blocker_id === otherUserId)
    };
}

async function broadcastChat(supabase, realtimeTopic, event, payload = {}) {
    const channel = supabase.channel(`private-chat:${realtimeTopic}`, { config: { private: false } });
    try {
        await channel.httpSend(event, payload);
    } catch (error) {
        console.warn('Unable to broadcast private chat update:', error?.message || error);
    } finally {
        await supabase.removeChannel(channel).catch(() => {});
    }
}

async function touchPresence(supabase, userId) {
    const { error } = await supabase.from('private_chat_presence').upsert({
        user_id: userId,
        last_seen_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) console.warn('Unable to update chat presence:', error.message);
}

async function hydrateMessages(supabase, rows, currentUserId) {
    if (!rows?.length) return [];
    const ids = rows.map(row => row.id);
    const replyIds = [...new Set(rows.map(row => row.reply_to_id).filter(validUuid))];
    const [reactionsResult, repliesResult] = await Promise.all([
        supabase.from('private_message_reactions').select('message_id, user_id, emoji').in('message_id', ids),
        replyIds.length
            ? supabase.from('private_messages').select('id, sender_id, body, deleted_at, attachment_name').in('id', replyIds)
            : Promise.resolve({ data: [], error: null })
    ]);
    if (reactionsResult.error) throw reactionsResult.error;
    if (repliesResult.error) throw repliesResult.error;

    const replyMap = new Map((repliesResult.data || []).map(reply => [reply.id, {
        id: reply.id,
        sender_id: reply.sender_id,
        body: reply.deleted_at ? '' : reply.body,
        attachment_name: reply.deleted_at ? null : reply.attachment_name,
        deleted: Boolean(reply.deleted_at)
    }]));
    const reactionMap = new Map();
    for (const reaction of reactionsResult.data || []) {
        if (!reactionMap.has(reaction.message_id)) reactionMap.set(reaction.message_id, new Map());
        const bucket = reactionMap.get(reaction.message_id);
        const value = bucket.get(reaction.emoji) || { emoji: reaction.emoji, count: 0, reacted_by_me: false };
        value.count += 1;
        if (reaction.user_id === currentUserId) value.reacted_by_me = true;
        bucket.set(reaction.emoji, value);
    }

    return rows.map(row => {
        const { attachment_key, ...message } = row;
        const deleted = Boolean(row.deleted_at);
        return {
            ...message,
            body: deleted ? '' : row.body,
            attachment_name: deleted ? null : row.attachment_name,
            attachment_type: deleted ? null : row.attachment_type,
            attachment_size: deleted ? null : row.attachment_size,
            attachment_url: !deleted && attachment_key ? `/api/private-chat/attachment?message_id=${row.id}` : null,
            reply_to: row.reply_to_id ? replyMap.get(row.reply_to_id) || null : null,
            reactions: [...(reactionMap.get(row.id)?.values() || [])]
        };
    });
}

async function conversationSettings(supabase, conversationId, userId) {
    const { data, error } = await supabase
        .from('private_conversation_settings')
        .select('muted, archived_at')
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)
        .maybeSingle();
    return { data: data || { muted: false, archived_at: null }, error };
}

export async function GET(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return json({ error: 'Chat service is unavailable' }, { status: 503 });
        const current = await actor(event, supabase);
        if (!current) return json({ error: 'Unauthorized' }, { status: 401 });
        await touchPresence(supabase, current.id);

        const search = cleanText(event.url.searchParams.get('search'), 60);
        if (search) {
            if (search.length < 2) return json({ members: [] });
            const safeSearch = search.replace(/[,%()"'\\]/g, ' ').replace(/\s+/g, ' ').trim();
            const [membersResult, blocksResult] = await Promise.all([
                supabase.from('users').select('id, full_name, name_latin, avatar_url, role').neq('id', current.id)
                    .or(`full_name.ilike.%${safeSearch}%,name_latin.ilike.%${safeSearch}%`).limit(50),
                supabase.from('private_chat_blocks').select('blocker_id, blocked_id')
                    .or(`blocker_id.eq.${current.id},blocked_id.eq.${current.id}`)
            ]);
            if (membersResult.error || blocksResult.error) return databaseError(membersResult.error || blocksResult.error);
            const blockedIds = new Set((blocksResult.data || []).map(item => item.blocker_id === current.id ? item.blocked_id : item.blocker_id));
            return json({ members: (membersResult.data || []).filter(member => !blockedIds.has(member.id)).slice(0, 20) });
        }

        const conversationId = event.url.searchParams.get('conversation_id');
        if (conversationId) {
            const { data: conversation, error } = await accessibleConversation(supabase, conversationId, current.id);
            if (error) return databaseError(error);
            if (!conversation) return json({ error: 'Conversation not found' }, { status: 404 });

            const otherId = otherParticipant(conversation, current.id);
            const deliveredAt = new Date().toISOString();
            const { data: delivered, error: deliveryError } = await supabase.from('private_messages')
                .update({ delivered_at: deliveredAt }).eq('conversation_id', conversation.id)
                .neq('sender_id', current.id).is('delivered_at', null).select('id');
            if (deliveryError) return databaseError(deliveryError);

            const requestedLimit = Number(event.url.searchParams.get('limit') || PAGE_SIZE);
            const limit = Math.min(100, Math.max(20, Number.isFinite(requestedLimit) ? requestedLimit : PAGE_SIZE));
            const before = event.url.searchParams.get('before');
            let messageQuery = supabase.from('private_messages').select(MESSAGE_COLUMNS)
                .eq('conversation_id', conversation.id).order('created_at', { ascending: false }).limit(limit + 1);
            if (before && !Number.isNaN(Date.parse(before))) messageQuery = messageQuery.lt('created_at', before);

            const [messagesResult, memberResult, state, settingsResult, presenceResult] = await Promise.all([
                messageQuery,
                supabase.from('users').select('id, full_name, name_latin, avatar_url, role').eq('id', otherId).maybeSingle(),
                blockState(supabase, current.id, otherId),
                conversationSettings(supabase, conversation.id, current.id),
                supabase.from('private_chat_presence').select('last_seen_at').eq('user_id', otherId).maybeSingle()
            ]);
            if (messagesResult.error || memberResult.error || state.error || settingsResult.error || presenceResult.error) {
                return databaseError(messagesResult.error || memberResult.error || state.error || settingsResult.error || presenceResult.error);
            }
            const hasMore = (messagesResult.data || []).length > limit;
            const pageRows = (messagesResult.data || []).slice(0, limit).reverse();
            const messages = await hydrateMessages(supabase, pageRows, current.id);
            if (delivered?.length) await broadcastChat(supabase, conversation.realtime_topic, 'receipt', { type: 'delivered' });
            return json({
                conversation,
                member: { ...memberResult.data, last_seen_at: presenceResult.data?.last_seen_at || null },
                block_state: state,
                settings: settingsResult.data,
                messages,
                has_more: hasMore,
                next_cursor: hasMore ? pageRows[0]?.created_at : null
            });
        }

        const { data: conversations, error } = await supabase.from('private_conversations')
            .select('id, participant_one, participant_two, realtime_topic, last_message_at, created_at')
            .or(`participant_one.eq.${current.id},participant_two.eq.${current.id}`)
            .order('last_message_at', { ascending: false }).limit(100);
        if (error) return databaseError(error);
        const ids = (conversations || []).map(row => row.id);

        if (event.url.searchParams.get('count_only') === '1') {
            if (!ids.length) return json({ unread_count: 0 });
            const { count, error: countError } = await supabase.from('private_messages').select('id', { count: 'exact', head: true })
                .in('conversation_id', ids).neq('sender_id', current.id).is('read_at', null);
            if (countError) return databaseError(countError);
            return json({ unread_count: count || 0 });
        }

        if (ids.length) {
            const { data: deliveredMessages, error: deliveryError } = await supabase.from('private_messages')
                .update({ delivered_at: new Date().toISOString() }).in('conversation_id', ids)
                .neq('sender_id', current.id).is('delivered_at', null).select('conversation_id');
            if (deliveryError) return databaseError(deliveryError);
            const changed = new Set((deliveredMessages || []).map(item => item.conversation_id));
            await Promise.all((conversations || []).filter(item => changed.has(item.id))
                .map(item => broadcastChat(supabase, item.realtime_topic, 'receipt', { type: 'delivered' })));
        }

        const otherIds = [...new Set((conversations || []).map(item => otherParticipant(item, current.id)))];
        const [membersResult, messagesResult, blocksResult, settingsResult, presenceResult] = await Promise.all([
            otherIds.length ? supabase.from('users').select('id, full_name, name_latin, avatar_url, role').in('id', otherIds) : Promise.resolve({ data: [], error: null }),
            ids.length ? supabase.from('private_messages').select(MESSAGE_COLUMNS).in('conversation_id', ids).order('created_at', { ascending: false }).limit(1500) : Promise.resolve({ data: [], error: null }),
            supabase.from('private_chat_blocks').select('blocker_id, blocked_id').or(`blocker_id.eq.${current.id},blocked_id.eq.${current.id}`),
            ids.length ? supabase.from('private_conversation_settings').select('conversation_id, muted, archived_at').eq('user_id', current.id).in('conversation_id', ids) : Promise.resolve({ data: [], error: null }),
            otherIds.length ? supabase.from('private_chat_presence').select('user_id, last_seen_at').in('user_id', otherIds) : Promise.resolve({ data: [], error: null })
        ]);
        const firstError = [membersResult, messagesResult, blocksResult, settingsResult, presenceResult].find(result => result.error)?.error;
        if (firstError) return databaseError(firstError);

        const members = new Map((membersResult.data || []).map(member => [member.id, member]));
        const settings = new Map((settingsResult.data || []).map(item => [item.conversation_id, item]));
        const presence = new Map((presenceResult.data || []).map(item => [item.user_id, item.last_seen_at]));
        const lastMessages = new Map();
        const unread = new Map();
        for (const message of messagesResult.data || []) {
            if (!lastMessages.has(message.conversation_id)) lastMessages.set(message.conversation_id, message);
            if (message.sender_id !== current.id && !message.read_at) unread.set(message.conversation_id, (unread.get(message.conversation_id) || 0) + 1);
        }
        const showArchived = event.url.searchParams.get('archived') === '1';
        const blocks = blocksResult.data || [];
        const mapped = (conversations || []).map(item => {
            const otherId = otherParticipant(item, current.id);
            const member = members.get(otherId) || null;
            const setting = settings.get(item.id) || { muted: false, archived_at: null };
            const last = lastMessages.get(item.id) || null;
            return {
                ...item,
                member: member ? { ...member, last_seen_at: presence.get(otherId) || null } : null,
                last_message: last ? {
                    ...last,
                    body: last.deleted_at ? 'សារត្រូវបានលុប' : (last.body || (last.attachment_name ? `📎 ${last.attachment_name}` : '')),
                    attachment_key: undefined
                } : null,
                unread_count: unread.get(item.id) || 0,
                settings: setting,
                block_state: {
                    blocked_by_me: blocks.some(block => block.blocker_id === current.id && block.blocked_id === otherId),
                    blocked_by_member: blocks.some(block => block.blocker_id === otherId && block.blocked_id === current.id)
                }
            };
        }).filter(item => showArchived ? Boolean(item.settings.archived_at) : !item.settings.archived_at);

        return json({
            conversations: mapped,
            unread_count: [...unread.values()].reduce((total, count) => total + count, 0),
            archived_count: (settingsResult.data || []).filter(item => item.archived_at).length
        });
    } catch (error) {
        console.error('private-chat API error:', error);
        return json({ error: 'Private chat service error' }, { status: 500 });
    }
}

export async function POST(event) {
    let uploadedKey = null;
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return json({ error: 'Chat service is unavailable' }, { status: 503 });
        const current = await actor(event, supabase);
        if (!current) return json({ error: 'Unauthorized' }, { status: 401 });
        await touchPresence(supabase, current.id);
        const body = await bodyOf(event.request);
        if (!body) return json({ error: 'Invalid request body' }, { status: 400 });

        if (body.action === 'start') {
            if (!validUuid(body.user_id) || body.user_id === current.id) return json({ error: 'Invalid member' }, { status: 400 });
            const { data: member, error: memberError } = await supabase.from('users')
                .select('id, full_name, name_latin, avatar_url, role').eq('id', body.user_id).maybeSingle();
            if (memberError) return databaseError(memberError);
            if (!member) return json({ error: 'Member not found' }, { status: 404 });
            const state = await blockState(supabase, current.id, member.id);
            if (state.error) return databaseError(state.error);
            if (state.blocked_by_me || state.blocked_by_member) return json({ error: 'Private chat is blocked between these members' }, { status: 403 });
            const [participantOne, participantTwo] = [current.id, member.id].sort();
            const { data: conversation, error } = await supabase.from('private_conversations')
                .upsert({ participant_one: participantOne, participant_two: participantTwo }, { onConflict: 'participant_one,participant_two', ignoreDuplicates: false })
                .select('id, participant_one, participant_two, realtime_topic, last_message_at, created_at').single();
            if (error) return databaseError(error);
            return json({ conversation, member, block_state: state, settings: { muted: false, archived_at: null } });
        }

        if (!validUuid(body.conversation_id)) return json({ error: 'Invalid conversation' }, { status: 400 });
        const { data: conversation, error } = await accessibleConversation(supabase, body.conversation_id, current.id);
        if (error) return databaseError(error);
        if (!conversation) return json({ error: 'Conversation not found' }, { status: 404 });
        const otherId = otherParticipant(conversation, current.id);

        if (body.action === 'block' || body.action === 'unblock') {
            const query = body.action === 'block'
                ? supabase.from('private_chat_blocks').upsert({ blocker_id: current.id, blocked_id: otherId }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true })
                : supabase.from('private_chat_blocks').delete().eq('blocker_id', current.id).eq('blocked_id', otherId);
            const { error: blockError } = await query;
            if (blockError) return databaseError(blockError);
            await broadcastChat(supabase, conversation.realtime_topic, 'block', { actor_id: current.id });
            const state = await blockState(supabase, current.id, otherId);
            if (state.error) return databaseError(state.error);
            return json({ success: true, block_state: state });
        }

        if (body.action === 'set_mute' || body.action === 'set_archive') {
            const currentSettings = await conversationSettings(supabase, conversation.id, current.id);
            if (currentSettings.error) return databaseError(currentSettings.error);
            const values = {
                conversation_id: conversation.id,
                user_id: current.id,
                muted: body.action === 'set_mute' ? Boolean(body.enabled) : Boolean(currentSettings.data.muted),
                archived_at: body.action === 'set_archive'
                    ? (body.enabled ? new Date().toISOString() : null)
                    : currentSettings.data.archived_at,
                updated_at: new Date().toISOString()
            };
            const { data: setting, error: settingError } = await supabase.from('private_conversation_settings')
                .upsert(values, { onConflict: 'conversation_id,user_id' }).select('muted, archived_at').single();
            if (settingError) return databaseError(settingError);
            return json({ success: true, settings: setting });
        }

        if (body.action === 'report') {
            const reason = String(body.reason || '');
            const details = cleanText(body.details, 1000) || null;
            if (!REPORT_REASONS.has(reason)) return json({ error: 'Invalid report reason' }, { status: 400 });
            if (body.message_id && !validUuid(body.message_id)) return json({ error: 'Invalid message' }, { status: 400 });
            if (body.message_id) {
                const { data: reportedMessage, error: messageError } = await supabase.from('private_messages')
                    .select('id').eq('id', body.message_id).eq('conversation_id', conversation.id).maybeSingle();
                if (messageError) return databaseError(messageError);
                if (!reportedMessage) return json({ error: 'Message not found' }, { status: 404 });
            }
            const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
            const { count, error: countError } = await supabase.from('private_chat_reports').select('id', { count: 'exact', head: true })
                .eq('reporter_id', current.id).gte('created_at', oneDayAgo);
            if (countError) return databaseError(countError);
            if ((count || 0) >= 10) return json({ error: 'Daily report limit reached' }, { status: 429 });
            const { data: report, error: reportError } = await supabase.from('private_chat_reports').insert({
                reporter_id: current.id, reported_user_id: otherId, conversation_id: conversation.id,
                message_id: body.message_id || null, reason, details
            }).select('id, status, created_at').single();
            if (reportError) return databaseError(reportError);
            return json({ success: true, report }, { status: 201 });
        }

        if (body.action === 'mark_read') {
            const now = new Date().toISOString();
            const { data: readMessages, error: readError } = await supabase.from('private_messages')
                .update({ read_at: now, delivered_at: now }).eq('conversation_id', conversation.id)
                .neq('sender_id', current.id).is('read_at', null).select('id');
            if (readError) return databaseError(readError);
            if (readMessages?.length) await broadcastChat(supabase, conversation.realtime_topic, 'receipt', { type: 'read' });
            return json({ success: true });
        }

        if (body.action === 'edit' || body.action === 'delete') {
            if (!validUuid(body.message_id)) return json({ error: 'Invalid message' }, { status: 400 });
            const { data: existing, error: existingError } = await supabase.from('private_messages').select(MESSAGE_COLUMNS)
                .eq('id', body.message_id).eq('conversation_id', conversation.id).eq('sender_id', current.id).maybeSingle();
            if (existingError) return databaseError(existingError);
            if (!existing) return json({ error: 'Message not found' }, { status: 404 });
            if (existing.deleted_at) return json({ error: 'Message was already deleted' }, { status: 409 });
            if (body.action === 'edit') {
                const updatedBody = cleanText(body.body);
                if (!updatedBody && !existing.attachment_key) return json({ error: 'Message cannot be empty' }, { status: 400 });
                const { data: updated, error: updateError } = await supabase.from('private_messages')
                    .update({ body: updatedBody, edited_at: new Date().toISOString() }).eq('id', existing.id).select(MESSAGE_COLUMNS).single();
                if (updateError) return databaseError(updateError);
                await broadcastChat(supabase, conversation.realtime_topic, 'message_update', { message_id: existing.id, type: 'edit' });
                return json({ message: (await hydrateMessages(supabase, [updated], current.id))[0] });
            }
            const { data: deleted, error: deleteError } = await supabase.from('private_messages').update({
                body: '', deleted_at: new Date().toISOString(), attachment_key: null,
                attachment_name: null, attachment_type: null, attachment_size: null
            }).eq('id', existing.id).select(MESSAGE_COLUMNS).single();
            if (deleteError) return databaseError(deleteError);
            if (existing.attachment_key && event.platform?.env?.BUCKET) await event.platform.env.BUCKET.delete(existing.attachment_key).catch(() => {});
            await broadcastChat(supabase, conversation.realtime_topic, 'message_update', { message_id: existing.id, type: 'delete' });
            return json({ message: (await hydrateMessages(supabase, [deleted], current.id))[0] });
        }

        if (body.action === 'react') {
            if (!validUuid(body.message_id) || !REACTION_EMOJIS.has(body.emoji)) return json({ error: 'Invalid reaction' }, { status: 400 });
            const { data: target, error: targetError } = await supabase.from('private_messages').select('id, deleted_at')
                .eq('id', body.message_id).eq('conversation_id', conversation.id).maybeSingle();
            if (targetError) return databaseError(targetError);
            if (!target || target.deleted_at) return json({ error: 'Message not found' }, { status: 404 });
            const { data: existingReaction, error: reactionReadError } = await supabase.from('private_message_reactions')
                .select('emoji').eq('message_id', target.id).eq('user_id', current.id).maybeSingle();
            if (reactionReadError) return databaseError(reactionReadError);
            const reactionQuery = existingReaction?.emoji === body.emoji
                ? supabase.from('private_message_reactions').delete().eq('message_id', target.id).eq('user_id', current.id)
                : supabase.from('private_message_reactions').upsert({ message_id: target.id, user_id: current.id, emoji: body.emoji }, { onConflict: 'message_id,user_id' });
            const { error: reactionError } = await reactionQuery;
            if (reactionError) return databaseError(reactionError);
            await broadcastChat(supabase, conversation.realtime_topic, 'message_update', { message_id: target.id, type: 'reaction' });
            return json({ success: true });
        }

        if (body.action !== 'send') return json({ error: 'Invalid action' }, { status: 400 });
        const state = await blockState(supabase, current.id, otherId);
        if (state.error) return databaseError(state.error);
        if (state.blocked_by_me || state.blocked_by_member) return json({ error: 'Private chat is blocked between these members' }, { status: 403 });

        const messageBody = cleanText(body.body);
        const file = body.file && typeof body.file === 'object' && typeof body.file.arrayBuffer === 'function' ? body.file : null;
        if (!messageBody && !file) return json({ error: 'Message or attachment is required' }, { status: 400 });
        let replyToId = null;
        if (body.reply_to_id) {
            if (!validUuid(body.reply_to_id)) return json({ error: 'Invalid reply target' }, { status: 400 });
            const { data: replyTarget, error: replyError } = await supabase.from('private_messages').select('id')
                .eq('id', body.reply_to_id).eq('conversation_id', conversation.id).maybeSingle();
            if (replyError) return databaseError(replyError);
            if (!replyTarget) return json({ error: 'Reply target not found' }, { status: 404 });
            replyToId = replyTarget.id;
        }

        const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
        const { count, error: rateError } = await supabase.from('private_messages').select('id', { count: 'exact', head: true })
            .eq('sender_id', current.id).gte('created_at', oneMinuteAgo);
        if (rateError) return databaseError(rateError);
        if ((count || 0) >= 30) return json({ error: 'Please wait before sending more messages' }, { status: 429 });

        let attachment = {};
        if (file) {
            if (!event.platform?.env?.BUCKET) return json({ error: 'Attachment storage is unavailable' }, { status: 503 });
            if (file.size < 1 || file.size > MAX_ATTACHMENT_SIZE) return json({ error: 'Attachment must be 10MB or smaller' }, { status: 400 });
            const extension = String(file.name || '').split('.').pop()?.toLowerCase() || '';
            const allowedExtensions = ATTACHMENT_TYPES.get(file.type);
            if (!allowedExtensions?.includes(extension)) return json({ error: 'Attachment type is not allowed' }, { status: 400 });
            const safeName = String(file.name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || `attachment.${extension}`;
            uploadedKey = `private-chat/${conversation.id}/${current.id}/${crypto.randomUUID()}-${safeName}`;
            await event.platform.env.BUCKET.put(uploadedKey, file, { httpMetadata: { contentType: file.type } });
            attachment = { attachment_key: uploadedKey, attachment_name: safeName, attachment_type: file.type, attachment_size: file.size };
        }

        const { data: message, error: sendError } = await supabase.from('private_messages').insert({
            conversation_id: conversation.id, sender_id: current.id, body: messageBody,
            reply_to_id: replyToId, ...attachment
        }).select(MESSAGE_COLUMNS).single();
        if (sendError) {
            if (uploadedKey && event.platform?.env?.BUCKET) await event.platform.env.BUCKET.delete(uploadedKey).catch(() => {});
            return databaseError(sendError);
        }
        uploadedKey = null;

        const { data: recipientSetting } = await supabase.from('private_conversation_settings')
            .select('muted').eq('conversation_id', conversation.id).eq('user_id', otherId).maybeSingle();
        await supabase.from('private_conversation_settings').update({
            archived_at: null, updated_at: new Date().toISOString()
        }).eq('conversation_id', conversation.id).eq('user_id', otherId);
        const jobs = [broadcastChat(supabase, conversation.realtime_topic, 'message', { message_id: message.id, sender_id: current.id })];
        if (!recipientSetting?.muted) jobs.push(sendPushToUser({
            platform: event.platform, supabase, userId: otherId, title: nameOfActor(current),
            body: file ? `បានផ្ញើឯកសារ៖ ${attachment.attachment_name}` : 'អ្នកមានសារឯកជនថ្មីនៅ CCN-CPD',
            url: '/?openChat=1', tag: `chat-${conversation.id}`
        }));
        await Promise.allSettled(jobs);
        return json({ message: (await hydrateMessages(supabase, [message], current.id))[0] }, { status: 201 });
    } catch (error) {
        if (uploadedKey && event.platform?.env?.BUCKET) await event.platform.env.BUCKET.delete(uploadedKey).catch(() => {});
        console.error('private-chat API error:', error);
        return json({ error: 'Private chat service error' }, { status: 500 });
    }
}
