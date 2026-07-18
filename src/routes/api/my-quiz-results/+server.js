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

function unavailable() {
    return json({
        error: 'SUPABASE_SERVICE_ROLE_KEY is not configured',
        code: 'SERVICE_ROLE_KEY_MISSING'
    }, { status: 503 });
}

export async function GET({ request, platform }) {
    try {
        const supabase = serviceClient(platform);
        if (!supabase) return unavailable();

        const userId = request.headers.get('X-User-Id');
        if (!validUuid(userId)) return json({ error: 'Unauthorized' }, { status: 401 });

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('id')
            .eq('id', userId)
            .maybeSingle();

        if (userError) return json({ error: userError.message, code: userError.code }, { status: 400 });
        if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

        const { data, error } = await supabase
            .from('student_quiz_results')
            .select('id, course_id, passed, created_at, type')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(200);

        if (error) return json({ error: error.message, code: error.code }, { status: 400 });
        return json({ attempts: data || [] });
    } catch (error) {
        console.error('my-quiz-results API error:', error);
        return json({
            error: 'Quiz history service error',
            code: 'MY_QUIZ_RESULTS_SERVER_ERROR'
        }, { status: 500 });
    }
}