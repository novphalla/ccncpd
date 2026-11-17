import { json as kitJson } from '@sveltejs/kit';
import { getRequestUserId, serviceClient } from '$lib/server/requestAuth';
import { sendPushToUser } from '$lib/server/pushNotifications';

const ADMIN_ROLES = new Set(['admin', 'owner']);
const REPORT_REASONS = new Set(['spam', 'harassment', 'privacy', 'misinformation', 'other']);
const REACTION_TYPES = new Set(['like', 'love', 'helpful']);
const COMMENT_SELECT = `
    id,
    lesson_id,
    course_id,
    author_id,
    parent_id,
    reply_to_id,
    body,
    status,
    is_pinned,
    pinned_at,
    pinned_by,
    is_resolved,
    resolved_at,
    resolved_by,
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

function mentionedUserIds(value) {
    const ids = new Set();
    const expression = /@\[[^\]\n]{1,80}\]\(([0-9a-f-]{36})\)/gi;
    for (const match of String(value || '').matchAll(expression)) {
        if (validUuid(match[1])) ids.add(match[1].toLowerCase());
    }
    return [...ids].slice(0, 10);
}

function pushUrl(comment) {
    const params = new URLSearchParams({
        openDiscussion: '1',
        course_id: comment.course_id,
        lesson_id: comment.lesson_id,
        comment_id: comment.id
    });
    return `/?${params.toString()}`;
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

function presentComment(comment, actor, reportedIds = new Set(), reportCounts = new Map(), reactionCounts = new Map(), myReactions = new Map()) {
    const isAdmin = ADMIN_ROLES.has(actor.role);
    const isAuthor = comment.author_id === actor.id;
    const isVisible = comment.status === 'visible';

    return {
        ...comment,
        body: isVisible || isAdmin ? comment.body : null,
        can_edit: isAuthor && isVisible,
        can_delete: isAuthor || isAdmin,
        can_moderate: isAdmin,
        can_pin: isAdmin && isVisible && !comment.parent_id,
        can_resolve: isAdmin && isVisible && !comment.parent_id,
        can_view_history: Boolean(comment.edited_at) && (isAuthor || isAdmin),
        reported_by_me: reportedIds.has(comment.id),
        report_count: isAdmin ? (reportCounts.get(comment.id) || 0) : 0,
        reactions: reactionCounts.get(comment.id) || { like: 0, love: 0, helpful: 0 },
        my_reaction: myReactions.get(comment.id) || null
    };
}

async function loadReactionSummary(supabase, commentIds, actorId) {
    const counts = new Map();
    const mine = new Map();
    if (!commentIds.length) return { counts, mine, error: null };

    const { data, error } = await supabase
        .from('lesson_comment_reactions')
        .select('comment_id, user_id, reaction_type')
        .in('comment_id', commentIds);
    if (error) return { counts, mine, error };

    for (const reaction of data || []) {
        const current = counts.get(reaction.comment_id) || { like: 0, love: 0, helpful: 0 };
        current[reaction.reaction_type] = (current[reaction.reaction_type] || 0) + 1;
        counts.set(reaction.comment_id, current);
        if (reaction.user_id === actorId) mine.set(reaction.comment_id, reaction.reaction_type);
    }
    return { counts, mine, error: null };
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

async function createCommentNotifications(event, supabase, actor, comment, replyAuthorId = null, mentionIds = []) {
    const [subscriptionsResult, adminsResult] = await Promise.all([
        supabase
            .from('lesson_comment_subscriptions')
            .select('user_id')
            .eq('lesson_id', comment.lesson_id)
            .limit(500),
        supabase
            .from('users')
            .select('id')
            .in('role', ['admin', 'owner'])
            .neq('id', actor.id)
            .limit(100)
    ]);

    if (subscriptionsResult.error || adminsResult.error) {
        console.warn(
            'Unable to resolve lesson comment notification recipients:',
            subscriptionsResult.error?.message || adminsResult.error?.message
        );
        return;
    }

    const recipientTypes = new Map();
    for (const subscription of subscriptionsResult.data || []) {
        if (subscription.user_id !== actor.id) recipientTypes.set(subscription.user_id, 'lesson_comment');
    }
    for (const admin of adminsResult.data || []) {
        if (!recipientTypes.has(admin.id)) recipientTypes.set(admin.id, 'lesson_comment');
    }
    if (replyAuthorId && replyAuthorId !== actor.id) {
        recipientTypes.set(replyAuthorId, 'reply');
    }
    for (const mentionedId of mentionIds) {
        if (mentionedId !== actor.id) recipientTypes.set(mentionedId, 'mention');
    }

    const notifications = [...recipientTypes.entries()].map(([userId, notificationType]) => ({
        user_id: userId,
        actor_id: actor.id,
        comment_id: comment.id,
        lesson_id: comment.lesson_id,
        course_id: comment.course_id,
        notification_type: notificationType
    }));

    if (notifications.length === 0) return;

    const { error } = await supabase
        .from('lesson_comment_notifications')
        .upsert(notifications, { onConflict: 'user_id,comment_id', ignoreDuplicates: true });

    if (error) {
        console.warn('Unable to create lesson comment notifications:', error.message);
        return;
    }

    const actorName = actor.full_name || actor.name_latin || 'CCN-CPD member';
    const preview = String(comment.body || '').replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1').slice(0, 120);
    await Promise.allSettled([...recipientTypes.entries()].slice(0, 50).map(([userId, notificationType]) =>
        sendPushToUser({
            platform: event.platform,
            supabase,
            userId,
            title: notificationType === 'mention' ? `${actorName} mentioned you` : `${actorName} commented`,
            body: preview,
            url: pushUrl(comment),
            tag: `lesson-comment-${comment.id}`
        })
    ));
}

export async function GET(event) {
    try {
        const supabase = serviceClient(event.platform);
        if (!supabase) return unavailable();

        const actor = await requireActor(event, supabase);
        if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });

        const historyCommentId = event.url.searchParams.get('history_comment_id');
        if (historyCommentId !== null) {
            const { data: comment, error: commentError } = await loadComment(supabase, historyCommentId);
            if (commentError) return dbError(commentError);
            if (!comment) return json({ error: 'Comment not found' }, { status: 404 });
            const access = await requireLessonAccess(supabase, actor, comment.lesson_id, comment.course_id);
            const denied = accessError(access);
            if (denied) return denied;
            if (comment.author_id !== actor.id && !ADMIN_ROLES.has(actor.role)) {
                return json({ error: 'Forbidden' }, { status: 403 });
            }
            const { data: edits, error } = await supabase
                .from('lesson_comment_edits')
                .select('id, previous_body, new_body, edited_at')
                .eq('comment_id', comment.id)
                .order('edited_at', { ascending: false })
                .limit(50);
            if (error) return dbError(error);
            return json({ edits: edits || [] });
        }

        const mentionSearch = event.url.searchParams.get('mention_search');
        if (mentionSearch !== null) {
            const lessonId = event.url.searchParams.get('lesson_id');
            const access = await requireLessonAccess(supabase, actor, lessonId);
            const denied = accessError(access);
            if (denied) return denied;
            const search = mentionSearch.trim().replace(/[,()%]/g, '').slice(0, 40);
            if (!search) return json({ users: [] });
            const { data: users, error } = await supabase
                .from('users')
                .select('id, full_name, name_latin, avatar_url, role')
                .or(`full_name.ilike.%${search}%,name_latin.ilike.%${search}%`)
                .neq('id', actor.id)
                .limit(8);
            if (error) return dbError(error);
            return json({ users: users || [] });
        }

        const requestedCourseIds = event.url.searchParams.get('course_ids');
        if (requestedCourseIds !== null) {
            const courseIds = [...new Set(requestedCourseIds
                .split(',')
                .map(value => value.trim())
                .filter(Boolean))];

            if (courseIds.length < 1 || courseIds.length > 100 || courseIds.some(id => !validUuid(id))) {
                return json({ error: 'Invalid course_ids' }, { status: 400 });
            }

            const { data: requestedCourses, error: coursesError } = await supabase
                .from('courses')
                .select('id, is_published')
                .in('id', courseIds);

            if (coursesError) return dbError(coursesError);

            const allowedCourseIds = (requestedCourses || [])
                .filter(course => course.is_published || ADMIN_ROLES.has(actor.role))
                .map(course => course.id);

            if (allowedCourseIds.length === 0) {
                return json({ courses: {}, lessons: {} });
            }

            const { data: unreadRows, error: unreadError } = await supabase.rpc(
                'get_lesson_comment_unread_counts',
                { p_user_id: actor.id, p_course_ids: allowedCourseIds }
            );

            if (unreadError) return dbError(unreadError);

            const courseCounts = {};
            const lessonCounts = {};
            for (const row of unreadRows || []) {
                const count = Number(row.unread_count) || 0;
                lessonCounts[row.lesson_id] = count;
                courseCounts[row.course_id] = (courseCounts[row.course_id] || 0) + count;
            }

            return json({ courses: courseCounts, lessons: lessonCounts });
        }

        const lessonId = event.url.searchParams.get('lesson_id');
        const access = await requireLessonAccess(supabase, actor, lessonId);
        const denied = accessError(access);
        if (denied) return denied;

        const limit = Math.min(50, Math.max(10, Number(event.url.searchParams.get('limit')) || 20));
        const before = event.url.searchParams.get('before');
        const focusCommentId = event.url.searchParams.get('focus_comment_id');
        let parentsQuery = supabase
            .from('lesson_comments')
            .select(COMMENT_SELECT, { count: 'exact' })
            .eq('lesson_id', access.lesson.id)
            .is('parent_id', null)
            .order('is_pinned', { ascending: false })
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(limit + 1);

        if (before) {
            const beforeDate = new Date(before);
            if (Number.isNaN(beforeDate.getTime())) return json({ error: 'Invalid pagination cursor' }, { status: 400 });
            parentsQuery = parentsQuery.lt('created_at', beforeDate.toISOString());
        }

        const { data: parentRows, error, count: totalThreads } = await parentsQuery;

        if (error) return dbError(error);

        const hasMore = (parentRows || []).length > limit;
        let parents = (parentRows || []).slice(0, limit);

        if (!before && validUuid(focusCommentId) && !parents.some(comment => comment.id === focusCommentId)) {
            const { data: focused } = await supabase
                .from('lesson_comments')
                .select(COMMENT_SELECT)
                .eq('id', focusCommentId)
                .eq('lesson_id', access.lesson.id)
                .maybeSingle();
            if (focused) {
                const rootId = focused.parent_id || focused.id;
                if (!parents.some(comment => comment.id === rootId)) {
                    const { data: root } = await supabase
                        .from('lesson_comments')
                        .select(COMMENT_SELECT)
                        .eq('id', rootId)
                        .maybeSingle();
                    if (root) parents = [root, ...parents];
                }
            }
        }

        const parentIds = parents.map(comment => comment.id);
        let replies = [];
        if (parentIds.length) {
            const { data: replyRows, error: repliesError } = await supabase
                .from('lesson_comments')
                .select(COMMENT_SELECT)
                .in('parent_id', parentIds)
                .order('created_at', { ascending: true })
                .limit(1000);
            if (repliesError) return dbError(repliesError);
            replies = replyRows || [];
        }

        const comments = [...parents, ...replies];

        const commentIds = (comments || []).map(comment => comment.id);
        let reportedIds = new Set();
        let reportCounts = new Map();
        const reactionSummary = await loadReactionSummary(supabase, commentIds, actor.id);
        if (reactionSummary.error) return dbError(reactionSummary.error);
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

        const { data: subscription, error: subscriptionError } = await supabase
            .from('lesson_comment_subscriptions')
            .select('user_id')
            .eq('user_id', actor.id)
            .eq('lesson_id', access.lesson.id)
            .maybeSingle();
        if (subscriptionError) return dbError(subscriptionError);

        return json({
            comments: (comments || []).map(comment => presentComment(
                comment,
                actor,
                reportedIds,
                reportCounts,
                reactionSummary.counts,
                reactionSummary.mine
            )),
            can_moderate: ADMIN_ROLES.has(actor.role),
            subscribed: Boolean(subscription),
            has_more: hasMore,
            next_cursor: hasMore && parents.length ? parents[parents.length - 1].created_at : null,
            total_threads: totalThreads || 0
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

        if (body.action === 'mark_read') {
            const access = await requireLessonAccess(supabase, actor, body.lesson_id, body.course_id);
            const denied = accessError(access);
            if (denied) return denied;

            const now = new Date();
            const suppliedSeenAt = new Date(body.seen_at || now.toISOString());
            const lastReadAt = Number.isNaN(suppliedSeenAt.getTime()) || suppliedSeenAt > now
                ? now.toISOString()
                : suppliedSeenAt.toISOString();

            const { error } = await supabase.from('lesson_comment_reads').upsert({
                user_id: actor.id,
                lesson_id: access.lesson.id,
                last_read_at: lastReadAt,
                updated_at: now.toISOString()
            }, { onConflict: 'user_id,lesson_id' });

            if (error) return dbError(error);
            return json({
                success: true,
                course_id: access.course.id,
                lesson_id: access.lesson.id,
                last_read_at: lastReadAt
            });
        }

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

        if (body.action === 'reaction') {
            if (!validUuid(body.comment_id) || !REACTION_TYPES.has(body.reaction_type)) {
                return json({ error: 'Invalid reaction' }, { status: 400 });
            }

            const { data: comment, error: commentError } = await loadComment(supabase, body.comment_id);
            if (commentError) return dbError(commentError);
            if (!comment || comment.status !== 'visible') return json({ error: 'Comment not found' }, { status: 404 });

            const access = await requireLessonAccess(supabase, actor, comment.lesson_id, comment.course_id);
            const denied = accessError(access);
            if (denied) return denied;

            const { data: existing, error: existingError } = await supabase
                .from('lesson_comment_reactions')
                .select('reaction_type')
                .eq('comment_id', comment.id)
                .eq('user_id', actor.id)
                .maybeSingle();
            if (existingError) return dbError(existingError);

            if (existing?.reaction_type === body.reaction_type) {
                const { error } = await supabase
                    .from('lesson_comment_reactions')
                    .delete()
                    .eq('comment_id', comment.id)
                    .eq('user_id', actor.id);
                if (error) return dbError(error);
            } else {
                const { error } = await supabase.from('lesson_comment_reactions').upsert({
                    comment_id: comment.id,
                    user_id: actor.id,
                    reaction_type: body.reaction_type
                }, { onConflict: 'comment_id,user_id' });
                if (error) return dbError(error);
            }

            const summary = await loadReactionSummary(supabase, [comment.id], actor.id);
            if (summary.error) return dbError(summary.error);
            return json({
                comment_id: comment.id,
                reactions: summary.counts.get(comment.id) || { like: 0, love: 0, helpful: 0 },
                my_reaction: summary.mine.get(comment.id) || null
            });
        }

        if (body.action === 'subscription') {
            const access = await requireLessonAccess(supabase, actor, body.lesson_id, body.course_id);
            const denied = accessError(access);
            if (denied) return denied;
            const subscribed = body.subscribed === true;
            const result = subscribed
                ? await supabase.from('lesson_comment_subscriptions').upsert({
                    user_id: actor.id,
                    lesson_id: access.lesson.id,
                    course_id: access.course.id
                }, { onConflict: 'user_id,lesson_id' })
                : await supabase.from('lesson_comment_subscriptions')
                    .delete()
                    .eq('user_id', actor.id)
                    .eq('lesson_id', access.lesson.id);
            if (result.error) return dbError(result.error);
            return json({ subscribed });
        }

        const lessonId = body.lesson_id;
        const courseId = body.course_id;
        const commentBody = cleanBody(body.body);
        let parentId = body.parent_id || null;
        let replyToId = null;

        if (commentBody.length < 1 || commentBody.length > 2000) {
            return json({ error: 'Comment must contain between 1 and 2000 characters' }, { status: 400 });
        }
        if (parentId && !validUuid(parentId)) {
            return json({ error: 'Invalid parent_id' }, { status: 400 });
        }

        const access = await requireLessonAccess(supabase, actor, lessonId, courseId);
        const denied = accessError(access);
        if (denied) return denied;

        let parentAuthorId = null;
        if (parentId) {
            const { data: parent, error: parentError } = await supabase
                .from('lesson_comments')
                .select('id, lesson_id, course_id, author_id, parent_id, status')
                .eq('id', parentId)
                .maybeSingle();

            if (parentError) return dbError(parentError);
            if (!parent || parent.status !== 'visible'
                || parent.lesson_id !== access.lesson.id || parent.course_id !== access.course.id) {
                return json({ error: 'Reply target is unavailable' }, { status: 400 });
            }
            replyToId = parent.id;
            parentId = parent.parent_id || parent.id;
            parentAuthorId = parent.author_id;
        }

        const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
        const { data: recentComments, count, error: countError } = await supabase
            .from('lesson_comments')
            .select('id, body, created_at', { count: 'exact' })
            .eq('author_id', actor.id)
            .gte('created_at', oneMinuteAgo)
            .order('created_at', { ascending: false })
            .limit(6);

        if (countError) return dbError(countError);
        if ((count || 0) >= 5) {
            return json({ error: 'Please wait before posting more comments' }, { status: 429 });
        }
        const latest = recentComments?.[0];
        if (latest && Date.now() - new Date(latest.created_at).getTime() < 2_000) {
            return json({ error: 'Please wait before posting more comments' }, { status: 429 });
        }
        if ((recentComments || []).some(item => cleanBody(item.body).toLocaleLowerCase() === commentBody.toLocaleLowerCase())) {
            return json({ error: 'Duplicate comment' }, { status: 409 });
        }
        if ((commentBody.match(/https?:\/\//gi) || []).length > 3) {
            return json({ error: 'Too many links in one comment' }, { status: 400 });
        }

        const oneDayAgo = new Date(Date.now() - 86_400_000).toISOString();
        const { count: dailyCount, error: dailyCountError } = await supabase
            .from('lesson_comments')
            .select('id', { count: 'exact', head: true })
            .eq('author_id', actor.id)
            .gte('created_at', oneDayAgo);
        if (dailyCountError) return dbError(dailyCountError);
        if ((dailyCount || 0) >= 100) {
            return json({ error: 'Daily comment limit reached' }, { status: 429 });
        }

        const mentionIds = mentionedUserIds(commentBody).filter(id => id !== actor.id);
        let validMentionIds = [];
        if (mentionIds.length) {
            const { data: mentionedUsers, error: mentionError } = await supabase
                .from('users')
                .select('id')
                .in('id', mentionIds);
            if (mentionError) return dbError(mentionError);
            validMentionIds = (mentionedUsers || []).map(user => user.id);
        }

        const { data: comment, error } = await supabase
            .from('lesson_comments')
            .insert({
                lesson_id: access.lesson.id,
                course_id: access.course.id,
                author_id: actor.id,
                parent_id: parentId,
                reply_to_id: replyToId,
                body: commentBody
            })
            .select(COMMENT_SELECT)
            .single();

        if (error) return dbError(error);
        if (validMentionIds.length) {
            const { error: mentionInsertError } = await supabase.from('lesson_comment_mentions').insert(
                validMentionIds.map(mentionedUserId => ({ comment_id: comment.id, mentioned_user_id: mentionedUserId }))
            );
            if (mentionInsertError) console.warn('Unable to store comment mentions:', mentionInsertError.message);
        }
        const { error: subscriptionError } = await supabase.from('lesson_comment_subscriptions').upsert({
            user_id: actor.id,
            lesson_id: access.lesson.id,
            course_id: access.course.id
        }, { onConflict: 'user_id,lesson_id' });
        if (subscriptionError) console.warn('Unable to auto-follow lesson discussion:', subscriptionError.message);
        await createCommentNotifications(event, supabase, actor, comment, parentAuthorId, validMentionIds);
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

        if (body.action === 'pin') {
            if (!ADMIN_ROLES.has(actor.role)) return json({ error: 'Forbidden' }, { status: 403 });
            if (existing.parent_id || existing.status !== 'visible') {
                return json({ error: 'Only visible top-level comments can be pinned' }, { status: 400 });
            }
            const pinned = body.pinned === true;
            const { data: comment, error } = await supabase
                .from('lesson_comments')
                .update({
                    is_pinned: pinned,
                    pinned_at: pinned ? new Date().toISOString() : null,
                    pinned_by: pinned ? actor.id : null
                })
                .eq('id', existing.id)
                .select(COMMENT_SELECT)
                .single();
            if (error) return dbError(error);
            await writeModerationLog(supabase, actor, pinned ? 'lesson_comment_pinned' : 'lesson_comment_unpinned', existing.id);
            return json({ comment: presentComment(comment, actor) });
        }

        if (body.action === 'resolve') {
            if (!ADMIN_ROLES.has(actor.role)) return json({ error: 'Forbidden' }, { status: 403 });
            if (existing.parent_id || existing.status !== 'visible') {
                return json({ error: 'Only visible top-level comments can be resolved' }, { status: 400 });
            }
            const resolved = body.resolved === true;
            const { data: comment, error } = await supabase
                .from('lesson_comments')
                .update({
                    is_resolved: resolved,
                    resolved_at: resolved ? new Date().toISOString() : null,
                    resolved_by: resolved ? actor.id : null
                })
                .eq('id', existing.id)
                .select(COMMENT_SELECT)
                .single();
            if (error) return dbError(error);
            await writeModerationLog(supabase, actor, resolved ? 'lesson_comment_resolved' : 'lesson_comment_reopened', existing.id);
            if (resolved && existing.author_id !== actor.id) {
                const { error: notificationError } = await supabase.from('lesson_comment_notifications').upsert({
                    user_id: existing.author_id,
                    actor_id: actor.id,
                    comment_id: existing.id,
                    lesson_id: existing.lesson_id,
                    course_id: existing.course_id,
                    notification_type: 'resolved',
                    read_at: null,
                    created_at: new Date().toISOString()
                }, { onConflict: 'user_id,comment_id' });
                if (notificationError) console.warn('Unable to create resolved notification:', notificationError.message);
                await sendPushToUser({
                    platform: event.platform,
                    supabase,
                    userId: existing.author_id,
                    title: 'Your lesson question was resolved',
                    body: existing.body.slice(0, 120),
                    url: pushUrl(existing),
                    tag: `lesson-comment-${existing.id}`
                });
            }
            return json({ comment: presentComment(comment, actor) });
        }

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
                    is_pinned: status === 'visible' ? existing.is_pinned : false,
                    pinned_at: status === 'visible' ? existing.pinned_at : null,
                    pinned_by: status === 'visible' ? existing.pinned_by : null,
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

        if (commentBody === existing.body) return json({ comment: presentComment(existing, actor) });

        const { error: historyError } = await supabase.from('lesson_comment_edits').insert({
            comment_id: existing.id,
            editor_id: actor.id,
            previous_body: existing.body,
            new_body: commentBody
        });
        if (historyError) return dbError(historyError);

        const { data: comment, error } = await supabase
            .from('lesson_comments')
            .update({ body: commentBody, edited_at: new Date().toISOString() })
            .eq('id', existing.id)
            .select(COMMENT_SELECT)
            .single();

        if (error) return dbError(error);
        const mentionIds = mentionedUserIds(commentBody).filter(id => id !== actor.id);
        const { error: clearMentionsError } = await supabase
            .from('lesson_comment_mentions')
            .delete()
            .eq('comment_id', existing.id);
        if (clearMentionsError) console.warn('Unable to refresh comment mentions:', clearMentionsError.message);
        if (mentionIds.length) {
            const { data: users } = await supabase.from('users').select('id').in('id', mentionIds);
            const validIds = (users || []).map(user => user.id);
            if (validIds.length) {
                const { error: mentionError } = await supabase.from('lesson_comment_mentions').insert(
                    validIds.map(mentionedUserId => ({ comment_id: existing.id, mentioned_user_id: mentionedUserId }))
                );
                if (mentionError) console.warn('Unable to refresh comment mentions:', mentionError.message);
            }
        }
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
                is_pinned: false,
                pinned_at: null,
                pinned_by: null,
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
