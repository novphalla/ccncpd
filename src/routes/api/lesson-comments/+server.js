import { json as kitJson } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';

const ADMIN_ROLES = new Set(['admin', 'owner']);
const REPORT_REASONS = new Set(['spam', 'harassment', 'privacy', 'misinformation', 'other']);
const COMMENT_SELECT = `
    id,
    lesson_id,
    course_id,
    author_id,
    parent_id,
    body,
    status,
    edited_at,
    created_at,
    updated_at,
    author:users!lesson_comments_author_id_fkey(id, full_name, name_latin, avatar_url, role)
`;

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

function cleanBody(value) {
    return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function unavailable() {
    return json({
        error: 'SUPABASE_SERVICE_ROLE_KEY is not configured',
        code: 'SERVICE_ROLE_KEY_MISSING'
    }, { status: 503 });
}

function dbError(error, status = 400) {
    console.error('lesson-comments database error:', error);
    return json({ error: 'Unable to process lesson discussion', code: error.code }, { status });
}

function serverError(error) {
    console.error('lesson-comments API error:', error);
    return json({
        error: 'Lesson discussion service error',
        code: 'LESSON_COMMENTS_SERVER_ERROR'
    }, { status: 500 });
}

async function requestBody(request) {
    try {
        return await request.json();
    } catch {
        return null;
    }
}

async function requireActor(event, supabase) {
    const userId = await getRequestUserId(event);
    if (!validUuid(userId)) return null;

    const { data, error } = await supabase
        .from('users')
        .select('id, full_name, name_latin, avatar_url, role')
        .eq('id', userId)
        .maybeSingle();

    return error ? null : data;
}

async function requireLessonAccess(supabase, actor, lessonId, suppliedCourseId = null) {
    if (!validUuid(lessonId)) return { error: 'Invalid lesson_id', status: 400 };
    if (suppliedCourseId && !validUuid(suppliedCourseId)) {
        return { error: 'Invalid course_id', status: 400 };
    }

    const { data: lesson, error: lessonError } = await supabase
        .from('lessons')
        .select('id, course_id')
        .eq('id', lessonId)
        .maybeSingle();

    if (lessonError) return { dbError: lessonError };
    if (!lesson) return { error: 'Lesson not found', status: 404 };
    if (suppliedCourseId && lesson.course_id !== suppliedCourseId) {
        return { error: 'Lesson does not belong to this course', status: 400 };
    }

    const { data: course, error: courseError } = await supabase
        .from('courses')
        .select('id, is_published')
        .eq('id', lesson.course_id)
        .maybeSingle();

    if (courseError) return { dbError: courseError };
    if (!course) return { error: 'Course not found', status: 404 };
    if (!course.is_published && !ADMIN_ROLES.has(actor.role)) {
        return { error: 'Course discussion is not available', status: 403 };
    }

    return { lesson, course };
}

function accessError(access) {
    if (access.dbError) return dbError(access.dbError);
    if (access.error) return json({ error: access.error }, { status: access.status });
    return null;
}

function presentComment(comment, actor, reportedIds = new Set(), reportCounts = new Map()) {
    const isAdmin = ADMIN_ROLES.has(actor.role);
    const isAuthor = comment.author_id === actor.id;
    const isVisible = comment.status === 'visible';

    return {
        ...comment,
        body: isVisible || isAdmin ? comment.body : null,
        can_edit: isAuthor && isVisible,
        can_delete: isAuthor || isAdmin,
        can_moderate: isAdmin,
        reported_by_me: reportedIds.has(comment.id),
        report_count: isAdmin ? (reportCounts.get(comment.id) || 0) : 0
    };
}

async function loadComment(supabase, commentId) {
    if (!validUuid(commentId)) return { data: null, error: null };
    return supabase
        .from('lesson_comments')
        .select(COMMENT_SELECT)
        .eq('id', commentId)
        .maybeSingle();
}

async function writeModerationLog(supabase, actor, action, commentId) {
    const { error } = await supabase.from('admin_logs').insert({
        admin_id: actor.id,
        action,
        details: `Lesson comment ${commentId}`
    });
    if (error) console.warn('Unable to write lesson comment moderation log:', error.message);
}

export async function GET(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return unavailable();

        const actor = await requireActor(event, supabase);
        if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });

        const lessonId = event.url.searchParams.get('lesson_id');
        const access = await requireLessonAccess(supabase, actor, lessonId);
        const denied = accessError(access);
        if (denied) return denied;

        const { data: comments, error } = await supabase
            .from('lesson_comments')
            .select(COMMENT_SELECT)
            .eq('lesson_id', access.lesson.id)
            .order('created_at', { ascending: true })
            .limit(200);

        if (error) return dbError(error);

        const commentIds = (comments || []).map(comment => comment.id);
        let reportedIds = new Set();
        let reportCounts = new Map();
        if (commentIds.length > 0) {
            let reportsQuery = supabase
                .from('lesson_comment_reports')
                .select('comment_id, reporter_id, status')
                .in('comment_id', commentIds);

            if (!ADMIN_ROLES.has(actor.role)) reportsQuery = reportsQuery.eq('reporter_id', actor.id);
            const { data: reports, error: reportsError } = await reportsQuery;

            if (reportsError) return dbError(reportsError);
            reportedIds = new Set((reports || [])
                .filter(report => report.reporter_id === actor.id)
                .map(report => report.comment_id));
            if (ADMIN_ROLES.has(actor.role)) {
                for (const report of reports || []) {
                    if (report.status !== 'pending') continue;
                    reportCounts.set(report.comment_id, (reportCounts.get(report.comment_id) || 0) + 1);
                }
            }
        }

        return json({
            comments: (comments || []).map(comment => presentComment(comment, actor, reportedIds, reportCounts)),
            can_moderate: ADMIN_ROLES.has(actor.role)
        });
    } catch (error) {
        return serverError(error);
    }
}

export async function POST(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return unavailable();

        const actor = await requireActor(event, supabase);
        if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });

        const body = await requestBody(event.request);
        if (!body) return json({ error: 'Invalid request body' }, { status: 400 });

        if (body.action === 'report') {
            if (!validUuid(body.comment_id)) {
                return json({ error: 'Invalid comment_id' }, { status: 400 });
            }

            const reason = String(body.reason || 'other').trim();
            const details = String(body.details || '').trim().slice(0, 500) || null;
            if (!REPORT_REASONS.has(reason)) {
                return json({ error: 'Invalid report reason' }, { status: 400 });
            }

            const { data: comment, error: commentError } = await loadComment(supabase, body.comment_id);
            if (commentError) return dbError(commentError);
            if (!comment || comment.status !== 'visible') {
                return json({ error: 'Comment not found' }, { status: 404 });
            }
            if (comment.author_id === actor.id) {
                return json({ error: 'You cannot report your own comment' }, { status: 400 });
            }

            const access = await requireLessonAccess(supabase, actor, comment.lesson_id, comment.course_id);
            const denied = accessError(access);
            if (denied) return denied;

            const { error } = await supabase.from('lesson_comment_reports').upsert({
                comment_id: comment.id,
                reporter_id: actor.id,
                reason,
                details,
                status: 'pending'
            }, { onConflict: 'comment_id,reporter_id', ignoreDuplicates: true });

            if (error) return dbError(error);
            return json({ success: true });
        }

        const lessonId = body.lesson_id;
        const courseId = body.course_id;
        const commentBody = cleanBody(body.body);
        const parentId = body.parent_id || null;

        if (commentBody.length < 1 || commentBody.length > 2000) {
            return json({ error: 'Comment must contain between 1 and 2000 characters' }, { status: 400 });
        }
        if (parentId && !validUuid(parentId)) {
            return json({ error: 'Invalid parent_id' }, { status: 400 });
        }

        const access = await requireLessonAccess(supabase, actor, lessonId, courseId);
        const denied = accessError(access);
        if (denied) return denied;

        if (parentId) {
            const { data: parent, error: parentError } = await supabase
                .from('lesson_comments')
                .select('id, lesson_id, course_id, parent_id, status')
                .eq('id', parentId)
                .maybeSingle();

            if (parentError) return dbError(parentError);
            if (!parent || parent.status !== 'visible' || parent.parent_id
                || parent.lesson_id !== access.lesson.id || parent.course_id !== access.course.id) {
                return json({ error: 'Reply target is unavailable' }, { status: 400 });
            }
        }

        const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
        const { count, error: countError } = await supabase
            .from('lesson_comments')
            .select('id', { count: 'exact', head: true })
            .eq('author_id', actor.id)
            .gte('created_at', oneMinuteAgo);

        if (countError) return dbError(countError);
        if ((count || 0) >= 8) {
            return json({ error: 'Please wait before posting more comments' }, { status: 429 });
        }

        const { data: comment, error } = await supabase
            .from('lesson_comments')
            .insert({
                lesson_id: access.lesson.id,
                course_id: access.course.id,
                author_id: actor.id,
                parent_id: parentId,
                body: commentBody
            })
            .select(COMMENT_SELECT)
            .single();

        if (error) return dbError(error);
        return json({ comment: presentComment(comment, actor) }, { status: 201 });
    } catch (error) {
        return serverError(error);
    }
}

export async function PATCH(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return unavailable();

        const actor = await requireActor(event, supabase);
        if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });

        const body = await requestBody(event.request);
        if (!body || !validUuid(body.comment_id)) {
            return json({ error: 'Invalid request body' }, { status: 400 });
        }

        const { data: existing, error: existingError } = await loadComment(supabase, body.comment_id);
        if (existingError) return dbError(existingError);
        if (!existing) return json({ error: 'Comment not found' }, { status: 404 });

        const access = await requireLessonAccess(supabase, actor, existing.lesson_id, existing.course_id);
        const denied = accessError(access);
        if (denied) return denied;

        if (body.action === 'moderate') {
            if (!ADMIN_ROLES.has(actor.role)) return json({ error: 'Forbidden' }, { status: 403 });
            const status = String(body.status || '');
            if (!['visible', 'hidden'].includes(status) || existing.status === 'deleted') {
                return json({ error: 'Invalid moderation status' }, { status: 400 });
            }

            const { data: comment, error } = await supabase
                .from('lesson_comments')
                .update({
                    status,
                    moderated_at: new Date().toISOString(),
                    moderated_by: actor.id
                })
                .eq('id', existing.id)
                .select(COMMENT_SELECT)
                .single();

            if (error) return dbError(error);
            await supabase
                .from('lesson_comment_reports')
                .update({
                    status: 'reviewed',
                    reviewed_at: new Date().toISOString(),
                    reviewed_by: actor.id
                })
                .eq('comment_id', existing.id)
                .eq('status', 'pending');
            await writeModerationLog(supabase, actor, `lesson_comment_${status}`, existing.id);
            return json({ comment: presentComment(comment, actor) });
        }

        if (existing.author_id !== actor.id || existing.status !== 'visible') {
            return json({ error: 'Forbidden' }, { status: 403 });
        }

        const commentBody = cleanBody(body.body);
        if (commentBody.length < 1 || commentBody.length > 2000) {
            return json({ error: 'Comment must contain between 1 and 2000 characters' }, { status: 400 });
        }

        const { data: comment, error } = await supabase
            .from('lesson_comments')
            .update({ body: commentBody, edited_at: new Date().toISOString() })
            .eq('id', existing.id)
            .select(COMMENT_SELECT)
            .single();

        if (error) return dbError(error);
        return json({ comment: presentComment(comment, actor) });
    } catch (error) {
        return serverError(error);
    }
}

export async function DELETE(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return unavailable();

        const actor = await requireActor(event, supabase);
        if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });

        const commentId = event.url.searchParams.get('comment_id');
        if (!validUuid(commentId)) return json({ error: 'Invalid comment_id' }, { status: 400 });

        const { data: existing, error: existingError } = await loadComment(supabase, commentId);
        if (existingError) return dbError(existingError);
        if (!existing) return json({ error: 'Comment not found' }, { status: 404 });

        const isAdmin = ADMIN_ROLES.has(actor.role);
        if (existing.author_id !== actor.id && !isAdmin) {
            return json({ error: 'Forbidden' }, { status: 403 });
        }

        const { error } = await supabase
            .from('lesson_comments')
            .update({
                body: '',
                status: 'deleted',
                moderated_at: isAdmin ? new Date().toISOString() : null,
                moderated_by: isAdmin ? actor.id : null
            })
            .eq('id', existing.id);

        if (error) return dbError(error);
        if (isAdmin && existing.author_id !== actor.id) {
            await supabase
                .from('lesson_comment_reports')
                .update({
                    status: 'reviewed',
                    reviewed_at: new Date().toISOString(),
                    reviewed_by: actor.id
                })
                .eq('comment_id', existing.id)
                .eq('status', 'pending');
            await writeModerationLog(supabase, actor, 'lesson_comment_deleted', existing.id);
        }

        return json({ success: true });
    } catch (error) {
        return serverError(error);
    }
}
