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

async function requireAdmin(event, supabase) {
    const userId = await getRequestUserId(event);
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

function cleanResultRow(row) {
    if (!validUuid(row?.user_id) || !validUuid(row?.course_id)) return null;

    const score = Number(row.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) return null;
    if (!['pre', 'post'].includes(row.type)) return null;

    const cleaned = {
        user_id: row.user_id,
        course_id: row.course_id,
        score,
        correct_count: Math.max(0, Number(row.correct_count) || 0),
        total_questions: Math.max(0, Number(row.total_questions) || 0),
        passed: row.passed === true,
        type: row.type,
        answers: row.answers && typeof row.answers === 'object' ? row.answers : {}
    };

    if (row.created_at) {
        const createdAt = new Date(row.created_at);
        if (Number.isNaN(createdAt.getTime())) return null;
        cleaned.created_at = createdAt.toISOString();
    }

    return cleaned;
}

export async function GET(event) {
    try {
        const { url, platform } = event;
        const supabase = serviceClient(platform);
        if (!supabase) return unavailable();

        const admin = await requireAdmin(event, supabase);
        if (!admin) return json({ error: 'Unauthorized' }, { status: 401 });

        const courseId = url.searchParams.get('course_id');
        if (courseId && !validUuid(courseId)) {
            return json({ error: 'Invalid course_id' }, { status: 400 });
        }

        const results = [];
        const step = 1000;
        let from = 0;

        while (true) {
            let query = supabase
                .from('student_quiz_results')
                .select('id, user_id, course_id, score, passed, type, created_at, users!inner(full_name, name_latin, phone_number, gender, profile_data, avatar_url), courses!inner(title, cpd_points, cert_template_url)')
                .order('created_at', { ascending: false })
                .range(from, from + step - 1);

            if (courseId) query = query.eq('course_id', courseId);

            const { data, error } = await query;
            if (error) return dbError(error);
            if (!data?.length) break;

            results.push(...data);
            if (data.length < step) break;
            from += step;
        }

        return json({ results });
    } catch (error) {
        console.error('quiz-results API error:', error);
        return json({
            error: 'Quiz results service error',
            code: 'QUIZ_RESULTS_SERVER_ERROR'
        }, { status: 500 });
    }
}

export async function POST(event) {
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

        if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > 5000) {
            return json({ error: 'rows must contain between 1 and 5000 records' }, { status: 400 });
        }

        const rows = body.rows.map(cleanResultRow);
        if (rows.some(row => !row)) {
            return json({ error: 'One or more quiz result rows are invalid' }, { status: 400 });
        }

        if (body.replace) {
            const { course_id: courseId, user_ids: userIds, types } = body.replace;
            if (!validUuid(courseId)
                || !Array.isArray(userIds) || userIds.length === 0 || userIds.some(id => !validUuid(id))
                || !Array.isArray(types) || types.length === 0 || types.some(type => !['pre', 'post'].includes(type))) {
                return json({ error: 'Invalid replace filter' }, { status: 400 });
            }

            const { error: deleteError } = await supabase
                .from('student_quiz_results')
                .delete()
                .eq('course_id', courseId)
                .in('type', [...new Set(types)])
                .in('user_id', [...new Set(userIds)]);

            if (deleteError) return dbError(deleteError);
        }

        const { data, error } = await supabase
            .from('student_quiz_results')
            .insert(rows)
            .select('id');

        if (error) return dbError(error);
        return json({ success: true, inserted: data?.length || rows.length });
    } catch (error) {
        console.error('quiz-results POST error:', error);
        return json({ error: 'Quiz results service error', code: 'QUIZ_RESULTS_SERVER_ERROR' }, { status: 500 });
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

        const score = Number(body.score);
        if (!validUuid(body.id) || !Number.isFinite(score) || score < 0 || score > 100 || typeof body.passed !== 'boolean') {
            return json({ error: 'Invalid quiz result update' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('student_quiz_results')
            .update({ score, passed: body.passed })
            .eq('id', body.id)
            .select('id')
            .maybeSingle();

        if (error) return dbError(error);
        if (!data) return json({ error: 'Quiz result not found' }, { status: 404 });
        return json({ success: true });
    } catch (error) {
        console.error('quiz-results PATCH error:', error);
        return json({ error: 'Quiz results service error', code: 'QUIZ_RESULTS_SERVER_ERROR' }, { status: 500 });
    }
}

export async function DELETE(event) {
    try {
        const { url, platform } = event;
        const supabase = serviceClient(platform);
        if (!supabase) return unavailable();

        const admin = await requireAdmin(event, supabase);
        if (!admin) return json({ error: 'Unauthorized' }, { status: 401 });

        const id = url.searchParams.get('id');
        if (!validUuid(id)) return json({ error: 'Invalid quiz result id' }, { status: 400 });

        const { error } = await supabase.from('student_quiz_results').delete().eq('id', id);
        if (error) return dbError(error);
        return json({ success: true });
    } catch (error) {
        console.error('quiz-results DELETE error:', error);
        return json({ error: 'Quiz results service error', code: 'QUIZ_RESULTS_SERVER_ERROR' }, { status: 500 });
    }
}
