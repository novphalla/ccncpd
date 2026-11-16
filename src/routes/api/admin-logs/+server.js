import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { env } from '$env/dynamic/private';

function serviceClient(platform) {
    const serviceKey = platform?.env?.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return null;
    return createClient(PUBLIC_SUPABASE_URL, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function requireAdmin(request, supabase) {
    const userId = request.headers.get('X-User-Id');
    if (!validUuid(userId)) return null;

    const { data, error } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', userId)
        .maybeSingle();

    if (error || !data) return null;
    return ['admin', 'owner'].includes(data.role) ? data : null;
}

function unavailable() {
    return json({
        error: 'SUPABASE_SERVICE_ROLE_KEY is not configured',
        code: 'SERVICE_ROLE_KEY_MISSING'
    }, { status: 503 });
}

function dbError(error, status = 400) {
    return json({ error: error.message, code: error.code }, { status });
}

export async function GET({ url, request, platform }) {
    try {
        const supabase = serviceClient(platform);
        if (!supabase) return unavailable();

        const admin = await requireAdmin(request, supabase);
        if (!admin) return json({ error: 'Unauthorized' }, { status: 401 });

        const page = Math.max(1, Number(url.searchParams.get('page') || 1));
        const pageSize = Math.min(500, Math.max(1, Number(url.searchParams.get('pageSize') || 50)));
        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        const search = (url.searchParams.get('search') || '').trim().replace(/,/g, ' ');
        const startDate = url.searchParams.get('startDate');
        const endDate = url.searchParams.get('endDate');
        const action = url.searchParams.get('action');

        let query = supabase
            .from('admin_logs')
            .select('*, users!inner(full_name, name_latin, role)')
            .order('created_at', { ascending: false })
            .range(from, to);

        if (admin.role !== 'owner') query = query.neq('users.role', 'owner');
        if (action) query = query.eq('action', action);
        if (search) query = query.or(`full_name.ilike.%${search}%,name_latin.ilike.%${search}%`, { foreignTable: 'users' });
        if (startDate) query = query.gte('created_at', new Date(`${startDate}T00:00:00`).toISOString());
        if (endDate) query = query.lte('created_at', new Date(`${endDate}T23:59:59.999`).toISOString());

        const { data, error } = await query;
        if (error) return dbError(error);
        return json({ logs: data || [] });
    } catch (error) {
        console.error('admin-logs GET error:', error);
        return json({ error: 'Admin logs service error', code: 'ADMIN_LOGS_SERVER_ERROR' }, { status: 500 });
    }
}

export async function POST({ request, platform }) {
    try {
        const supabase = serviceClient(platform);
        if (!supabase) return unavailable();

        const admin = await requireAdmin(request, supabase);
        if (!admin) return json({ error: 'Unauthorized' }, { status: 401 });

        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'Invalid request body' }, { status: 400 });
        }

        const action = String(body?.action || '').trim();
        const details = String(body?.details || '').trim();
        if (!action) return json({ error: 'Action is required' }, { status: 400 });

        const { error } = await supabase.from('admin_logs').insert({
            admin_id: admin.id,
            action: action.slice(0, 120),
            details: details.slice(0, 2000)
        });

        if (error) return dbError(error);
        return json({ ok: true });
    } catch (error) {
        console.error('admin-logs POST error:', error);
        return json({ error: 'Admin logs service error', code: 'ADMIN_LOGS_SERVER_ERROR' }, { status: 500 });
    }
}