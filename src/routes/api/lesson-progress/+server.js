import { json as kitJson } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';

function json(body, init = {}) {
    return kitJson(body, {
        ...init,
        headers: {
            'Cache-Control': 'private, no-store',
            ...(init.headers || {})
        }
    });
}

function cleanId(value) {
    const id = String(value || '').trim();
    return id ? id : null;
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
    console.error('lesson-progress API error:', error);
    return json({
        error: 'Lesson progress service error',
        code: 'LESSON_PROGRESS_SERVER_ERROR'
    }, { status: 500 });
}

async function requireUserId(event) {
    const userId = await getRequestUserId(event);
    return cleanId(userId);
}

export async function GET(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return unavailable();

        const userId = await requireUserId(event);
        if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

        const lessonId = cleanId(event.url.searchParams.get('lesson_id'));
        if (!lessonId) return json({ error: 'Invalid lesson_id' }, { status: 400 });

        const { data, error } = await supabase
            .from('lesson_progress')
            .select('last_page, completed')
            .eq('user_id', userId)
            .eq('lesson_id', lessonId)
            .maybeSingle();

        if (error) return dbError(error);
        return json({ progress: data || null });
    } catch (error) {
        return serverError(error);
    }
}

export async function POST(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return unavailable();

        const userId = await requireUserId(event);
        if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

        let body;
        try {
            body = await event.request.json();
        } catch {
            return json({ error: 'Invalid request body' }, { status: 400 });
        }

        const lessonId = cleanId(body?.lesson_id);
        const courseId = cleanId(body?.course_id);
        const lastPage = Number(body?.last_page);

        if (!lessonId) return json({ error: 'Invalid lesson_id' }, { status: 400 });
        if (!courseId) return json({ error: 'Invalid course_id' }, { status: 400 });
        if (!Number.isInteger(lastPage) || lastPage < 1) {
            return json({ error: 'Invalid last_page' }, { status: 400 });
        }

        const payload = {
            user_id: userId,
            lesson_id: lessonId,
            course_id: courseId,
            last_page: lastPage,
            updated_at: new Date().toISOString()
        };

        if (typeof body.completed === 'boolean') {
            payload.completed = body.completed;
        }

        const { error } = await supabase
            .from('lesson_progress')
            .upsert(payload, { onConflict: 'user_id,lesson_id' });

        if (error) return dbError(error);
        return json({ success: true });
    } catch (error) {
        return serverError(error);
    }
}
