import { json as kitJson } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';

const ADMIN_ROLES = new Set(['admin', 'owner']);
const VALID_STATUSES = new Set(['pending', 'reviewed', 'dismissed', 'all']);
const VALID_ACTIONS = new Set(['dismiss', 'hide', 'delete']);

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

async function requestBody(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

async function requireAdmin(event, supabase) {
    const userId = await getRequestUserId(event);
    if (!validUuid(userId)) return null;

    const { data, error } = await supabase
        .from('users')
        .select('id, role, full_name')
        .eq('id', userId)
        .maybeSingle();

    return !error && data && ADMIN_ROLES.has(data.role) ? data : null;
}

function databaseError(error) {
    console.error('lesson-comment-reports database error:', error);
    return json({ error: 'Unable to process comment reports', code: error.code }, { status: 500 });
}

async function writeLog(supabase, admin, action, commentId, reportId) {
    const { error } = await supabase.from('admin_logs').insert({
        admin_id: admin.id,
        action,
        details: `Lesson comment ${commentId}; report ${reportId}`
    });
    if (error) console.warn('Unable to write comment report moderation log:', error.message);
}

export async function GET(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return json({ error: 'Moderation service is unavailable' }, { status: 503 });

        const admin = await requireAdmin(event, supabase);
        if (!admin) return json({ error: 'Forbidden' }, { status: 403 });

        const status = event.url.searchParams.get('status') || 'pending';
        if (!VALID_STATUSES.has(status)) return json({ error: 'Invalid status' }, { status: 400 });

        let reportsQuery = supabase
            .from('lesson_comment_reports')
            .select('id, comment_id, reporter_id, reason, details, status, reviewed_at, reviewed_by, created_at')
            .order('created_at', { ascending: false })
            .limit(150);
        if (status !== 'all') reportsQuery = reportsQuery.eq('status', status);

        const { data: reports, error } = await reportsQuery;
        if (error) return databaseError(error);

        const commentIds = [...new Set((reports || []).map(report => report.comment_id))];
        const { data: comments, error: commentsError } = commentIds.length
            ? await supabase
                .from('lesson_comments')
                .select('id, lesson_id, course_id, author_id, body, status, created_at')
                .in('id', commentIds)
            : { data: [], error: null };
        if (commentsError) return databaseError(commentsError);

        const userIds = [...new Set([
            ...(reports || []).flatMap(report => [report.reporter_id, report.reviewed_by].filter(Boolean)),
            ...(comments || []).map(comment => comment.author_id)
        ])];
        const lessonIds = [...new Set((comments || []).map(comment => comment.lesson_id))];
        const courseIds = [...new Set((comments || []).map(comment => comment.course_id))];

        const [usersResult, lessonsResult, coursesResult] = await Promise.all([
            userIds.length
                ? supabase.from('users').select('id, full_name, name_latin, avatar_url, role').in('id', userIds)
                : Promise.resolve({ data: [], error: null }),
            lessonIds.length
                ? supabase.from('lessons').select('id, title').in('id', lessonIds)
                : Promise.resolve({ data: [], error: null }),
            courseIds.length
                ? supabase.from('courses').select('id, title').in('id', courseIds)
                : Promise.resolve({ data: [], error: null })
        ]);

        const relatedError = usersResult.error || lessonsResult.error || coursesResult.error;
        if (relatedError) return databaseError(relatedError);

        const users = new Map((usersResult.data || []).map(item => [item.id, item]));
        const lessons = new Map((lessonsResult.data || []).map(item => [item.id, item]));
        const courses = new Map((coursesResult.data || []).map(item => [item.id, item]));
        const commentMap = new Map((comments || []).map(comment => [comment.id, {
            ...comment,
            author: users.get(comment.author_id) || null,
            lesson: lessons.get(comment.lesson_id) || null,
            course: courses.get(comment.course_id) || null
        }]));

        return json({
            reports: (reports || []).map(report => ({
                ...report,
                reporter: users.get(report.reporter_id) || null,
                reviewer: users.get(report.reviewed_by) || null,
                comment: commentMap.get(report.comment_id) || null
            }))
        });
    } catch (error) {
        console.error('lesson-comment-reports API error:', error);
        return json({ error: 'Moderation service error' }, { status: 500 });
    }
}

export async function PATCH(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return json({ error: 'Moderation service is unavailable' }, { status: 503 });

        const admin = await requireAdmin(event, supabase);
        if (!admin) return json({ error: 'Forbidden' }, { status: 403 });

        const body = await requestBody(event.request);
        if (!body || !validUuid(body.report_id) || !VALID_ACTIONS.has(body.action)) {
            return json({ error: 'Invalid request body' }, { status: 400 });
        }

        const { data: report, error: reportError } = await supabase
            .from('lesson_comment_reports')
            .select('id, comment_id, status')
            .eq('id', body.report_id)
            .maybeSingle();
        if (reportError) return databaseError(reportError);
        if (!report) return json({ error: 'Report not found' }, { status: 404 });

        const now = new Date().toISOString();

        if (body.action === 'dismiss') {
            const { error } = await supabase
                .from('lesson_comment_reports')
                .update({ status: 'dismissed', reviewed_at: now, reviewed_by: admin.id })
                .eq('id', report.id);
            if (error) return databaseError(error);
            await writeLog(supabase, admin, 'lesson_comment_report_dismissed', report.comment_id, report.id);
            return json({ success: true, status: 'dismissed' });
        }

        const { data: comment, error: commentError } = await supabase
            .from('lesson_comments')
            .select('id, status')
            .eq('id', report.comment_id)
            .maybeSingle();
        if (commentError) return databaseError(commentError);
        if (!comment) return json({ error: 'Comment not found' }, { status: 404 });
        if (comment.status !== 'visible') {
            return json({ error: 'Comment has already been moderated' }, { status: 409 });
        }

        const commentUpdate = body.action === 'delete'
            ? { body: '', status: 'deleted', moderated_at: now, moderated_by: admin.id }
            : { status: 'hidden', moderated_at: now, moderated_by: admin.id };

        const { error: updateError } = await supabase
            .from('lesson_comments')
            .update(commentUpdate)
            .eq('id', comment.id);
        if (updateError) return databaseError(updateError);

        const { error: reportsError } = await supabase
            .from('lesson_comment_reports')
            .update({ status: 'reviewed', reviewed_at: now, reviewed_by: admin.id })
            .eq('comment_id', comment.id)
            .eq('status', 'pending');
        if (reportsError) return databaseError(reportsError);

        await writeLog(
            supabase,
            admin,
            body.action === 'delete' ? 'lesson_comment_deleted' : 'lesson_comment_hidden',
            comment.id,
            report.id
        );

        return json({ success: true, status: 'reviewed', comment_status: commentUpdate.status });
    } catch (error) {
        console.error('lesson-comment-reports API error:', error);
        return json({ error: 'Moderation service error' }, { status: 500 });
    }
}
