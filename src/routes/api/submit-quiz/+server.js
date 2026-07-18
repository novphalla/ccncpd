import { json } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';

function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export async function POST(event) {
    try {
        const userId = await getRequestUserId(event);
        if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

        const contentLength = Number(event.request.headers.get('content-length') || 0);
        if (contentLength > 100_000) {
            return json({ error: 'Quiz submission is too large' }, { status: 413 });
        }

        let body;
        try {
            body = await event.request.json();
        } catch {
            return json({ error: 'Invalid request body' }, { status: 400 });
        }

        const validArrays = Array.isArray(body?.answers)
            && Array.isArray(body?.questionIds)
            && body.questionIds.length >= 1
            && body.questionIds.length <= 500
            && body.answers.length === body.questionIds.length
            && body.questionIds.every(validUuid)
            && body.answers.every(answer => Number.isInteger(answer) && answer >= 0 && answer <= 100);

        if (!validUuid(body?.courseId)
            || !validUuid(body?.attemptKey)
            || !['pre', 'post'].includes(body?.type)
            || !validArrays) {
            return json({ error: 'Invalid quiz submission' }, { status: 400 });
        }

        const client = serviceClient(event.platform);
        if (!client) return json({ error: 'Quiz service unavailable' }, { status: 503 });

        const { data, error } = await client.rpc('submit_quiz_and_update_xp', {
            p_user_id: userId,
            p_course_id: body.courseId,
            p_answers: body.answers,
            p_type: body.type,
            p_question_ids: body.questionIds,
            p_attempt_key: body.attemptKey
        });

        if (error) {
            const status = error.message?.startsWith('QUIZ_COOLDOWN:') ? 429
                : error.message === 'QUIZ_ALREADY_COMPLETED' ? 409
                : 400;
            return json({ error: error.message, code: error.code }, { status });
        }

        return json(data, {
            headers: { 'Cache-Control': 'private, no-store' }
        });
    } catch (error) {
        console.error('submit-quiz API error:', error);
        return json({ error: 'Unable to submit quiz' }, { status: 500 });
    }
}
