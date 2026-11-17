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

function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function actorId(event) {
    const userId = await getRequestUserId(event);
    return validUuid(userId) ? userId : null;
}

function unavailable() {
    return json({ error: 'Notification service is unavailable' }, { status: 503 });
}

function databaseError(error) {
    console.error('lesson-notifications database error:', error);
    return json({ error: 'Unable to load notifications', code: error.code }, { status: 500 });
}

async function requestBody(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

export async function GET(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return unavailable();

        const userId = await actorId(event);
        if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

        if (event.url.searchParams.get('count_only') === '1') {
            const { count, error } = await supabase
                .from('lesson_comment_notifications')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId)
                .is('read_at', null);

            if (error) return databaseError(error);
            return json({ unread_count: count || 0 });
        }

        const [rowsResult, countResult] = await Promise.all([
            supabase
                .from('lesson_comment_notifications')
                .select('id, actor_id, comment_id, lesson_id, course_id, notification_type, read_at, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(60),
            supabase
                .from('lesson_comment_notifications')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', userId)
                .is('read_at', null)
        ]);

        if (rowsResult.error || countResult.error) return databaseError(rowsResult.error || countResult.error);
        const rows = rowsResult.data || [];

        const actorIds = [...new Set(rows.map(row => row.actor_id))];
        const commentIds = [...new Set(rows.map(row => row.comment_id))];
        const lessonIds = [...new Set(rows.map(row => row.lesson_id))];
        const courseIds = [...new Set(rows.map(row => row.course_id))];

        const [actorsResult, commentsResult, lessonsResult, coursesResult] = await Promise.all([
            actorIds.length
                ? supabase.from('users').select('id, full_name, name_latin, avatar_url').in('id', actorIds)
                : Promise.resolve({ data: [], error: null }),
            commentIds.length
                ? supabase.from('lesson_comments').select('id, body, status').in('id', commentIds)
                : Promise.resolve({ data: [], error: null }),
            lessonIds.length
                ? supabase.from('lessons').select('id, title').in('id', lessonIds)
                : Promise.resolve({ data: [], error: null }),
            courseIds.length
                ? supabase.from('courses').select('id, title').in('id', courseIds)
                : Promise.resolve({ data: [], error: null })
        ]);

        const relatedError = actorsResult.error || commentsResult.error || lessonsResult.error || coursesResult.error;
        if (relatedError) return databaseError(relatedError);

        const actors = new Map((actorsResult.data || []).map(item => [item.id, item]));
        const comments = new Map((commentsResult.data || []).map(item => [item.id, item]));
        const lessons = new Map((lessonsResult.data || []).map(item => [item.id, item]));
        const courses = new Map((coursesResult.data || []).map(item => [item.id, item]));

        const notifications = rows.map(row => ({
            ...row,
            actor: actors.get(row.actor_id) || null,
            comment: comments.get(row.comment_id) || null,
            lesson: lessons.get(row.lesson_id) || null,
            course: courses.get(row.course_id) || null
        }));

        return json({
            notifications,
            unread_count: countResult.count || 0
        });
    } catch (error) {
        console.error('lesson-notifications API error:', error);
        return json({ error: 'Notification service error' }, { status: 500 });
    }
}

export async function PATCH(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return unavailable();

        const userId = await actorId(event);
        if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

        const body = await requestBody(event.request);
        if (!body) return json({ error: 'Invalid request body' }, { status: 400 });

        let query = supabase
            .from('lesson_comment_notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('user_id', userId)
            .is('read_at', null);

        if (body.action !== 'mark_all_read') {
            if (!validUuid(body.notification_id)) {
                return json({ error: 'Invalid notification_id' }, { status: 400 });
            }
            query = query.eq('id', body.notification_id);
        }

        const { error } = await query;
        if (error) return databaseError(error);
        return json({ success: true });
    } catch (error) {
        console.error('lesson-notifications API error:', error);
        return json({ error: 'Notification service error' }, { status: 500 });
    }
}
