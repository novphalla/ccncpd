import { json } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';
import { publicVapidKey } from '$lib/server/pushNotifications';

function response(body, init = {}) {
    return json(body, {
        ...init,
        headers: { 'Cache-Control': 'private, no-store', ...(init.headers || {}) }
    });
}

function validEndpoint(value) {
    try {
        const url = new URL(String(value || ''));
        return url.protocol === 'https:' && url.href.length <= 2048;
    } catch {
        return false;
    }
}

export async function GET({ platform }) {
    const publicKey = publicVapidKey(platform);
    return response({ available: Boolean(publicKey), public_key: publicKey });
}

export async function POST(event) {
    try {
        const supabase = serviceClient(event.platform);
        const userId = await getRequestUserId(event);
        if (!supabase || !userId) return response({ error: 'Unauthorized' }, { status: 401 });

        const body = await event.request.json().catch(() => null);
        if (!body) return response({ error: 'Invalid request body' }, { status: 400 });

        const endpoint = body.endpoint || body.subscription?.endpoint;
        if (!validEndpoint(endpoint)) return response({ error: 'Invalid subscription endpoint' }, { status: 400 });

        if (body.action === 'unsubscribe') {
            const { error } = await supabase
                .from('push_subscriptions')
                .delete()
                .eq('user_id', userId)
                .eq('endpoint', endpoint);
            if (error) return response({ error: 'Unable to remove subscription' }, { status: 500 });
            return response({ ok: true });
        }

        const subscription = body.subscription || body;
        const p256dh = String(subscription.keys?.p256dh || '').trim();
        const auth = String(subscription.keys?.auth || '').trim();
        if (p256dh.length < 20 || p256dh.length > 512 || auth.length < 8 || auth.length > 256) {
            return response({ error: 'Invalid subscription keys' }, { status: 400 });
        }

        const { error } = await supabase.from('push_subscriptions').upsert({
            user_id: userId,
            endpoint,
            p256dh,
            auth,
            user_agent: String(event.request.headers.get('user-agent') || '').slice(0, 500),
            updated_at: new Date().toISOString()
        }, { onConflict: 'endpoint' });
        if (error) {
            console.error('push subscription database error:', error);
            return response({ error: 'Unable to save subscription' }, { status: 500 });
        }
        return response({ ok: true });
    } catch (error) {
        console.error('push subscription API error:', error);
        return response({ error: 'Push subscription service error' }, { status: 500 });
    }
}
