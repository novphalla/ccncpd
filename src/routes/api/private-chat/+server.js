import { json as kitJson } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';
import { sendPushToUser } from '$lib/server/pushNotifications';

const REPORT_REASONS = new Set(['spam', 'harassment', 'inappropriate', 'privacy', 'other']);

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
    try { return await request.json(); } catch { return null; }
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
    return json({ error: 'Unable to process private chat', code: error.code }, { status: 500 });
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

async function conversationIds(supabase, userId) {
    return supabase
        .from('private_conversations')
        .select('id')
        .or(`participant_one.eq.${userId},participant_two.eq.${userId}`);
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

export async function GET(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return json({ error: 'Chat service is unavailable' }, { status: 503 });
        const current = await actor(event, supabase);
        if (!current) return json({ error: 'Unauthorized' }, { status: 401 });

        const search = cleanText(event.url.searchParams.get('search'), 60);
        if (search) {
            if (search.length < 2) return json({ members: [] });
            const safeSearch = search.replace(/[,%()"'\\]/g, ' ').replace(/\s+/g, ' ').trim();
            const [membersResult, blocksResult] = await Promise.all([
                supabase
                    .from('users')
                    .select('id, full_name, name_latin, avatar_url, role')
                    .neq('id', current.id)
                    .or(`full_name.ilike.%${safeSearch}%,name_latin.ilike.%${safeSearch}%`)
                    .limit(50),
                supabase
                    .from('private_chat_blocks')
                    .select('blocker_id, blocked_id')
                    .or(`blocker_id.eq.${current.id},blocked_id.eq.${current.id}`)
            ]);
            if (membersResult.error || blocksResult.error) return databaseError(membersResult.error || blocksResult.error);
            const blockedIds = new Set((blocksResult.data || []).map(item =>
                item.blocker_id === current.id ? item.blocked_id : item.blocker_id
            ));
            return json({ members: (membersResult.data || []).filter(member => !blockedIds.has(member.id)).slice(0, 20) });
        }

        const conversationId = event.url.searchParams.get('conversation_id');
        if (conversationId) {
            const { data: conversation, error } = await accessibleConversation(supabase, conversationId, current.id);
            if (error) return databaseError(error);
            if (!conversation) return json({ error: 'Conversation not found' }, { status: 404 });

            const otherId = otherParticipant(conversation, current.id);
            const deliveredAt = new Date().toISOString();
            const { data: delivered, error: deliveryError } = await supabase
                .from('private_messages')
                .update({ delivered_at: deliveredAt })
                .eq('conversation_id', conversation.id)
                .neq('sender_id', current.id)
                .is('delivered_at', null)
                .select('id');
            if (deliveryError) return databaseError(deliveryError);

            const [messagesResult, memberResult, state] = await Promise.all([
                supabase
                    .from('private_messages')
                    .select('id, conversation_id, sender_id, body, delivered_at, read_at, created_at')
                    .eq('conversation_id', conversation.id)
                    .order('created_at', { ascending: false })
                    .limit(300),
                supabase
                    .from('users')
                    .select('id, full_name, name_latin, avatar_url, role')
                    .eq('id', otherId)
                    .maybeSingle(),
                blockState(supabase, current.id, otherId)
            ]);
            if (messagesResult.error || memberResult.error || state.error) {
                return databaseError(messagesResult.error || memberResult.error || state.error);
            }
            if (delivered?.length) await broadcastChat(supabase, conversation.realtime_topic, 'receipt', { type: 'delivered' });
            return json({ conversation, member: memberResult.data, block_state: state, messages: [...(messagesResult.data || [])].reverse() });
        }

        const { data: idRows, error: idsError } = await conversationIds(supabase, current.id);
        if (idsError) return databaseError(idsError);
        const ids = (idRows || []).map(row => row.id);

        if (event.url.searchParams.get('count_only') === '1') {
            if (!ids.length) return json({ unread_count: 0 });
            const { count, error } = await supabase
                .from('private_messages')
                .select('id', { count: 'exact', head: true })
                .in('conversation_id', ids)
                .neq('sender_id', current.id)
                .is('read_at', null);
            if (error) return databaseError(error);
            return json({ unread_count: count || 0 });
        }

        const { data: conversations, error } = await supabase
            .from('private_conversations')
            .select('id, participant_one, participant_two, realtime_topic, last_message_at, created_at')
            .or(`participant_one.eq.${current.id},participant_two.eq.${current.id}`)
            .order('last_message_at', { ascending: false })
            .limit(80);
        if (error) return databaseError(error);

        if (ids.length) {
            const { data: deliveredMessages, error: deliveryError } = await supabase
                .from('private_messages')
                .update({ delivered_at: new Date().toISOString() })
                .in('conversation_id', ids)
                .neq('sender_id', current.id)
                .is('delivered_at', null)
                .select('conversation_id');
            if (deliveryError) return databaseError(deliveryError);
            const deliveredConversationIds = new Set((deliveredMessages || []).map(item => item.conversation_id));
            await Promise.all((conversations || [])
                .filter(item => deliveredConversationIds.has(item.id))
                .map(item => broadcastChat(supabase, item.realtime_topic, 'receipt', { type: 'delivered' })));
        }

        const otherIds = [...new Set((conversations || []).map(item =>
            item.participant_one === current.id ? item.participant_two : item.participant_one
        ))];
        const [membersResult, messagesResult, blocksResult] = await Promise.all([
            otherIds.length
                ? supabase.from('users').select('id, full_name, name_latin, avatar_url, role').in('id', otherIds)
                : Promise.resolve({ data: [], error: null }),
            ids.length
                ? supabase
                    .from('private_messages')
                    .select('id, conversation_id, sender_id, body, delivered_at, read_at, created_at')
                    .in('conversation_id', ids)
                    .order('created_at', { ascending: false })
                    .limit(1000)
                : Promise.resolve({ data: [], error: null }),
            supabase
                .from('private_chat_blocks')
                .select('blocker_id, blocked_id')
                .or(`blocker_id.eq.${current.id},blocked_id.eq.${current.id}`)
        ]);
        if (membersResult.error || messagesResult.error || blocksResult.error) {
            return databaseError(membersResult.error || messagesResult.error || blocksResult.error);
        }

        const members = new Map((membersResult.data || []).map(member => [member.id, member]));
        const lastMessages = new Map();
        const unread = new Map();
        const blocks = blocksResult.data || [];
        for (const message of messagesResult.data || []) {
            if (!lastMessages.has(message.conversation_id)) lastMessages.set(message.conversation_id, message);
            if (message.sender_id !== current.id && !message.read_at) {
                unread.set(message.conversation_id, (unread.get(message.conversation_id) || 0) + 1);
            }
        }

        return json({
            conversations: (conversations || []).map(item => {
                const otherId = item.participant_one === current.id ? item.participant_two : item.participant_one;
                return {
                    ...item,
                    member: members.get(otherId) || null,
                    last_message: lastMessages.get(item.id) || null,
                    unread_count: unread.get(item.id) || 0,
                    block_state: {
                        blocked_by_me: blocks.some(block => block.blocker_id === current.id && block.blocked_id === otherId),
                        blocked_by_member: blocks.some(block => block.blocker_id === otherId && block.blocked_id === current.id)
                    }
                };
            }),
            unread_count: [...unread.values()].reduce((total, count) => total + count, 0)
        });
    } catch (error) {
        console.error('private-chat API error:', error);
        return json({ error: 'Private chat service error' }, { status: 500 });
    }
}

export async function POST(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return json({ error: 'Chat service is unavailable' }, { status: 503 });
        const current = await actor(event, supabase);
        if (!current) return json({ error: 'Unauthorized' }, { status: 401 });
        const body = await bodyOf(event.request);
        if (!body) return json({ error: 'Invalid request body' }, { status: 400 });

        if (body.action === 'start') {
            if (!validUuid(body.user_id) || body.user_id === current.id) {
                return json({ error: 'Invalid member' }, { status: 400 });
            }
            const { data: member, error: memberError } = await supabase
                .from('users')
                .select('id, full_name, name_latin, avatar_url, role')
                .eq('id', body.user_id)
                .maybeSingle();
            if (memberError) return databaseError(memberError);
            if (!member) return json({ error: 'Member not found' }, { status: 404 });

            const state = await blockState(supabase, current.id, member.id);
            if (state.error) return databaseError(state.error);
            if (state.blocked_by_me || state.blocked_by_member) {
                return json({ error: 'Private chat is blocked between these members' }, { status: 403 });
            }

            const [participantOne, participantTwo] = [current.id, member.id].sort();
            const { data: conversation, error } = await supabase
                .from('private_conversations')
                .upsert({ participant_one: participantOne, participant_two: participantTwo }, {
                    onConflict: 'participant_one,participant_two',
                    ignoreDuplicates: false
                })
                .select('id, participant_one, participant_two, realtime_topic, last_message_at, created_at')
                .single();
            if (error) return databaseError(error);
            return json({ conversation, member, block_state: state });
        }

        if (!validUuid(body.conversation_id)) return json({ error: 'Invalid conversation' }, { status: 400 });
        const { data: conversation, error } = await accessibleConversation(supabase, body.conversation_id, current.id);
        if (error) return databaseError(error);
        if (!conversation) return json({ error: 'Conversation not found' }, { status: 404 });

        const otherId = otherParticipant(conversation, current.id);

        if (body.action === 'block') {
            const { error: blockError } = await supabase.from('private_chat_blocks').upsert({
                blocker_id: current.id,
                blocked_id: otherId
            }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
            if (blockError) return databaseError(blockError);
            await broadcastChat(supabase, conversation.realtime_topic, 'block', { actor_id: current.id });
            const state = await blockState(supabase, current.id, otherId);
            if (state.error) return databaseError(state.error);
            return json({ success: true, block_state: state });
        }

        if (body.action === 'unblock') {
            const { error: unblockError } = await supabase
                .from('private_chat_blocks')
                .delete()
                .eq('blocker_id', current.id)
                .eq('blocked_id', otherId);
            if (unblockError) return databaseError(unblockError);
            await broadcastChat(supabase, conversation.realtime_topic, 'block', { actor_id: current.id });
            const state = await blockState(supabase, current.id, otherId);
            if (state.error) return databaseError(state.error);
            return json({ success: true, block_state: state });
        }

        if (body.action === 'report') {
            const reason = String(body.reason || '');
            const details = cleanText(body.details, 1000) || null;
            if (!REPORT_REASONS.has(reason)) return json({ error: 'Invalid report reason' }, { status: 400 });
            if (body.message_id && !validUuid(body.message_id)) return json({ error: 'Invalid message' }, { status: 400 });

            if (body.message_id) {
                const { data: reportedMessage, error: messageError } = await supabase
                    .from('private_messages')
                    .select('id')
                    .eq('id', body.message_id)
                    .eq('conversation_id', conversation.id)
                    .maybeSingle();
                if (messageError) return databaseError(messageError);
                if (!reportedMessage) return json({ error: 'Message not found' }, { status: 404 });
            }

            const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
            const { count, error: reportCountError } = await supabase
                .from('private_chat_reports')
                .select('id', { count: 'exact', head: true })
                .eq('reporter_id', current.id)
                .gte('created_at', oneDayAgo);
            if (reportCountError) return databaseError(reportCountError);
            if ((count || 0) >= 10) return json({ error: 'Daily report limit reached' }, { status: 429 });

            const { data: report, error: reportError } = await supabase.from('private_chat_reports').insert({
                reporter_id: current.id,
                reported_user_id: otherId,
                conversation_id: conversation.id,
                message_id: body.message_id || null,
                reason,
                details
            }).select('id, status, created_at').single();
            if (reportError) return databaseError(reportError);
            return json({ success: true, report }, { status: 201 });
        }

        if (body.action === 'mark_read') {
            const { data: readMessages, error: readError } = await supabase
                .from('private_messages')
                .update({ read_at: new Date().toISOString(), delivered_at: new Date().toISOString() })
                .eq('conversation_id', conversation.id)
                .neq('sender_id', current.id)
                .is('read_at', null)
                .select('id');
            if (readError) return databaseError(readError);
            if (readMessages?.length) await broadcastChat(supabase, conversation.realtime_topic, 'receipt', { type: 'read' });
            return json({ success: true });
        }

        if (body.action !== 'send') return json({ error: 'Invalid action' }, { status: 400 });
        const state = await blockState(supabase, current.id, otherId);
        if (state.error) return databaseError(state.error);
        if (state.blocked_by_me || state.blocked_by_member) {
            return json({ error: 'Private chat is blocked between these members' }, { status: 403 });
        }
        const messageBody = cleanText(body.body);
        if (!messageBody || messageBody.length > 2000) return json({ error: 'Message must contain 1 to 2000 characters' }, { status: 400 });

        const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
        const { count, error: rateError } = await supabase
            .from('private_messages')
            .select('id', { count: 'exact', head: true })
            .eq('sender_id', current.id)
            .gte('created_at', oneMinuteAgo);
        if (rateError) return databaseError(rateError);
        if ((count || 0) >= 30) return json({ error: 'Please wait before sending more messages' }, { status: 429 });

        const { data: message, error: sendError } = await supabase
            .from('private_messages')
            .insert({ conversation_id: conversation.id, sender_id: current.id, body: messageBody })
            .select('id, conversation_id, sender_id, body, delivered_at, read_at, created_at')
            .single();
        if (sendError) return databaseError(sendError);

        await Promise.allSettled([
            broadcastChat(supabase, conversation.realtime_topic, 'message', { message_id: message.id, sender_id: current.id }),
            sendPushToUser({
                platform: event.platform,
                supabase,
                userId: otherId,
                title: nameOfActor(current),
                body: 'អ្នកមានសារឯកជនថ្មីនៅ CCN-CPD',
                url: '/?openChat=1',
                tag: `chat-${conversation.id}`
            })
        ]);
        return json({ message }, { status: 201 });
    } catch (error) {
        console.error('private-chat API error:', error);
        return json({ error: 'Private chat service error' }, { status: 500 });
    }
}
