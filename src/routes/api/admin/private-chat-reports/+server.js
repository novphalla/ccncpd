import { json as kitJson } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';

const ADMIN_ROLES = new Set(['admin', 'owner']);
const VALID_STATUSES = new Set(['pending', 'reviewed', 'dismissed', 'all']);
const VALID_ACTIONS = new Set(['dismiss', 'resolve', 'block']);

function json(body, init = {}) {
    return kitJson(body, { ...init, headers: { 'Cache-Control': 'private, no-store', ...(init.headers || {}) } });
}

function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function requireAdmin(event, supabase) {
    const userId = await getRequestUserId(event);
    if (!validUuid(userId)) return null;
    const { data, error } = await supabase.from('users').select('id, role, full_name').eq('id', userId).maybeSingle();
    return !error && data && ADMIN_ROLES.has(data.role) ? data : null;
}

function databaseError(error) {
    console.error('private-chat-reports database error:', error);
    return json({ error: 'Unable to process private chat reports', code: error.code }, { status: 500 });
}

export async function GET(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return json({ error: 'Moderation service is unavailable' }, { status: 503 });
        const admin = await requireAdmin(event, supabase);
        if (!admin) return json({ error: 'Forbidden' }, { status: 403 });

        const status = event.url.searchParams.get('status') || 'pending';
        if (!VALID_STATUSES.has(status)) return json({ error: 'Invalid status' }, { status: 400 });
        let query = supabase
            .from('private_chat_reports')
            .select('id, reporter_id, reported_user_id, conversation_id, message_id, reason, details, status, reviewed_by, reviewed_at, created_at')
            .order('created_at', { ascending: false })
            .limit(150);
        if (status === 'pending') query = query.eq('status', 'pending');
        else if (status === 'dismissed') query = query.eq('status', 'dismissed');
        else if (status === 'reviewed') query = query.in('status', ['reviewing', 'resolved']);

        const { data: reports, error } = await query;
        if (error) return databaseError(error);
        const userIds = [...new Set((reports || []).flatMap(item => [item.reporter_id, item.reported_user_id, item.reviewed_by].filter(Boolean)))];
        const messageIds = [...new Set((reports || []).map(item => item.message_id).filter(Boolean))];
        const [usersResult, messagesResult] = await Promise.all([
            userIds.length ? supabase.from('users').select('id, full_name, name_latin, avatar_url, role').in('id', userIds) : Promise.resolve({ data: [], error: null }),
            messageIds.length ? supabase.from('private_messages').select('id, sender_id, body, created_at').in('id', messageIds) : Promise.resolve({ data: [], error: null })
        ]);
        if (usersResult.error || messagesResult.error) return databaseError(usersResult.error || messagesResult.error);
        const users = new Map((usersResult.data || []).map(item => [item.id, item]));
        const messages = new Map((messagesResult.data || []).map(item => [item.id, item]));
        return json({ reports: (reports || []).map(item => ({
            ...item,
            reporter: users.get(item.reporter_id) || null,
            reported_user: users.get(item.reported_user_id) || null,
            reviewer: users.get(item.reviewed_by) || null,
            message: messages.get(item.message_id) || null
        })) });
    } catch (error) {
        console.error('private-chat-reports API error:', error);
        return json({ error: 'Moderation service error' }, { status: 500 });
    }
}

export async function PATCH(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return json({ error: 'Moderation service is unavailable' }, { status: 503 });
        const admin = await requireAdmin(event, supabase);
        if (!admin) return json({ error: 'Forbidden' }, { status: 403 });
        const body = await event.request.json().catch(() => null);
        if (!body || !validUuid(body.report_id) || !VALID_ACTIONS.has(body.action)) {
            return json({ error: 'Invalid request body' }, { status: 400 });
        }

        const { data: report, error } = await supabase
            .from('private_chat_reports')
            .select('id, reporter_id, reported_user_id, conversation_id, status')
            .eq('id', body.report_id)
            .maybeSingle();
        if (error) return databaseError(error);
        if (!report) return json({ error: 'Report not found' }, { status: 404 });
        if (report.status !== 'pending' && report.status !== 'reviewing') {
            return json({ error: 'Report has already been resolved' }, { status: 409 });
        }

        if (body.action === 'block') {
            const { error: blockError } = await supabase.from('private_chat_blocks').upsert({
                blocker_id: report.reporter_id,
                blocked_id: report.reported_user_id
            }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true });
            if (blockError) return databaseError(blockError);
        }

        const now = new Date().toISOString();
        const nextStatus = body.action === 'dismiss' ? 'dismissed' : 'resolved';
        const { error: updateError } = await supabase
            .from('private_chat_reports')
            .update({ status: nextStatus, reviewed_by: admin.id, reviewed_at: now })
            .eq('id', report.id);
        if (updateError) return databaseError(updateError);

        const { error: logError } = await supabase.from('admin_logs').insert({
            admin_id: admin.id,
            action: `private_chat_report_${body.action}`,
            details: `Private chat report ${report.id}; conversation ${report.conversation_id}`
        });
        if (logError) console.warn('Unable to write private chat moderation log:', logError.message);
        return json({ success: true, status: nextStatus });
    } catch (error) {
        console.error('private-chat-reports API error:', error);
        return json({ error: 'Moderation service error' }, { status: 500 });
    }
}
