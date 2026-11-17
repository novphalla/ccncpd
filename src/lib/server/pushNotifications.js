import { buildPushPayload } from '@block65/webcrypto-web-push';
import { env } from '$env/dynamic/private';

function vapidConfig(platform) {
    const source = platform?.env || {};
    const publicKey = source.VAPID_PUBLIC_KEY || env.VAPID_PUBLIC_KEY;
    const privateKey = source.VAPID_PRIVATE_KEY || env.VAPID_PRIVATE_KEY;
    const subject = source.VAPID_SUBJECT || env.VAPID_SUBJECT || 'mailto:novphalla1208@gmail.com';
    return publicKey && privateKey ? { publicKey, privateKey, subject } : null;
}

export function publicVapidKey(platform) {
    return platform?.env?.VAPID_PUBLIC_KEY || env.VAPID_PUBLIC_KEY || '';
}

export async function sendPushToUser({ platform, supabase, userId, title, body, url = '/', tag = 'ccn-cpd' }) {
    const vapid = vapidConfig(platform);
    if (!vapid || !supabase || !userId) return { sent: 0, unavailable: true };

    const { data: subscriptions, error } = await supabase
        .from('push_subscriptions')
        .select('id, endpoint, p256dh, auth')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(10);
    if (error) {
        console.warn('Unable to load push subscriptions:', error.message);
        return { sent: 0, error: true };
    }

    const staleIds = [];
    let sent = 0;
    await Promise.allSettled((subscriptions || []).map(async subscription => {
        try {
            const payload = await buildPushPayload({
                data: { title, body, url, tag },
                options: { ttl: 300, urgency: 'high', topic: String(tag).replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 32) || 'ccn-cpd' }
            }, {
                endpoint: subscription.endpoint,
                expirationTime: null,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth }
            }, vapid);
            const response = await fetch(subscription.endpoint, payload);
            if (response.ok) sent += 1;
            else if (response.status === 404 || response.status === 410) staleIds.push(subscription.id);
            else console.warn('Push service rejected notification:', response.status);
        } catch (pushError) {
            console.warn('Unable to send Web Push notification:', pushError?.message || pushError);
        }
    }));

    if (staleIds.length) {
        const { error: cleanupError } = await supabase.from('push_subscriptions').delete().in('id', staleIds);
        if (cleanupError) console.warn('Unable to remove expired push subscriptions:', cleanupError.message);
    }
    return { sent };
}
