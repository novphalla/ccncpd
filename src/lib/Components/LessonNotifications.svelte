<script>
    import { createEventDispatcher, onMount } from 'svelte';

    export let open = false;

    const dispatch = createEventDispatcher();
    let notifications = [];
    let loading = true;
    let busyId = null;
    let errorMessage = '';

    $: unreadCount = notifications.filter(item => !item.read_at).length;

    onMount(() => {
        loadNotifications();
    });

    function displayName(user) {
        return user?.full_name || user?.name_latin || 'សមាជិក';
    }

    function formatDate(value) {
        if (!value) return '';
        return new Intl.DateTimeFormat('km-KH', {
            dateStyle: 'medium',
            timeStyle: 'short'
        }).format(new Date(value));
    }

    function notificationMessage(type) {
        if (type === 'reply') return ' បានឆ្លើយតបមតិរបស់អ្នក';
        if (type === 'mention') return ' បាន Mention អ្នកក្នុង Comment';
        if (type === 'resolved') return ' បានកំណត់សំណួររបស់អ្នកថាដោះស្រាយរួច';
        return ' បានបញ្ចេញមតិក្នុងមេរៀនដែលអ្នកតាមដាន';
    }

    async function loadNotifications() {
        loading = true;
        try {
            const response = await fetch('/api/lesson-notifications', {
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចទាញយកការជូនដំណឹងបានទេ។');
            notifications = payload.notifications || [];
            errorMessage = '';
            dispatch('count', payload.unread_count || 0);
        } catch (error) {
            errorMessage = error.message || 'មិនអាចទាញយកការជូនដំណឹងបានទេ។';
        } finally {
            loading = false;
        }
    }

    async function markRead(notification) {
        if (notification.read_at) return true;
        const response = await fetch('/api/lesson-notifications', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ notification_id: notification.id })
        });
        if (!response.ok) return false;

        const readAt = new Date().toISOString();
        notifications = notifications.map(item => item.id === notification.id
            ? { ...item, read_at: readAt }
            : item);
        dispatch('count', notifications.filter(item => !item.read_at).length);
        return true;
    }

    async function openNotification(notification) {
        if (busyId) return;
        busyId = notification.id;
        await markRead(notification);
        dispatch('openDiscussion', {
            course_id: notification.course_id,
            lesson_id: notification.lesson_id,
            comment_id: notification.comment_id
        });
        busyId = null;
    }

    async function markAllRead() {
        if (busyId || unreadCount === 0) return;
        busyId = 'all';
        try {
            const response = await fetch('/api/lesson-notifications', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'mark_all_read' })
            });
            if (!response.ok) throw new Error();
            const readAt = new Date().toISOString();
            notifications = notifications.map(item => ({ ...item, read_at: item.read_at || readAt }));
            dispatch('count', 0);
        } catch {
            errorMessage = 'មិនអាចសម្គាល់ការជូនដំណឹងទាំងអស់បានទេ។';
        } finally {
            busyId = null;
        }
    }
</script>

{#if open}
    <div class="fixed inset-0 z-[100]">
        <button class="absolute inset-0 border-0 bg-slate-950/40" on:click={() => dispatch('close')} aria-label="បិទការជូនដំណឹង"></button>
        <div class="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="lesson-notifications-title">
            <header class="flex items-center justify-between gap-3 border-b border-slate-200 bg-gradient-to-r from-teal-700 to-cyan-600 px-5 py-4 text-white">
                <div>
                    <h2 id="lesson-notifications-title" class="text-lg font-black">ការជូនដំណឹង</h2>
                    <p class="text-xs font-semibold text-white/80">Comment និង reply ក្នុងមេរៀន</p>
                </div>
                <button class="grid h-9 w-9 place-items-center rounded-full border border-white/30 bg-white/10 text-xl hover:bg-white/20" on:click={() => dispatch('close')} aria-label="បិទ">×</button>
            </header>

            <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <span class="text-sm font-bold text-slate-700">មិនទាន់មើល {unreadCount}</span>
                <div class="flex gap-2">
                    <button class="rounded-lg px-3 py-1.5 text-xs font-bold text-teal-700 hover:bg-teal-50 disabled:opacity-50" on:click={markAllRead} disabled={unreadCount === 0 || busyId === 'all'}>
                        បានមើលទាំងអស់
                    </button>
                    <button class="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-slate-100" on:click={loadNotifications} aria-label="ផ្ទុកឡើងវិញ">↻</button>
                </div>
            </div>

            <div class="flex-1 overflow-y-auto bg-slate-50 p-3">
                {#if loading}
                    <div class="flex h-40 items-center justify-center"><span class="loading loading-spinner text-teal-600"></span></div>
                {:else if errorMessage}
                    <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{errorMessage}</div>
                {:else if notifications.length === 0}
                    <div class="flex h-56 flex-col items-center justify-center text-center text-slate-500">
                        <div class="mb-3 text-4xl">🔔</div>
                        <div class="font-bold">មិនទាន់មានការជូនដំណឹងទេ</div>
                        <div class="mt-1 text-xs">Reply និង comment ថ្មីនឹងបង្ហាញនៅទីនេះ។</div>
                    </div>
                {:else}
                    <div class="space-y-2">
                        {#each notifications as notification (notification.id)}
                            <button
                                class="relative w-full rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md {notification.read_at ? 'border-slate-200 bg-white' : 'border-teal-200 bg-teal-50'}"
                                on:click={() => openNotification(notification)}
                                disabled={busyId === notification.id}
                            >
                                {#if !notification.read_at}
                                    <span class="absolute right-3 top-3 h-2.5 w-2.5 rounded-full bg-red-500"></span>
                                {/if}
                                <div class="flex gap-3 pr-4">
                                    <div class="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-teal-100 font-black text-teal-700">
                                        {#if notification.actor?.avatar_url}
                                            <img src={notification.actor.avatar_url} alt="" class="h-full w-full object-cover" />
                                        {:else}
                                            {displayName(notification.actor).slice(0, 1)}
                                        {/if}
                                    </div>
                                    <div class="min-w-0 flex-1">
                                        <p class="text-sm leading-snug text-slate-800">
                                            <strong>{displayName(notification.actor)}</strong>
                                            {notificationMessage(notification.notification_type)}
                                        </p>
                                        <p class="mt-1 line-clamp-2 text-xs font-semibold text-slate-500">
                                            {notification.comment?.status === 'visible' ? notification.comment?.body : 'មតិនេះមិនអាចមើលបានទេ'}
                                        </p>
                                        <p class="mt-2 truncate text-[11px] font-bold text-teal-700">{notification.course?.title || 'វគ្គសិក្សា'} · {notification.lesson?.title || 'មេរៀន'}</p>
                                        <p class="mt-1 text-[10px] text-slate-400">{formatDate(notification.created_at)}</p>
                                    </div>
                                </div>
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}
