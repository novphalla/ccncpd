import { json as kitJson } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';

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
        .select('id, participant_one, participant_two, last_message_at, created_at')
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
            const { data, error } = await supabase
                .from('users')
                .select('id, full_name, name_latin, avatar_url, role')
                .neq('id', current.id)
                .or(`full_name.ilike.%${safeSearch}%,name_latin.ilike.%${safeSearch}%`)
                .limit(20);
            if (error) return databaseError(error);
            return json({ members: data || [] });
        }

        const conversationId = event.url.searchParams.get('conversation_id');
        if (conversationId) {
            const { data: conversation, error } = await accessibleConversation(supabase, conversationId, current.id);
            if (error) return databaseError(error);
            if (!conversation) return json({ error: 'Conversation not found' }, { status: 404 });

            const { data: messages, error: messagesError } = await supabase
                .from('private_messages')
                .select('id, conversation_id, sender_id, body, read_at, created_at')
                .eq('conversation_id', conversation.id)
                .order('created_at', { ascending: true })
                .limit(300);
            if (messagesError) return databaseError(messagesError);
            return json({ conversation, messages: messages || [] });
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
            .select('id, participant_one, participant_two, last_message_at, created_at')
            .or(`participant_one.eq.${current.id},participant_two.eq.${current.id}`)
            .order('last_message_at', { ascending: false })
            .limit(80);
        if (error) return databaseError(error);

        const otherIds = [...new Set((conversations || []).map(item =>
            item.participant_one === current.id ? item.participant_two : item.participant_one
        ))];
        const [membersResult, messagesResult] = await Promise.all([
            otherIds.length
                ? supabase.from('users').select('id, full_name, name_latin, avatar_url, role').in('id', otherIds)
                : Promise.resolve({ data: [], error: null }),
            ids.length
                ? supabase
                    .from('private_messages')
                    .select('id, conversation_id, sender_id, body, read_at, created_at')
                    .in('conversation_id', ids)
                    .order('created_at', { ascending: false })
                    .limit(1000)
                : Promise.resolve({ data: [], error: null })
        ]);
        if (membersResult.error || messagesResult.error) return databaseError(membersResult.error || messagesResult.error);

        const members = new Map((membersResult.data || []).map(member => [member.id, member]));
        const lastMessages = new Map();
        const unread = new Map();
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
                    unread_count: unread.get(item.id) || 0
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

            const [participantOne, participantTwo] = [current.id, member.id].sort();
            const { data: conversation, error } = await supabase
                .from('private_conversations')
                .upsert({ participant_one: participantOne, participant_two: participantTwo }, {
                    onConflict: 'participant_one,participant_two',
                    ignoreDuplicates: false
                })
                .select('id, participant_one, participant_two, last_message_at, created_at')
                .single();
            if (error) return databaseError(error);
            return json({ conversation, member });
        }

        if (!validUuid(body.conversation_id)) return json({ error: 'Invalid conversation' }, { status: 400 });
        const { data: conversation, error } = await accessibleConversation(supabase, body.conversation_id, current.id);
        if (error) return databaseError(error);
        if (!conversation) return json({ error: 'Conversation not found' }, { status: 404 });

        if (body.action === 'mark_read') {
            const { error: readError } = await supabase
                .from('private_messages')
                .update({ read_at: new Date().toISOString() })
                .eq('conversation_id', conversation.id)
                .neq('sender_id', current.id)
                .is('read_at', null);
            if (readError) return databaseError(readError);
            return json({ success: true });
        }

        if (body.action !== 'send') return json({ error: 'Invalid action' }, { status: 400 });
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
            .select('id, conversation_id, sender_id, body, read_at, created_at')
            .single();
        if (sendError) return databaseError(sendError);
        return json({ message }, { status: 201 });
    } catch (error) {
        console.error('private-chat API error:', error);
        return json({ error: 'Private chat service error' }, { status: 500 });
    }
}
