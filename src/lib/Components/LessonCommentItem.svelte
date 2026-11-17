<script>
    import { createEventDispatcher } from 'svelte';
    import {
        EyeIcon,
        EyeOffIcon,
        FlagIcon,
        PencilIcon,
        PinIcon,
        ReplyIcon,
        ShieldCheckIcon,
        Trash2Icon,
        XIcon
    } from 'lucide-svelte';

    export let comment;
    export let depth = 0;

    const dispatch = createEventDispatcher();
    let editing = false;
    let draft = '';

    $: displayName = comment?.author?.full_name || comment?.author?.name_latin || 'សមាជិក';
    $: initials = displayName.trim().slice(0, 2).toUpperCase();
    $: visible = comment?.status === 'visible';

    function formatDate(value) {
        if (!value) return '';
        try {
            return new Intl.DateTimeFormat('km-KH', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
            }).format(new Date(value));
        } catch {
            return '';
        }
    }

    function beginEdit() {
        draft = comment.body || '';
        editing = true;
    }

    function saveEdit() {
        const body = draft.trim();
        if (!body || body === comment.body) {
            editing = false;
            return;
        }
        dispatch('edit', { comment, body });
        editing = false;
    }
</script>

<article class:reply-item={depth > 0} class="comment-item">
    <div class="avatar" aria-hidden="true">
        {#if comment?.author?.avatar_url}
            <img src={comment.author.avatar_url} alt="" />
        {:else}
            <span>{initials}</span>
        {/if}
    </div>

    <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <strong class="author-name">{displayName}</strong>
            {#if ['admin', 'owner'].includes(comment?.author?.role)}
                <span class="admin-badge"><ShieldCheckIcon size={12} /> Instructor</span>
            {/if}
            {#if comment.is_pinned}
                <span class="pinned-badge"><PinIcon size={11} /> Pinned Answer</span>
            {/if}
            <time datetime={comment.created_at}>{formatDate(comment.created_at)}</time>
            {#if comment.edited_at && visible}<span class="edited-label">បានកែ</span>{/if}
            {#if comment.can_moderate && comment.report_count > 0}
                <span class="report-badge"><FlagIcon size={11} /> {comment.report_count} reports</span>
            {/if}
        </div>

        {#if editing}
            <div class="edit-box">
                <textarea bind:value={draft} maxlength="2000" rows="3" aria-label="កែសម្រួលមតិ"></textarea>
                <div class="flex justify-end gap-2">
                    <button class="small-button" on:click={() => editing = false}>
                        <XIcon size={14} /> បោះបង់
                    </button>
                    <button class="small-button primary" on:click={saveEdit}>រក្សាទុក</button>
                </div>
            </div>
        {:else if comment.status === 'deleted'}
            <p class="moderated-message">មតិនេះត្រូវបានលុប។</p>
        {:else if comment.status === 'hidden'}
            <p class="moderated-message">មតិនេះត្រូវបានលាក់ដោយអ្នកគ្រប់គ្រង។</p>
        {:else}
            <p class="comment-body">{comment.body}</p>
        {/if}

        {#if !editing}
            {#if visible}
                <div class="reaction-row" aria-label="Reaction">
                    <button class:active={comment.my_reaction === 'like'} on:click={() => dispatch('reaction', { comment, reaction_type: 'like' })} title="Like">
                        👍 <span>{comment.reactions?.like || 0}</span>
                    </button>
                    <button class:active={comment.my_reaction === 'love'} on:click={() => dispatch('reaction', { comment, reaction_type: 'love' })} title="Love">
                        ❤️ <span>{comment.reactions?.love || 0}</span>
                    </button>
                    <button class:active={comment.my_reaction === 'helpful'} on:click={() => dispatch('reaction', { comment, reaction_type: 'helpful' })} title="Helpful">
                        💡 <span>{comment.reactions?.helpful || 0}</span>
                    </button>
                </div>
            {/if}
            <div class="comment-actions">
                {#if visible && depth === 0}
                    <button on:click={() => dispatch('reply', comment)}>
                        <ReplyIcon size={14} /> ឆ្លើយតប
                    </button>
                {/if}
                {#if comment.can_edit}
                    <button on:click={beginEdit}><PencilIcon size={14} /> កែ</button>
                {/if}
                {#if comment.can_delete && comment.status !== 'deleted'}
                    <button class="danger" on:click={() => dispatch('delete', comment)}>
                        <Trash2Icon size={14} /> លុប
                    </button>
                {/if}
                {#if visible && !comment.can_edit}
                    <button
                        class:reported={comment.reported_by_me}
                        disabled={comment.reported_by_me}
                        on:click={() => dispatch('report', comment)}
                    >
                        <FlagIcon size={14} /> {comment.reported_by_me ? 'បានរាយការណ៍' : 'រាយការណ៍'}
                    </button>
                {/if}
                {#if comment.can_moderate && comment.status !== 'deleted'}
                    <button on:click={() => dispatch('moderate', { comment, status: visible ? 'hidden' : 'visible' })}>
                        {#if visible}<EyeOffIcon size={14} /> លាក់{:else}<EyeIcon size={14} /> បង្ហាញ{/if}
                    </button>
                {/if}
                {#if comment.can_pin}
                    <button class:pinned-action={comment.is_pinned} on:click={() => dispatch('pin', { comment, pinned: !comment.is_pinned })}>
                        <PinIcon size={14} /> {comment.is_pinned ? 'ដក Pin' : 'Pin Answer'}
                    </button>
                {/if}
            </div>
        {/if}
    </div>
</article>

<style>
    .comment-item {
        display: flex;
        gap: 0.65rem;
        padding: 0.85rem 0;
        border-bottom: 1px solid #e5e7eb;
    }

    .reply-item {
        margin-left: 2.1rem;
        padding-left: 0.75rem;
        border-left: 2px solid #ccfbf1;
    }

    .avatar {
        width: 2.25rem;
        height: 2.25rem;
        flex: 0 0 2.25rem;
        overflow: hidden;
        border-radius: 999px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #ccfbf1;
        color: #0f766e;
        font-size: 0.72rem;
        font-weight: 800;
    }

    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .author-name { color: #17212b; font-size: 0.82rem; }
    time, .edited-label { color: #94a3b8; font-size: 0.68rem; }

    .admin-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        border-radius: 999px;
        background: #ecfdf5;
        color: #047857;
        padding: 0.1rem 0.4rem;
        font-size: 0.62rem;
        font-weight: 800;
    }

    .report-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.18rem;
        border-radius: 999px;
        background: #fff7ed;
        color: #c2410c;
        padding: 0.1rem 0.4rem;
        font-size: 0.62rem;
        font-weight: 800;
    }

    .pinned-badge {
        display: inline-flex;
        align-items: center;
        gap: 0.18rem;
        border-radius: 999px;
        background: #fef3c7;
        color: #b45309;
        padding: 0.1rem 0.4rem;
        font-size: 0.62rem;
        font-weight: 800;
    }

    .comment-body {
        margin-top: 0.35rem;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        color: #334155;
        font-size: 0.82rem;
        line-height: 1.6;
    }

    .moderated-message {
        margin-top: 0.35rem;
        color: #94a3b8;
        font-size: 0.78rem;
        font-style: italic;
    }

    .comment-actions {
        margin-top: 0.45rem;
        display: flex;
        flex-wrap: wrap;
        gap: 0.15rem 0.55rem;
    }

    .reaction-row { margin-top: 0.45rem; display: flex; flex-wrap: wrap; gap: 0.3rem; }
    .reaction-row button {
        display: inline-flex;
        align-items: center;
        gap: 0.22rem;
        min-width: 2.7rem;
        justify-content: center;
        border: 1px solid #e2e8f0;
        border-radius: 999px;
        background: #f8fafc;
        color: #64748b;
        padding: 0.2rem 0.45rem;
        font-size: 0.68rem;
        font-weight: 800;
    }
    .reaction-row button:hover, .reaction-row button.active { border-color: #5eead4; background: #ccfbf1; color: #0f766e; }

    .comment-actions button {
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        border: 0;
        background: transparent;
        color: #64748b;
        padding: 0.15rem 0;
        font-size: 0.68rem;
        font-weight: 700;
        cursor: pointer;
    }

    .comment-actions button:hover:not(:disabled) { color: #0f766e; }
    .comment-actions button.danger:hover { color: #dc2626; }
    .comment-actions button.reported { color: #b45309; }
    .comment-actions button.pinned-action { color: #b45309; }
    .comment-actions button:disabled { cursor: default; opacity: 0.72; }

    .edit-box { margin-top: 0.45rem; }
    .edit-box textarea {
        width: 100%;
        resize: vertical;
        border: 1px solid #cbd5e1;
        border-radius: 0.6rem;
        padding: 0.55rem;
        color: #17212b;
        background: #fff;
        font-size: 0.8rem;
        outline: none;
    }
    .edit-box textarea:focus { border-color: #0d9488; box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.12); }

    .small-button {
        margin-top: 0.35rem;
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        border: 1px solid #cbd5e1;
        border-radius: 0.45rem;
        background: #fff;
        color: #475569;
        padding: 0.35rem 0.55rem;
        font-size: 0.7rem;
        font-weight: 700;
    }
    .small-button.primary { border-color: #0f766e; background: #0f766e; color: white; }
</style>
