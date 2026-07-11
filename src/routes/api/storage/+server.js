import { json } from '@sveltejs/kit';
import { PUBLIC_R2_PUBLIC_URL, PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { env } from '$env/dynamic/private';
import { createClient } from '@supabase/supabase-js';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif',
    'application/pdf',
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
    'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/webm',
];

/** Verify the requesting user is an admin/owner by checking the users table. */
async function getAuthUser(request, cfServiceKey) {
    const authHeader = request.headers.get('Authorization');
    const userId = request.headers.get('X-User-Id');
    if (!userId) return null;
    // Basic UUID format check to prevent injection
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return null;

    // Use service role key (bypasses RLS) — try CF platform.env first, then $env/dynamic/private
    const serviceKey = cfServiceKey || env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceKey) {
        // Service role: trust UUID, verify against users table
        const supabase = createClient(PUBLIC_SUPABASE_URL, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false }
        });
        const { data: user, error } = await supabase
            .from('users')
            .select('id, role')
            .eq('id', userId)
            .in('role', ['admin', 'owner'])
            .maybeSingle();
        if (error || !user) return null;
        return user;
    }

    // Fallback: use user's JWT to bypass RLS via authenticated client
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);
    const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
    });
    // Verify the JWT belongs to the claimed user
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authUser || authUser.id !== userId) return null;

    // Check role in JWT metadata first (works without any DB query or RLS)
    const metaRole = authUser.app_metadata?.role || authUser.user_metadata?.role;
    if (metaRole === 'admin' || metaRole === 'owner') {
        return { id: userId, role: metaRole };
    }

    // Last resort: DB query (requires SELECT RLS policy on users table)
    const { data: user } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', userId)
        .in('role', ['admin', 'owner'])
        .maybeSingle();
    return user || null;
}

/** Anon-key fallback: verify role via public users table (no JWT needed). */
async function getAuthUserAnon(userId) {
    const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: user } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', userId)
        .in('role', ['admin', 'owner'])
        .maybeSingle();
    return user || null;
}

export async function GET({ url, platform, request }) {
    if (!platform?.env?.BUCKET) {
        return json({ error: 'R2 Bucket not configured' }, { status: 500 });
    }

    const userId = request.headers.get('X-User-Id');
    const user = await getAuthUser(request, platform?.env?.SUPABASE_SERVICE_ROLE_KEY)
        || (userId ? await getAuthUserAnon(userId) : null);
    if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

    const prefix = url.searchParams.get('prefix') || '';
    const cursor = url.searchParams.get('cursor');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    const options = {
        limit,
        prefix: prefix || undefined,
        cursor: cursor || undefined
    };

    const listed = await platform.env.BUCKET.list(options);

    return json({
        objects: listed.objects,
        truncated: listed.truncated,
        cursor: listed.cursor
    });
}

export async function POST({ request, platform }) {
    if (!platform?.env?.BUCKET) {
        return json({ error: 'R2 Bucket not configured' }, { status: 500 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const folder = formData.get('folder') || 'uploads';

    if (!file || !(file instanceof File)) {
        return json({ error: 'No file uploaded' }, { status: 400 });
    }

    // File size validation
    if (file.size > MAX_FILE_SIZE) {
        return json({ error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)` }, { status: 400 });
    }

    // MIME type validation
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        return json({ error: 'File type not allowed' }, { status: 400 });
    }

    // Sanitize folder path to prevent path traversal
    const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');

    const userId = request.headers.get('X-User-Id');
    if (safeFolder === 'payment_proofs') {
        const anyUser = await getAnyAuthUser(request, userId, platform?.env?.SUPABASE_SERVICE_ROLE_KEY);
        if (!anyUser) return json({ error: 'Unauthorized' }, { status: 401 });
    } else {
        const user = await getAuthUser(request, platform?.env?.SUPABASE_SERVICE_ROLE_KEY)
            || (userId ? await getAuthUserAnon(userId) : null);
        if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
    }

    const fileName = `${safeFolder}/${Date.now()}_${Math.random().toString(36).substring(2, 10)}_${safeName}`;

    // Upload to R2
    await platform.env.BUCKET.put(fileName, file, {
        httpMetadata: { contentType: file.type }
    });

    const baseUrl = PUBLIC_R2_PUBLIC_URL.replace(/\/$/, '');
    const publicUrl = `${baseUrl}/${fileName}`;

    return json({ publicUrl });
}

/** Verify ANY authenticated user (not just admin/owner) — used for self-owned files like avatars. */
async function getAnyAuthUser(request, userId, cfServiceKey) {
    if (!userId) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return null;
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return null;
    const token = authHeader.slice(7);
    const serviceKey = cfServiceKey || env.SUPABASE_SERVICE_ROLE_KEY;
    const supabase = createClient(PUBLIC_SUPABASE_URL, serviceKey || PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: { user: authUser }, error } = await supabase.auth.getUser(token);
    if (error || !authUser || authUser.id !== userId) return null;
    return authUser;
}

export async function DELETE({ request, platform }) {
    if (!platform?.env?.BUCKET) {
        return json({ error: 'R2 Bucket not configured' }, { status: 500 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { url } = body;
    if (!url || typeof url !== 'string') {
        return json({ error: 'No URL or Key provided' }, { status: 400 });
    }

    let key;
    if (!url.startsWith('http')) {
        key = url;
    } else if (url.startsWith(PUBLIC_R2_PUBLIC_URL)) {
        key = url.substring(PUBLIC_R2_PUBLIC_URL.length + 1);
    } else {
        return json({ error: 'Unrecognized URL format for deletion' }, { status: 400 });
    }

    // Prevent path traversal
    if (key.includes('..') || key.startsWith('/')) {
        return json({ error: 'Invalid key' }, { status: 400 });
    }

    const userId = request.headers.get('X-User-Id');

    // Avatar files: allow any authenticated user to delete (needed for profile photo cleanup)
    if (key.startsWith('avatars/')) {
        const anyUser = await getAnyAuthUser(request, userId, platform?.env?.SUPABASE_SERVICE_ROLE_KEY);
        if (!anyUser) return json({ error: 'Unauthorized' }, { status: 401 });
    } else {
        // All other files: require admin/owner
        const user = await getAuthUser(request, platform?.env?.SUPABASE_SERVICE_ROLE_KEY)
            || (userId ? await getAuthUserAnon(userId) : null);
        if (!user) return json({ error: 'Unauthorized' }, { status: 401 });
    }

    await platform.env.BUCKET.delete(key);

    return json({ success: true });
}
