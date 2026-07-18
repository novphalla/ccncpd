import { json } from '@sveltejs/kit';
import {
    clearLegacySessionCookie,
    createLegacySession,
    getRequestUserId,
    serviceClient,
    setLegacySessionCookie
} from '$lib/server/requestAuth';

function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function hashPin(pin) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin));
    return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function POST({ request, cookies, platform, url }) {
    try {
        const client = serviceClient(platform);
        if (!client) return json({ error: 'Authentication service unavailable' }, { status: 503 });

        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'Invalid request body' }, { status: 400 });
        }

        const userId = body?.userId;
        const pin = String(body?.pin || '').trim();
        if (!validUuid(userId) || !/^\d{4}$/.test(pin)) {
            return json({ error: 'Invalid credentials' }, { status: 400 });
        }

        const { data, error } = await client.rpc('verify_pin', {
            user_id: userId,
            pin_hash: await hashPin(pin),
            pin_plain: pin
        });

        if (error || data !== true) return json({ error: 'Invalid credentials' }, { status: 401 });

        const token = await createLegacySession(userId, platform);
        if (!token) return json({ error: 'Authentication service unavailable' }, { status: 503 });

        setLegacySessionCookie(cookies, token, url.protocol === 'https:');
        return json({ success: true, userId }, {
            headers: { 'Cache-Control': 'private, no-store' }
        });
    } catch (error) {
        console.error('legacy-session API error:', error);
        return json({ error: 'Authentication service unavailable' }, { status: 500 });
    }
}

export async function GET(event) {
    try {
        const userId = await getRequestUserId(event);
        const options = { headers: { 'Cache-Control': 'private, no-store' } };
        return userId
            ? json({ authenticated: true, userId }, options)
            : json({ authenticated: false }, { ...options, status: 401 });
    } catch (error) {
        console.error('legacy-session validation error:', error);
        return json({ authenticated: false }, { status: 500 });
    }
}

export async function DELETE({ cookies, url }) {
    clearLegacySessionCookie(cookies, url.protocol === 'https:');
    return json({ success: true });
}
