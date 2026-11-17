import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';

function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function failure(message, status) {
    return new Response(message, {
        status,
        headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain; charset=utf-8' }
    });
}

export async function GET(event) {
    const userId = await getRequestUserId(event);
    const messageId = event.url.searchParams.get('message_id');
    if (!validUuid(userId)) return failure('Unauthorized', 401);
    if (!validUuid(messageId)) return failure('Invalid attachment', 400);
    if (!event.platform?.env?.BUCKET) return failure('Attachment storage is unavailable', 503);

    const supabase = serviceClient(event.platform);
    if (!supabase) return failure('Chat service is unavailable', 503);
    const { data: message, error } = await supabase
        .from('private_messages')
        .select('conversation_id, attachment_key, attachment_name, attachment_type, deleted_at')
        .eq('id', messageId)
        .maybeSingle();
    if (error) {
        console.error('private-chat attachment lookup failed:', error);
        return failure('Unable to load attachment', 500);
    }
    if (!message || message.deleted_at || !message.attachment_key) {
        return failure('Attachment not found', 404);
    }
    const { data: conversation, error: conversationError } = await supabase
        .from('private_conversations')
        .select('id')
        .eq('id', message.conversation_id)
        .or(`participant_one.eq.${userId},participant_two.eq.${userId}`)
        .maybeSingle();
    if (conversationError) {
        console.error('private-chat attachment access check failed:', conversationError);
        return failure('Unable to load attachment', 500);
    }
    if (!conversation) return failure('Attachment not found', 404);

    const object = await event.platform.env.BUCKET.get(message.attachment_key);
    if (!object) return failure('Attachment not found', 404);
    const safeName = String(message.attachment_name || 'attachment').replace(/[\r\n"]/g, '_');
    const inline = String(message.attachment_type || '').startsWith('image/') || message.attachment_type === 'application/pdf';
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', message.attachment_type || headers.get('Content-Type') || 'application/octet-stream');
    headers.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    headers.set('Cache-Control', 'private, max-age=300');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:");
    if (object.etag) headers.set('ETag', object.etag);
    return new Response(object.body, { headers });
}
