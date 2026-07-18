import { json } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';

function unavailable() {
    return json({
        error: 'SUPABASE_SERVICE_ROLE_KEY is not configured',
        code: 'SERVICE_ROLE_KEY_MISSING'
    }, { status: 503 });
}

function summarizeAttempts(rows) {
    const groups = new Map();
    for (const row of rows || []) {
        const key = `${row.course_id}:${row.type}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    }

    return [...groups.values()].map(group => {
        const latest = group[0];
        const latestPassed = group.find(attempt => attempt.passed);
        const passedAt = latestPassed ? new Date(latestPassed.created_at).getTime() : -Infinity;
        return {
            ...latest,
            fail_count: group.filter(attempt =>
                !attempt.passed && new Date(attempt.created_at).getTime() > passedAt
            ).length,
            latest_passed_id: latestPassed?.id || null,
            latest_passed_at: latestPassed?.created_at || null
        };
    });
}

export async function GET(event) {
    try {
        const userId = await getRequestUserId(event);
        if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

        const supabase = serviceClient(event.platform);
        if (!supabase) return unavailable();

        let { data, error } = await supabase.rpc('get_quiz_attempt_summary', {
            p_user_id: userId
        });

        // Keeps an auto-deploy working while the matching DB migration is being applied.
        if (error && ['PGRST202', '42883'].includes(error.code)) {
            const fallback = await supabase
                .from('student_quiz_results')
                .select('id, course_id, passed, created_at, type')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(500);
            data = summarizeAttempts(fallback.data);
            error = fallback.error;
        }

        if (error) return json({ error: error.message, code: error.code }, { status: 400 });
        return json({ attempts: data || [] }, {
            headers: { 'Cache-Control': 'private, no-store' }
        });
    } catch (error) {
        console.error('my-quiz-results API error:', error);
        return json({
            error: 'Quiz history service error',
            code: 'MY_QUIZ_RESULTS_SERVER_ERROR'
        }, { status: 500 });
    }
}
