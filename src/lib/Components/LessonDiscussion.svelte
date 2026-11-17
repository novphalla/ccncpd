<script>
    import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';
    import {
        AlertCircleIcon,
        FlagIcon,
        LoaderCircleIcon,
        MessageCircleIcon,
        RefreshCwIcon,
        SearchIcon,
        SendIcon,
        XIcon
    } from 'lucide-svelte';
    import LessonCommentItem from './LessonCommentItem.svelte';

    export let lesson;
    export let course;
    export let currentUser;
    export let focusCommentId = null;

    const dispatch = createEventDispatcher();
    let comments = [];
    let loading = true;
    let refreshing = false;
    let submitting = false;
    let actionBusy = false;
    let errorMessage = '';
    let composer = '';
    let composerElement;
    let replyTo = null;
    let reportTarget = null;
    let reportReason = 'spam';
    let reportDetails = '';
    let activeLessonId = null;
    let refreshTimer;
    let searchTerm = '';
    let commentFilter = 'all';
    let sortMode = 'oldest';

    $: topLevelComments = comments.filter(comment => !comment.parent_id);
    $: filteredComments = topLevelComments
        .filter(comment => threadMatches(comment))
        .sort(compareComments);
    $: if (typeof window !== 'undefined' && lesson?.id && lesson.id !== activeLessonId) {
        activeLessonId = lesson.id;
        composer = '';
        replyTo = null;
        loadComments(true);
    }

    function repliesFor(commentId) {
        return comments.filter(comment => comment.parent_id === commentId);
    }

    function commentMatchesSearch(comment) {
        const query = searchTerm.trim().toLocaleLowerCase();
        if (!query) return true;
        return [comment.body, comment.author?.full_name, comment.author?.name_latin]
            .filter(Boolean)
            .some(value => String(value).toLocaleLowerCase().includes(query));
    }

    function isInstructor(comment) {
        return ['admin', 'owner'].includes(comment.author?.role);
    }

    function threadMatches(comment) {
        const thread = [comment, ...repliesFor(comment.id)];
        if (!thread.some(commentMatchesSearch)) return false;
        if (commentFilter === 'pinned') return comment.is_pinned;
        if (commentFilter === 'instructor') return thread.some(isInstructor);
        if (commentFilter === 'mine') return thread.some(item => item.author_id === currentUser?.id);
        return true;
    }

    function reactionTotal(comment) {
        return Object.values(comment.reactions || {}).reduce((total, value) => total + Number(value || 0), 0);
    }

    function threadReactionTotal(comment) {
        return [comment, ...repliesFor(comment.id)].reduce((total, item) => total + reactionTotal(item), 0);
    }

    function compareComments(left, right) {
        if (left.is_pinned !== right.is_pinned) return left.is_pinned ? -1 : 1;
        if (sortMode === 'popular') return threadReactionTotal(right) - threadReactionTotal(left);
        const difference = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
        return sortMode === 'newest' ? -difference : difference;
    }

    function apiError(payload, fallback) {
        const message = payload?.error || fallback;
        const translations = {
            Unauthorized: 'សូមចូលគណនីឡើងវិញ។',
            Forbidden: 'អ្នកមិនមានសិទ្ធិធ្វើសកម្មភាពនេះទេ។',
            'Please wait before posting more comments': 'អ្នកបានផ្ញើមតិញឹកញាប់ពេក។ សូមរង់ចាំបន្តិច។',
            'Course discussion is not available': 'ការពិភាក្សាសម្រាប់វគ្គនេះមិនទាន់បើកទេ។'
        };
        return translations[message] || message;
    }

    async function markCommentsRead() {
        if (!lesson?.id || lesson.id === 'fallback' || !course?.id || !currentUser) return;

        const latestCommentTime = comments.reduce((latest, comment) => {
            const createdAt = new Date(comment.created_at).getTime();
            return Number.isNaN(createdAt) ? latest : Math.max(latest, createdAt);
        }, 0);

        try {
            const response = await fetch('/api/lesson-comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    action: 'mark_read',
                    lesson_id: lesson.id,
                    course_id: course.id,
                    seen_at: latestCommentTime ? new Date(latestCommentTime).toISOString() : new Date().toISOString()
                })
            });

            if (!response.ok) return;
            dispatch('read', { lesson_id: lesson.id, course_id: course.id });
        } catch (error) {
            console.warn('Unable to mark lesson discussion as read:', error);
        }
    }

    async function loadComments(showLoader = false) {
        if (!lesson?.id || lesson.id === 'fallback' || !currentUser) return;
        if (showLoader) loading = true;
        else refreshing = true;

        try {
            const response = await fetch(`/api/lesson-comments?lesson_id=${encodeURIComponent(lesson.id)}`, {
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(apiError(payload, 'មិនអាចទាញយកមតិបានទេ។'));
            comments = payload.comments || [];
            errorMessage = '';
            dispatch('count', comments.filter(comment => comment.status === 'visible').length);
            await markCommentsRead();
            if (focusCommentId) {
                await tick();
                document.querySelector(`[data-comment-id="${focusCommentId}"]`)?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }
        } catch (error) {
            errorMessage = error.message || 'មិនអាចទាញយកមតិបានទេ។';
        } finally {
            loading = false;
            refreshing = false;
        }
    }

    async function submitComment() {
        const body = composer.trim();
        if (!body || submitting || !lesson?.id || !course?.id) return;
        submitting = true;
        errorMessage = '';

        try {
            const response = await fetch('/api/lesson-comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    lesson_id: lesson.id,
                    course_id: course.id,
                    body,
                    parent_id: replyTo?.id || null
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(apiError(payload, 'មិនអាចផ្ញើមតិបានទេ។'));
            comments = [...comments, payload.comment];
            composer = '';
            replyTo = null;
            dispatch('count', comments.filter(comment => comment.status === 'visible').length);
        } catch (error) {
            errorMessage = error.message || 'មិនអាចផ្ញើមតិបានទេ។';
        } finally {
            submitting = false;
        }
    }

    async function editComment(event) {
        if (actionBusy) return;
        actionBusy = true;
        errorMessage = '';
        const { comment, body } = event.detail;

        try {
            const response = await fetch('/api/lesson-comments', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ comment_id: comment.id, body })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(apiError(payload, 'មិនអាចកែមតិបានទេ។'));
            comments = comments.map(item => item.id === payload.comment.id ? payload.comment : item);
        } catch (error) {
            errorMessage = error.message || 'មិនអាចកែមតិបានទេ។';
        } finally {
            actionBusy = false;
        }
    }

    async function deleteComment(event) {
        const comment = event.detail;
        if (actionBusy || !confirm('តើអ្នកពិតជាចង់លុបមតិនេះមែនទេ?')) return;
        actionBusy = true;
        errorMessage = '';

        try {
            const response = await fetch(`/api/lesson-comments?comment_id=${encodeURIComponent(comment.id)}`, {
                method: 'DELETE',
                credentials: 'same-origin'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(apiError(payload, 'មិនអាចលុបមតិបានទេ។'));
            comments = comments.map(item => item.id === comment.id
                ? { ...item, body: null, status: 'deleted', can_edit: false }
                : item);
            dispatch('count', comments.filter(item => item.status === 'visible').length);
        } catch (error) {
            errorMessage = error.message || 'មិនអាចលុបមតិបានទេ។';
        } finally {
            actionBusy = false;
        }
    }

    async function moderateComment(event) {
        if (actionBusy) return;
        actionBusy = true;
        errorMessage = '';
        const { comment, status } = event.detail;

        try {
            const response = await fetch('/api/lesson-comments', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'moderate', comment_id: comment.id, status })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(apiError(payload, 'មិនអាចគ្រប់គ្រងមតិបានទេ។'));
            comments = comments.map(item => item.id === payload.comment.id ? payload.comment : item);
            dispatch('count', comments.filter(item => item.status === 'visible').length);
        } catch (error) {
            errorMessage = error.message || 'មិនអាចគ្រប់គ្រងមតិបានទេ។';
        } finally {
            actionBusy = false;
        }
    }

    async function reactToComment(event) {
        if (actionBusy) return;
        actionBusy = true;
        const { comment, reaction_type } = event.detail;
        try {
            const response = await fetch('/api/lesson-comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'reaction', comment_id: comment.id, reaction_type })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(apiError(payload, 'មិនអាចដាក់ reaction បានទេ។'));
            comments = comments.map(item => item.id === payload.comment_id
                ? { ...item, reactions: payload.reactions, my_reaction: payload.my_reaction }
                : item);
        } catch (error) {
            errorMessage = error.message || 'មិនអាចដាក់ reaction បានទេ។';
        } finally {
            actionBusy = false;
        }
    }

    async function pinComment(event) {
        if (actionBusy) return;
        actionBusy = true;
        const { comment, pinned } = event.detail;
        try {
            const response = await fetch('/api/lesson-comments', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'pin', comment_id: comment.id, pinned })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(apiError(payload, 'មិនអាច Pin comment បានទេ។'));
            comments = comments.map(item => item.id === payload.comment.id
                ? { ...item, ...payload.comment, reactions: item.reactions, my_reaction: item.my_reaction }
                : item);
        } catch (error) {
            errorMessage = error.message || 'មិនអាច Pin comment បានទេ។';
        } finally {
            actionBusy = false;
        }
    }

    function beginReply(event) {
        replyTo = event.detail;
        tick().then(() => composerElement?.focus());
    }

    function beginReport(event) {
        reportTarget = event.detail;
        reportReason = 'spam';
        reportDetails = '';
    }

    async function submitReport() {
        if (!reportTarget || actionBusy) return;
        actionBusy = true;
        errorMessage = '';

        try {
            const response = await fetch('/api/lesson-comments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    action: 'report',
                    comment_id: reportTarget.id,
                    reason: reportReason,
                    details: reportDetails
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(apiError(payload, 'មិនអាចរាយការណ៍មតិបានទេ។'));
            comments = comments.map(item => item.id === reportTarget.id
                ? { ...item, reported_by_me: true }
                : item);
            reportTarget = null;
        } catch (error) {
            errorMessage = error.message || 'មិនអាចរាយការណ៍មតិបានទេ។';
        } finally {
            actionBusy = false;
        }
    }

    function refreshWhenVisible() {
        if (document.visibilityState === 'visible') loadComments(false);
    }

    onMount(() => {
        refreshTimer = setInterval(() => {
            if (document.visibilityState === 'visible' && !submitting && !actionBusy) loadComments(false);
        }, 15000);
        document.addEventListener('visibilitychange', refreshWhenVisible);
    });

    onDestroy(() => {
        clearInterval(refreshTimer);
        document.removeEventListener('visibilitychange', refreshWhenVisible);
    });
</script>

<aside
    class="discussion-panel absolute inset-y-0 right-0 z-50 flex w-[min(94vw,410px)] flex-col"
    aria-label="ការពិភាក្សាមេរៀន"
    on:touchstart|stopPropagation
    on:touchmove|stopPropagation
    on:touchend|stopPropagation
>
    <header class="discussion-header">
        <div class="flex min-w-0 items-center gap-2.5">
            <span class="header-icon"><MessageCircleIcon size={20} /></span>
            <div class="min-w-0">
                <h2>ការពិភាក្សាមេរៀន</h2>
                <p class="truncate">{lesson?.title || ''}</p>
            </div>
        </div>
        <div class="flex items-center gap-1">
            <button class="icon-button" on:click={() => loadComments(false)} disabled={refreshing} aria-label="ផ្ទុកមតិឡើងវិញ" title="ផ្ទុកឡើងវិញ">
                <RefreshCwIcon size={17} class={refreshing ? 'animate-spin' : ''} />
            </button>
            <button class="icon-button" on:click={() => dispatch('close')} aria-label="បិទការពិភាក្សា" title="បិទ">
                <XIcon size={19} />
            </button>
        </div>
    </header>

    <div class="composer-wrap">
        {#if replyTo}
            <div class="replying-to">
                <span>កំពុងឆ្លើយតប <strong>{replyTo.author?.full_name || replyTo.author?.name_latin || 'សមាជិក'}</strong></span>
                <button on:click={() => replyTo = null} aria-label="បោះបង់ការឆ្លើយតប"><XIcon size={14} /></button>
            </div>
        {/if}
        <textarea
            bind:this={composerElement}
            bind:value={composer}
            maxlength="2000"
            rows="3"
            placeholder="សរសេរមតិអំពីមេរៀននេះ..."
            aria-label="សរសេរមតិ"
            on:keydown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submitComment();
            }}
        ></textarea>
        <div class="composer-footer">
            <span>{composer.length}/2000</span>
            <button on:click={submitComment} disabled={!composer.trim() || submitting}>
                {#if submitting}<LoaderCircleIcon class="animate-spin" size={16} />{:else}<SendIcon size={16} />{/if}
                ផ្ញើ
            </button>
        </div>
    </div>

    {#if errorMessage}
        <div class="error-banner">
            <AlertCircleIcon size={17} />
            <span>{errorMessage}</span>
            <button on:click={() => errorMessage = ''} aria-label="បិទសារ"><XIcon size={14} /></button>
        </div>
    {/if}

    <div class="comment-tools">
        <label class="search-box">
            <SearchIcon size={15} />
            <input bind:value={searchTerm} placeholder="ស្វែងរក comment ឬឈ្មោះ..." aria-label="ស្វែងរក comment" />
            {#if searchTerm}<button on:click={() => searchTerm = ''} aria-label="សម្អាតការស្វែងរក">×</button>{/if}
        </label>
        <div class="filter-row">
            <select bind:value={commentFilter} aria-label="តម្រង comment">
                <option value="all">Comment ទាំងអស់</option>
                <option value="pinned">Pinned Answer</option>
                <option value="instructor">Instructor</option>
                <option value="mine">Comment របស់ខ្ញុំ</option>
            </select>
            <select bind:value={sortMode} aria-label="តម្រៀប comment">
                <option value="oldest">ចាស់មុន</option>
                <option value="newest">ថ្មីមុន</option>
                <option value="popular">Reaction ច្រើន</option>
            </select>
        </div>
    </div>

    <div class="discussion-list">
        {#if loading}
            <div class="empty-state"><LoaderCircleIcon class="animate-spin" size={24} /><span>កំពុងផ្ទុកមតិ...</span></div>
        {:else if filteredComments.length === 0}
            <div class="empty-state">
                <MessageCircleIcon size={32} />
                <strong>{topLevelComments.length === 0 ? 'មិនទាន់មានមតិ' : 'រកមិនឃើញ comment'}</strong>
                <span>{topLevelComments.length === 0 ? 'ចាប់ផ្ដើមការពិភាក្សាអំពីមេរៀននេះ។' : 'សូមប្ដូរពាក្យស្វែងរក ឬតម្រង។'}</span>
            </div>
        {:else}
            {#each filteredComments as comment (comment.id)}
                <div data-comment-id={comment.id} class:focused-comment={focusCommentId === comment.id}>
                    <LessonCommentItem
                        {comment}
                        on:reply={beginReply}
                        on:edit={editComment}
                        on:delete={deleteComment}
                        on:report={beginReport}
                        on:moderate={moderateComment}
                        on:reaction={reactToComment}
                        on:pin={pinComment}
                    />
                </div>
                {#each repliesFor(comment.id) as reply (reply.id)}
                    <div data-comment-id={reply.id} class:focused-comment={focusCommentId === reply.id}>
                        <LessonCommentItem
                            comment={reply}
                            depth={1}
                            on:edit={editComment}
                            on:delete={deleteComment}
                            on:report={beginReport}
                            on:moderate={moderateComment}
                            on:reaction={reactToComment}
                        />
                    </div>
                {/each}
            {/each}
        {/if}
    </div>

    <footer class="safety-note">
        សូមកុំបង្ហោះព័ត៌មានអត្តសញ្ញាណ ឬទិន្នន័យឯកជនរបស់អ្នកជំងឺ។
    </footer>
</aside>

{#if reportTarget}
    <div class="report-modal-backdrop" role="presentation" on:click|self={() => reportTarget = null}>
        <dialog open class="report-modal" aria-labelledby="report-title">
            <div class="flex items-center justify-between gap-3">
                <h3 id="report-title"><FlagIcon size={18} /> រាយការណ៍មតិ</h3>
                <button class="icon-button" on:click={() => reportTarget = null} aria-label="បិទ"><XIcon size={18} /></button>
            </div>
            <label for="report-reason">មូលហេតុ</label>
            <select id="report-reason" bind:value={reportReason}>
                <option value="spam">Spam ឬការផ្សាយពាណិជ្ជកម្ម</option>
                <option value="harassment">ការរំខាន ឬប្រមាថ</option>
                <option value="privacy">បង្ហាញព័ត៌មានឯកជន/អ្នកជំងឺ</option>
                <option value="misinformation">ព័ត៌មានមិនត្រឹមត្រូវ</option>
                <option value="other">ផ្សេងៗ</option>
            </select>
            <label for="report-details">ព័ត៌មានបន្ថែម (មិនបង្ខំ)</label>
            <textarea id="report-details" bind:value={reportDetails} maxlength="500" rows="3"></textarea>
            <div class="flex justify-end gap-2 pt-1">
                <button class="modal-button" on:click={() => reportTarget = null}>បោះបង់</button>
                <button class="modal-button danger" on:click={submitReport} disabled={actionBusy}>
                    {#if actionBusy}<LoaderCircleIcon class="animate-spin" size={15} />{/if}
                    រាយការណ៍
                </button>
            </div>
        </dialog>
    </div>
{/if}

<style>
    .discussion-panel {
        background: #ffffff;
        color: #17212b;
        border-left: 1px solid #d7e0e8;
        box-shadow: -12px 0 32px rgba(15, 23, 42, 0.16);
    }

    .discussion-header {
        min-height: 66px;
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 0.7rem 0.85rem;
        border-bottom: 1px solid #e2e8f0;
    }

    .discussion-header h2 { font-size: 0.95rem; font-weight: 800; color: #17212b; }
    .discussion-header p { margin-top: 0.1rem; color: #64748b; font-size: 0.7rem; }
    .header-icon { width: 2.2rem; height: 2.2rem; border-radius: 0.65rem; display: grid; place-items: center; background: #ccfbf1; color: #0f766e; }

    .icon-button {
        width: 2.15rem;
        height: 2.15rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #e2e8f0;
        border-radius: 0.55rem;
        background: #f8fafc;
        color: #475569;
    }
    .icon-button:hover:not(:disabled) { background: #f1f5f9; color: #0f766e; }
    .icon-button:disabled { opacity: 0.55; }

    .composer-wrap { flex: 0 0 auto; padding: 0.75rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .composer-wrap textarea {
        width: 100%;
        resize: vertical;
        border: 1px solid #cbd5e1;
        border-radius: 0.7rem;
        background: #fff;
        color: #17212b;
        padding: 0.65rem 0.75rem;
        font-size: 0.8rem;
        line-height: 1.5;
        outline: none;
    }
    .composer-wrap textarea:focus { border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.12); }

    .replying-to { margin-bottom: 0.45rem; display: flex; justify-content: space-between; gap: 0.5rem; border-radius: 0.5rem; background: #ecfdf5; color: #047857; padding: 0.4rem 0.55rem; font-size: 0.7rem; }
    .replying-to button { border: 0; background: transparent; color: inherit; }

    .composer-footer { margin-top: 0.4rem; display: flex; align-items: center; justify-content: space-between; }
    .composer-footer > span { color: #94a3b8; font-size: 0.65rem; }
    .composer-footer button {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        border: 0;
        border-radius: 0.55rem;
        background: #0f766e;
        color: #fff;
        padding: 0.5rem 0.85rem;
        font-size: 0.75rem;
        font-weight: 800;
    }
    .composer-footer button:disabled { cursor: not-allowed; opacity: 0.5; }

    .error-banner { margin: 0.6rem 0.75rem 0; display: flex; align-items: center; gap: 0.45rem; border: 1px solid #fecaca; border-radius: 0.55rem; background: #fef2f2; color: #b91c1c; padding: 0.5rem 0.6rem; font-size: 0.72rem; }
    .error-banner span { min-width: 0; flex: 1; }
    .error-banner button { border: 0; background: transparent; color: inherit; }

    .comment-tools { flex: 0 0 auto; display: grid; gap: 0.45rem; border-bottom: 1px solid #e2e8f0; background: #fff; padding: 0.6rem 0.75rem; }
    .search-box { display: flex; align-items: center; gap: 0.4rem; border: 1px solid #cbd5e1; border-radius: 0.6rem; padding: 0.42rem 0.55rem; color: #64748b; }
    .search-box:focus-within { border-color: #0d9488; box-shadow: 0 0 0 2px rgba(13, 148, 136, 0.1); }
    .search-box input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: #17212b; font-size: 0.72rem; }
    .search-box button { border: 0; background: transparent; color: #94a3b8; font-size: 1rem; }
    .filter-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
    .filter-row select { min-width: 0; border: 1px solid #e2e8f0; border-radius: 0.5rem; background: #f8fafc; color: #475569; padding: 0.38rem 0.45rem; font-size: 0.68rem; font-weight: 700; }

    .discussion-list { min-height: 0; flex: 1 1 auto; overflow-y: auto; padding: 0 0.8rem; }
    .focused-comment { border-radius: 0.75rem; animation: comment-focus 2.5s ease-out; }
    @keyframes comment-focus {
        0%, 35% { background: #fef3c7; box-shadow: 0 0 0 3px #f59e0b; }
        100% { background: transparent; box-shadow: 0 0 0 0 transparent; }
    }
    .empty-state { min-height: 12rem; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.4rem; color: #94a3b8; text-align: center; font-size: 0.75rem; }
    .empty-state strong { color: #475569; font-size: 0.85rem; }
    .safety-note { flex: 0 0 auto; border-top: 1px solid #e2e8f0; background: #fffbeb; color: #92400e; padding: 0.55rem 0.75rem; font-size: 0.66rem; line-height: 1.45; }

    .report-modal-backdrop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 1rem; background: rgba(15, 23, 42, 0.55); }
    .report-modal { position: static; width: min(100%, 420px); border: 0; border-radius: 0.85rem; background: #fff; color: #17212b; padding: 1rem; box-shadow: 0 24px 64px rgba(15, 23, 42, 0.28); }
    .report-modal h3 { display: flex; align-items: center; gap: 0.4rem; font-size: 0.95rem; font-weight: 800; }
    .report-modal label { display: block; margin-top: 0.75rem; margin-bottom: 0.25rem; color: #475569; font-size: 0.72rem; font-weight: 700; }
    .report-modal select, .report-modal textarea { width: 100%; border: 1px solid #cbd5e1; border-radius: 0.55rem; background: #fff; color: #17212b; padding: 0.55rem; font-size: 0.78rem; }
    .modal-button { display: inline-flex; align-items: center; gap: 0.3rem; border: 1px solid #cbd5e1; border-radius: 0.5rem; background: #fff; color: #475569; padding: 0.45rem 0.7rem; font-size: 0.72rem; font-weight: 800; }
    .modal-button.danger { border-color: #dc2626; background: #dc2626; color: #fff; }
    .modal-button:disabled { opacity: 0.55; }
</style>
