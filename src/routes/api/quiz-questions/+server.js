import { json } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';

function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export async function GET(event) {
    try {
        const userId = await getRequestUserId(event);
        if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

        const courseId = event.url.searchParams.get('course_id');
        const review = event.url.searchParams.get('review') === '1';
        const quizType = event.url.searchParams.get('type');
        if (!validUuid(courseId)) return json({ error: 'Invalid course_id' }, { status: 400 });
        if (review && !['pre', 'post'].includes(quizType)) {
            return json({ error: 'Invalid quiz type' }, { status: 400 });
        }

        const client = serviceClient(event.platform);
        if (!client) return json({ error: 'Quiz service unavailable' }, { status: 503 });

        if (review) {
            const [questionsResult, attemptResult] = await Promise.all([
                client.from('quiz_questions')
                    .select('id, course_id, question, question_en, options, correct_answer, explanation, sort_order, image_url')
                    .eq('course_id', courseId),
                client.from('student_quiz_results')
                    .select('answers, question_ids')
                    .eq('user_id', userId)
                    .eq('course_id', courseId)
                    .eq('type', quizType)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle()
            ]);

            if (questionsResult.error) return json({ error: questionsResult.error.message }, { status: 400 });
            if (attemptResult.error) return json({ error: attemptResult.error.message }, { status: 400 });
            if (!attemptResult.data) return json({ error: 'Quiz attempt not found' }, { status: 404 });

            const questionsById = new Map(
                (questionsResult.data || []).map(question => [String(question.id), question])
            );
            const questions = (attemptResult.data.question_ids || [])
                .map(questionId => questionsById.get(String(questionId)))
                .filter(Boolean)
                .map(question => ({ ...question, answer: question.correct_answer }));

            if (questions.length !== (attemptResult.data.question_ids || []).length) {
                return json({ error: 'Quiz questions have changed since this attempt' }, { status: 409 });
            }

            return json({
                questions,
                answers: attemptResult.data.answers || []
            }, {
                headers: { 'Cache-Control': 'private, no-store' }
            });
        }

        const { data, error } = await client.from('quiz_questions')
            .select('id, course_id, question, question_en, options, sort_order, image_url')
            .eq('course_id', courseId)
            .order('sort_order', { ascending: true })
            .order('id', { ascending: true });

        if (error) return json({ error: error.message, code: error.code }, { status: 400 });
        return json({ questions: data || [] }, {
            headers: { 'Cache-Control': 'private, max-age=300' }
        });
    } catch (error) {
        console.error('quiz-questions API error:', error);
        return json({ error: 'Unable to load quiz questions' }, { status: 500 });
    }
}
