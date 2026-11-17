<script>
    import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';

    export let open = false;
    export let currentUser;

    const dispatch = createEventDispatcher();
    let conversations = [];
    let activeConversation = null;
    let activeMember = null;
    let messages = [];
    let loading = false;
    let sending = false;
    let composer = '';
    let memberSearch = '';
    let memberResults = [];
    let searching = false;
    let errorMessage = '';
    let listElement;
    let wasOpen = false;
    let pollTimer;
    let searchTimer;

    $: if (open && !wasOpen) {
        wasOpen = true;
        loadConversations();
    }
    $: if (!open && wasOpen) {
        wasOpen = false;
        activeConversation = null;
        activeMember = null;
        messages = [];
        memberSearch = '';
        memberResults = [];
    }

    onMount(() => {
        pollTimer = setInterval(() => {
            if (!open || document.visibilityState !== 'visible') return;
            if (activeConversation) loadMessages(false);
            else loadConversations(false);
        }, 5000);
    });

    onDestroy(() => {
        clearInterval(pollTimer);
        clearTimeout(searchTimer);
    });

    function nameOf(member) {
        return member?.full_name || member?.name_latin || 'សមាជិក';
    }

    function initials(member) {
        return nameOf(member).trim().slice(0, 2).toUpperCase();
    }

    function timeOf(value) {
        if (!value) return '';
        const date = new Date(value);
        const today = new Date();
        return date.toDateString() === today.toDateString()
            ? date.toLocaleTimeString('km-KH', { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleDateString('km-KH', { day: 'numeric', month: 'short' });
    }

    async function loadConversations(showLoader = true) {
        if (showLoader) loading = true;
        try {
            const response = await fetch('/api/private-chat', { credentials: 'same-origin', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចទាញយកសារបានទេ។');
            conversations = payload.conversations || [];
            dispatch('count', payload.unread_count || 0);
            errorMessage = '';
        } catch (error) {
            errorMessage = error.message || 'មិនអាចទាញយកសារបានទេ។';
        } finally {
            loading = false;
        }
    }

    function scheduleMemberSearch() {
        clearTimeout(searchTimer);
        const query = memberSearch.trim();
        if (query.length < 2) {
            memberResults = [];
            searching = false;
            return;
        }
        searching = true;
        searchTimer = setTimeout(searchMembers, 350);
    }

    async function searchMembers() {
        try {
            const response = await fetch(`/api/private-chat?search=${encodeURIComponent(memberSearch.trim())}`, {
                credentials: 'same-origin', cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចស្វែងរកសមាជិកបានទេ។');
            memberResults = payload.members || [];
        } catch (error) {
            errorMessage = error.message || 'មិនអាចស្វែងរកសមាជិកបានទេ។';
        } finally {
            searching = false;
        }
    }

    async function startChat(member) {
        loading = true;
        try {
            const response = await fetch('/api/private-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'start', user_id: member.id })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចចាប់ផ្ដើម Chat បានទេ។');
            activeConversation = payload.conversation;
            activeMember = payload.member;
            memberSearch = '';
            memberResults = [];
            await loadMessages();
        } catch (error) {
            errorMessage = error.message || 'មិនអាចចាប់ផ្ដើម Chat បានទេ។';
        } finally {
            loading = false;
        }
    }

    async function openConversation(conversation) {
        activeConversation = conversation;
        activeMember = conversation.member;
        await loadMessages();
    }

    async function loadMessages(showLoader = true) {
        if (!activeConversation?.id) return;
        if (showLoader) loading = true;
        try {
            const response = await fetch(`/api/private-chat?conversation_id=${encodeURIComponent(activeConversation.id)}`, {
                credentials: 'same-origin', cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចទាញយកសារបានទេ។');
            const previousLast = messages.at(-1)?.id;
            messages = payload.messages || [];
            await markRead();
            if (showLoader || previousLast !== messages.at(-1)?.id) {
                await tick();
                listElement?.scrollTo({ top: listElement.scrollHeight, behavior: showLoader ? 'auto' : 'smooth' });
            }
        } catch (error) {
            errorMessage = error.message || 'មិនអាចទាញយកសារបានទេ។';
        } finally {
            loading = false;
        }
    }

    async function markRead() {
        if (!activeConversation?.id || !messages.some(message => message.sender_id !== currentUser?.id && !message.read_at)) return;
        const response = await fetch('/api/private-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ action: 'mark_read', conversation_id: activeConversation.id })
        });
        if (response.ok) {
            const now = new Date().toISOString();
            messages = messages.map(message => message.sender_id !== currentUser?.id && !message.read_at
                ? { ...message, read_at: now }
                : message);
            conversations = conversations.map(item => item.id === activeConversation.id ? { ...item, unread_count: 0 } : item);
            dispatch('count', conversations.reduce((total, item) => total + Number(item.unread_count || 0), 0));
        }
    }

    async function sendMessage() {
        const body = composer.trim();
        if (!body || sending || !activeConversation?.id) return;
        sending = true;
        try {
            const response = await fetch('/api/private-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action: 'send', conversation_id: activeConversation.id, body })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចផ្ញើសារបានទេ។');
            messages = [...messages, payload.message];
            composer = '';
            errorMessage = '';
            await tick();
            listElement?.scrollTo({ top: listElement.scrollHeight, behavior: 'smooth' });
        } catch (error) {
            errorMessage = error.message || 'មិនអាចផ្ញើសារបានទេ។';
        } finally {
            sending = false;
        }
    }

    function backToList() {
        activeConversation = null;
        activeMember = null;
        messages = [];
        composer = '';
        loadConversations(false);
    }
</script>

{#if open}
    <div class="fixed inset-0 z-[105]">
        <button class="absolute inset-0 border-0 bg-slate-950/40" on:click={() => dispatch('close')} aria-label="បិទ Private Chat"></button>
        <div class="absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="private-chat-title">
            <header class="flex min-h-16 items-center gap-3 bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-3 text-white">
                {#if activeConversation}
                    <button class="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-xl hover:bg-white/20" on:click={backToList} aria-label="ត្រឡប់ក្រោយ">←</button>
                {:else}
                    <span class="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-xl">💬</span>
                {/if}
                <div class="min-w-0 flex-1">
                    <h2 id="private-chat-title" class="truncate text-base font-black">{activeMember ? nameOf(activeMember) : 'Private Chat'}</h2>
                    <p class="truncate text-xs font-semibold text-white/75">{activeMember ? 'សារឯកជនរវាងសមាជិកពីរនាក់' : 'ស្វែងរក និងផ្ញើសារទៅសមាជិក'}</p>
                </div>
                <button class="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-xl hover:bg-white/20" on:click={() => dispatch('close')} aria-label="បិទ">×</button>
            </header>

            {#if errorMessage}
                <div class="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700">{errorMessage}</div>
            {/if}

            {#if activeConversation}
                <div bind:this={listElement} class="flex-1 space-y-2 overflow-y-auto bg-slate-100 p-4">
                    {#if loading && messages.length === 0}
                        <div class="flex h-40 items-center justify-center"><span class="loading loading-spinner text-blue-600"></span></div>
                    {:else if messages.length === 0}
                        <div class="flex h-48 flex-col items-center justify-center text-center text-slate-500">
                            <div class="text-4xl">👋</div>
                            <strong class="mt-3">ចាប់ផ្ដើមការសន្ទនា</strong>
                            <span class="mt-1 text-xs">ផ្ញើសារដំបូងទៅ {nameOf(activeMember)}</span>
                        </div>
                    {:else}
                        {#each messages as message (message.id)}
                            <div class="flex {message.sender_id === currentUser?.id ? 'justify-end' : 'justify-start'}">
                                <div class="max-w-[82%] rounded-2xl px-3 py-2 shadow-sm {message.sender_id === currentUser?.id ? 'rounded-br-sm bg-blue-600 text-white' : 'rounded-bl-sm bg-white text-slate-800'}">
                                    <p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>
                                    <div class="mt-1 flex items-center justify-end gap-1 text-[10px] {message.sender_id === currentUser?.id ? 'text-white/70' : 'text-slate-400'}">
                                        <span>{timeOf(message.created_at)}</span>
                                        {#if message.sender_id === currentUser?.id}<span>{message.read_at ? '✓✓' : '✓'}</span>{/if}
                                    </div>
                                </div>
                            </div>
                        {/each}
                    {/if}
                </div>
                <div class="border-t border-slate-200 bg-white p-3">
                    <div class="flex items-end gap-2">
                        <textarea bind:value={composer} rows="1" maxlength="2000" placeholder="សរសេរសារ..." class="max-h-28 min-h-11 flex-1 resize-y rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500" on:keydown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }}></textarea>
                        <button class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-lg text-white disabled:opacity-50" on:click={sendMessage} disabled={!composer.trim() || sending} aria-label="ផ្ញើសារ">➤</button>
                    </div>
                    <div class="mt-1 text-right text-[10px] text-slate-400">{composer.length}/2000</div>
                </div>
            {:else}
                <div class="border-b border-slate-200 bg-white p-3">
                    <label class="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 focus-within:border-blue-500">
                        <span>🔎</span>
                        <input bind:value={memberSearch} on:input={scheduleMemberSearch} class="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" placeholder="ស្វែងរកឈ្មោះសមាជិក..." />
                        {#if searching}<span class="loading loading-spinner loading-xs text-blue-600"></span>{/if}
                    </label>
                </div>
                <div class="flex-1 overflow-y-auto bg-slate-50 p-3">
                    {#if memberSearch.trim().length >= 2}
                        <div class="mb-2 text-xs font-black text-slate-500">លទ្ធផលស្វែងរក</div>
                        {#if !searching && memberResults.length === 0}
                            <div class="rounded-xl bg-white p-5 text-center text-sm text-slate-500">រកមិនឃើញសមាជិក</div>
                        {:else}
                            <div class="space-y-2">
                                {#each memberResults as member (member.id)}
                                    <button class="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-300 hover:bg-blue-50" on:click={() => startChat(member)}>
                                        <div class="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 font-black text-blue-700">{#if member.avatar_url}<img src={member.avatar_url} alt="" class="h-full w-full object-cover" />{:else}{initials(member)}{/if}</div>
                                        <div class="min-w-0"><strong class="block truncate text-sm text-slate-800">{nameOf(member)}</strong><span class="text-xs text-slate-400">ចាប់ផ្ដើម Chat</span></div>
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    {:else if loading}
                        <div class="flex h-40 items-center justify-center"><span class="loading loading-spinner text-blue-600"></span></div>
                    {:else if conversations.length === 0}
                        <div class="flex h-56 flex-col items-center justify-center text-center text-slate-500"><div class="text-4xl">💬</div><strong class="mt-3">មិនទាន់មានការសន្ទនា</strong><span class="mt-1 text-xs">ស្វែងរកឈ្មោះសមាជិកដើម្បីចាប់ផ្ដើម។</span></div>
                    {:else}
                        <div class="mb-2 text-xs font-black text-slate-500">ការសន្ទនា</div>
                        <div class="space-y-2">
                            {#each conversations as conversation (conversation.id)}
                                <button class="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-300" on:click={() => openConversation(conversation)}>
                                    <div class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 font-black text-blue-700">{#if conversation.member?.avatar_url}<img src={conversation.member.avatar_url} alt="" class="h-full w-full object-cover" />{:else}{initials(conversation.member)}{/if}</div>
                                    <div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-2"><strong class="truncate text-sm text-slate-800">{nameOf(conversation.member)}</strong><span class="text-[10px] text-slate-400">{timeOf(conversation.last_message?.created_at || conversation.last_message_at)}</span></div><p class="mt-1 truncate text-xs {conversation.unread_count ? 'font-bold text-slate-700' : 'text-slate-400'}">{conversation.last_message?.sender_id === currentUser?.id ? 'អ្នក: ' : ''}{conversation.last_message?.body || 'ការសន្ទនាថ្មី'}</p></div>
                                    {#if conversation.unread_count}<span class="grid h-6 min-w-6 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-black text-white">{conversation.unread_count > 99 ? '99+' : conversation.unread_count}</span>{/if}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>
{/if}
