import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { env } from '$env/dynamic/private';

const LEGACY_COOKIE = 'ccn_legacy_session';
const LEGACY_SESSION_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function serviceKey(platform) {
    return platform?.env?.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
}

export function serviceClient(platform) {
    const key = serviceKey(platform);
    if (!key) return null;
    return createClient(PUBLIC_SUPABASE_URL, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
}

function bytesToBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function signature(value, platform) {
    const keyValue = serviceKey(platform);
    if (!keyValue) return null;
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(keyValue),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signed = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
    return bytesToBase64Url(new Uint8Array(signed));
}

function constantTimeEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index++) {
        difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return difference === 0;
}

export async function createLegacySession(userId, platform) {
    const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
        sub: userId,
        exp: Math.floor(Date.now() / 1000) + LEGACY_SESSION_SECONDS
    })));
    const signed = await signature(payload, platform);
    return signed ? `${payload}.${signed}` : null;
}

async function verifyLegacySession(token, platform) {
    const [payload, suppliedSignature, extra] = String(token || '').split('.');
    if (!payload || !suppliedSignature || extra) return null;

    const expectedSignature = await signature(payload, platform);
    if (!expectedSignature || !constantTimeEqual(suppliedSignature, expectedSignature)) return null;

    try {
        const parsed = JSON.parse(decoder.decode(base64UrlToBytes(payload)));
        if (!parsed?.sub || !parsed?.exp || parsed.exp <= Math.floor(Date.now() / 1000)) return null;
        return parsed.sub;
    } catch {
        return null;
    }
}

export function setLegacySessionCookie(cookies, token, secure) {
    cookies.set(LEGACY_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: LEGACY_SESSION_SECONDS
    });
}

export function clearLegacySessionCookie(cookies, secure) {
    cookies.delete(LEGACY_COOKIE, { path: '/', secure, sameSite: 'lax' });
}

export async function getRequestUserId({ request, cookies, platform }) {
    const client = serviceClient(platform);
    if (!client) return null;

    const authorization = request.headers.get('Authorization');
    if (authorization?.startsWith('Bearer ')) {
        const token = authorization.slice(7);
        const { data: { user }, error } = await client.auth.getUser(token);
        if (!error && user?.id) return user.id;
    }

    return verifyLegacySession(cookies.get(LEGACY_COOKIE), platform);
}
