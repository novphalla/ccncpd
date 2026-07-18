import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL } from '$env/static/public';
import { env } from '$env/dynamic/private';
import { getRequestUserId } from '$lib/server/requestAuth';

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

function cleanInviteCode(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 4);
}

async function getUser(supabase, userId) {
    if (!validUuid(userId)) return null;
    const { data } = await supabase
        .from('users')
        .select('id, role')
        .eq('id', userId)
        .maybeSingle();
    return data || null;
}

async function requireAdmin(event, supabase) {
    const user = await getUser(supabase, await getRequestUserId(event));
    return user && ['admin', 'owner'].includes(user.role) ? user : null;
}

async function requireUser(event, supabase) {
    return getUser(supabase, await getRequestUserId(event));
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

function serverError(error) {
    console.error('course-invite-codes API error:', error);
    return json({
        error: 'Invite code service error',
        code: 'INVITE_CODE_SERVER_ERROR'
    }, { status: 500 });
}

export async function GET(event) {
    try {
        const { url, platform } = event;
        const mode = url.searchParams.get('mode');
        const supabase = serviceClient(platform);

        if (!supabase && mode === 'unlocks') {
            return json({ unlocks: [], disabled: true, code: 'SERVICE_ROLE_KEY_MISSING' });
        }
        if (!supabase) return unavailable();
        if (mode === 'unlocks') {
            const user = await requireUser(event, supabase);
            if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

            const { data, error } = await supabase
                .from('course_invite_redemptions')
                .select('course_id')
                .eq('user_id', user.id);

            if (error) return dbError(error);
            return json({ unlocks: data || [] });
        }

        const admin = await requireAdmin(event, supabase);
        if (!admin) return json({ error: 'Unauthorized' }, { status: 401 });

        const courseId = url.searchParams.get('course_id');
        if (!validUuid(courseId)) return json({ error: 'Invalid course_id' }, { status: 400 });

        const { data, error } = await supabase
            .from('course_invite_codes')
            .select('*')
            .eq('course_id', courseId)
            .order('created_at', { ascending: false });

        if (error) return dbError(error);
        return json({ inviteCodes: data || [] });
    } catch (error) {
        return serverError(error);
    }
}

export async function POST(event) {
    try {
        const { request, platform } = event;
        const supabase = serviceClient(platform);
        if (!supabase) return unavailable();

        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'Invalid request body' }, { status: 400 });
        }

        if (body?.action === 'redeem') {
            const user = await requireUser(event, supabase);
            if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

            const code = cleanInviteCode(body.code);
            if (code.length !== 4) return json({ error: 'Invalid invite code' }, { status: 400 });

            const { data: invite, error: inviteError } = await supabase
                .from('course_invite_codes')
                .select('*')
                .eq('code', code)
                .eq('is_active', true)
                .maybeSingle();

            if (inviteError) return dbError(inviteError);
            if (!invite) return json({ error: 'Invalid invite code' }, { status: 404 });

            const now = Date.now();
            if (invite.starts_at && new Date(invite.starts_at).getTime() > now) {
                return json({ error: 'Invite code is not open yet' }, { status: 400 });
            }
            if (invite.expires_at && new Date(invite.expires_at).getTime() < now) {
                return json({ error: 'Invite code has expired' }, { status: 400 });
            }

            const { data: existing, error: existingError } = await supabase
                .from('course_invite_redemptions')
                .select('id')
                .eq('course_id', invite.course_id)
                .eq('user_id', user.id)
                .maybeSingle();

            if (existingError) return dbError(existingError);

            if (!existing) {
                if (invite.max_uses !== null && invite.used_count >= invite.max_uses) {
                    return json({ error: 'Invite code usage limit reached' }, { status: 400 });
                }

                const { error: redemptionError } = await supabase
                    .from('course_invite_redemptions')
                    .insert({
                        code_id: invite.id,
                        course_id: invite.course_id,
                        user_id: user.id
                    });

                if (redemptionError) return dbError(redemptionError);
            }

            return json({
                course_id: invite.course_id,
                auto_enroll: invite.auto_enroll === true
            });
        }

        const admin = await requireAdmin(event, supabase);
        if (!admin) return json({ error: 'Unauthorized' }, { status: 401 });

        const code = cleanInviteCode(body.code);
        if (code.length !== 4) return json({ error: 'Invite code must be 4 digits' }, { status: 400 });
        if (!validUuid(body.course_id)) return json({ error: 'Invalid course_id' }, { status: 400 });

        const maxUses = body.max_uses === null || body.max_uses === ''
            ? null
            : Number(body.max_uses);
        if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
            return json({ error: 'max_uses must be a positive integer' }, { status: 400 });
        }

        let expiresAt = null;
        if (body.expires_at) {
            const expiresDate = new Date(body.expires_at);
            if (Number.isNaN(expiresDate.getTime())) {
                return json({ error: 'Invalid expires_at' }, { status: 400 });
            }
            expiresAt = expiresDate.toISOString();
        }

        const payload = {
            course_id: body.course_id,
            code,
            description: body.description || null,
            max_uses: maxUses,
            expires_at: expiresAt,
            auto_enroll: body.auto_enroll === true,
            is_active: body.is_active !== false,
            created_by: admin.id,
            updated_at: new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('course_invite_codes')
            .insert(payload)
            .select('*')
            .single();

        if (error) return dbError(error);
        return json({ inviteCode: data });
    } catch (error) {
        return serverError(error);
    }
}

export async function PATCH(event) {
    try {
        const { request, platform } = event;
        const supabase = serviceClient(platform);
        if (!supabase) return unavailable();

        const admin = await requireAdmin(event, supabase);
        if (!admin) return json({ error: 'Unauthorized' }, { status: 401 });

        let body;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'Invalid request body' }, { status: 400 });
        }

        if (!validUuid(body.id)) return json({ error: 'Invalid invite code id' }, { status: 400 });

        const updates = { updated_at: new Date().toISOString() };
        if (typeof body.is_active === 'boolean') updates.is_active = body.is_active;

        const { data, error } = await supabase
            .from('course_invite_codes')
            .update(updates)
            .eq('id', body.id)
            .select('*')
            .single();

        if (error) return dbError(error);
        return json({ inviteCode: data });
    } catch (error) {
        return serverError(error);
    }
}

export async function DELETE(event) {
    try {
        const { request, platform } = event;
        const supabase = serviceClient(platform);
        if (!supabase) return unavailable();

        const admin = await requireAdmin(event, supabase);
        if (!admin) return json({ error: 'Unauthorized' }, { status: 401 });

        const id = new URL(request.url).searchParams.get('id');
        if (!validUuid(id)) return json({ error: 'Invalid invite code id' }, { status: 400 });

        const { error } = await supabase
            .from('course_invite_codes')
            .delete()
            .eq('id', id);

        if (error) return dbError(error);
        return json({ success: true });
    } catch (error) {
        return serverError(error);
    }
}
