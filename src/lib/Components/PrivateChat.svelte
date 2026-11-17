<script>
    import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';

    export let open = false;
    export let currentUser;
    export let supabase;

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
    let successMessage = '';
    let listElement;
    let wasOpen = false;
    let pollTimer;
    let searchTimer;
    let realtimeChannel;
    let realtimeConnected = false;
    let typing = false;
    let typingTimer;
    let lastTypingSent = 0;
    let showSafetyMenu = false;
    let showReportForm = false;
    let reportReason = 'spam';
    let reportDetails = '';
    let safetyBusy = false;
    let pushSupported = false;
    let pushEnabled = false;
    let pushBusy = false;
    let pushDenied = false;

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
        cleanupRealtime();
    }

    onMount(() => {
        pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        pushDenied = pushSupported && Notification.permission === 'denied';
        if (pushSupported && Notification.permission === 'granted') syncPushSubscription();
        pollTimer = setInterval(() => {
            if (!open || document.visibilityState !== 'visible') return;
            if (activeConversation) loadMessages(false);
            else loadConversations(false);
        }, 15000);
    });

    onDestroy(() => {
        clearInterval(pollTimer);
        clearTimeout(searchTimer);
        clearTimeout(typingTimer);
        cleanupRealtime();
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

    function messageStatus(message) {
        if (message.read_at) return 'បានមើល';
        if (message.delivered_at) return 'បានទទួល';
        return 'បានផ្ញើ';
    }

    function cleanupRealtime() {
        if (realtimeChannel && supabase) supabase.removeChannel(realtimeChannel).catch(() => {});
        realtimeChannel = null;
        realtimeConnected = false;
        typing = false;
        clearTimeout(typingTimer);
    }

    function connectRealtime(conversationId) {
        cleanupRealtime();
        if (!supabase || !conversationId) return;
        realtimeChannel = supabase.channel(`private-chat:${conversationId}`, {
            config: { private: false, broadcast: { self: false, ack: false } }
        });
        realtimeChannel
            .on('broadcast', { event: 'message' }, ({ payload }) => {
                if (payload?.sender_id !== currentUser?.id) loadMessages(false);
            })
            .on('broadcast', { event: 'receipt' }, () => loadMessages(false))
            .on('broadcast', { event: 'block' }, () => loadMessages(false))
            .on('broadcast', { event: 'typing' }, ({ payload }) => {
                if (payload?.user_id === currentUser?.id) return;
                typing = Boolean(payload?.typing);
                clearTimeout(typingTimer);
                if (typing) typingTimer = setTimeout(() => typing = false, 2500);
            })
            .subscribe(status => {
                realtimeConnected = status === 'SUBSCRIBED';
            });
    }

    function sendTyping(isTyping = true) {
        if (!realtimeChannel || !realtimeConnected) return;
        const now = Date.now();
        if (isTyping && now - lastTypingSent < 900) return;
        lastTypingSent = now;
        realtimeChannel.send({
            type: 'broadcast',
            event: 'typing',
            payload: { user_id: currentUser?.id, typing: isTyping }
        }).catch(() => {});
    }

    function handleComposerInput() {
        sendTyping(Boolean(composer.trim()));
    }

    function urlBase64ToUint8Array(value) {
        const padding = '='.repeat((4 - value.length % 4) % 4);
        const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        return Uint8Array.from(raw, character => character.charCodeAt(0));
    }

    async function savePushSubscription(subscription) {
        const response = await fetch('/api/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ subscription: subscription.toJSON() })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'មិនអាចរក្សាទុក Push Notification បានទេ។');
    }

    async function syncPushSubscription() {
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            pushEnabled = Boolean(subscription);
            if (subscription) await savePushSubscription(subscription);
        } catch (error) {
            console.warn('Unable to sync push subscription:', error);
        }
    }

    async function enablePushNotifications() {
        if (!pushSupported || pushBusy) return;
        pushBusy = true;
        try {
            const configResponse = await fetch('/api/subscribe', { credentials: 'same-origin', cache: 'no-store' });
            const config = await configResponse.json().catch(() => ({}));
            if (!configResponse.ok || !config.available || !config.public_key) {
                throw new Error('Push Notification មិនទាន់បានកំណត់នៅ Server ទេ។');
            }
            const permission = await Notification.requestPermission();
            pushDenied = permission === 'denied';
            if (permission !== 'granted') throw new Error('សូមអនុញ្ញាត Notification ក្នុង Browser settings។');
            const registration = await navigator.serviceWorker.ready;
            let subscription = await registration.pushManager.getSubscription();
            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(config.public_key)
                });
            }
            await savePushSubscription(subscription);
            pushEnabled = true;
            errorMessage = '';
        } catch (error) {
            errorMessage = error.message || 'មិនអាចបើក Push Notification បានទេ។';
        } finally {
            pushBusy = false;
        }
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
            activeConversation = { ...activeConversation, block_state: payload.block_state || {} };
            memberSearch = '';
            memberResults = [];
            connectRealtime(activeConversation.realtime_topic);
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
        connectRealtime(conversation.realtime_topic);
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
            if (payload.member) activeMember = payload.member;
            activeConversation = { ...activeConversation, ...(payload.conversation || {}), block_state: payload.block_state || activeConversation.block_state || {} };
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
            sendTyping(false);
            errorMessage = '';
            await tick();
            listElement?.scrollTo({ top: listElement.scrollHeight, behavior: 'smooth' });
        } catch (error) {
            errorMessage = error.message || 'មិនអាចផ្ញើសារបានទេ។';
        } finally {
            sending = false;
        }
    }

    async function updateBlock(action) {
        if (!activeConversation?.id || safetyBusy) return;
        const label = action === 'block' ? `បិទការទាក់ទងពី ${nameOf(activeMember)}?` : `បើកការទាក់ទងជាមួយ ${nameOf(activeMember)} វិញ?`;
        if (!confirm(label)) return;
        safetyBusy = true;
        try {
            const response = await fetch('/api/private-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ action, conversation_id: activeConversation.id })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចកែស្ថានភាព Block បានទេ។');
            activeConversation = { ...activeConversation, block_state: payload.block_state || {} };
            showSafetyMenu = false;
            errorMessage = '';
        } catch (error) {
            errorMessage = error.message || 'មិនអាចកែស្ថានភាព Block បានទេ។';
        } finally {
            safetyBusy = false;
        }
    }

    async function submitReport() {
        if (!activeConversation?.id || safetyBusy) return;
        safetyBusy = true;
        try {
            const response = await fetch('/api/private-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    action: 'report',
                    conversation_id: activeConversation.id,
                    reason: reportReason,
                    details: reportDetails.trim()
                })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចផ្ញើ Report បានទេ។');
            showReportForm = false;
            showSafetyMenu = false;
            reportReason = 'spam';
            reportDetails = '';
            successMessage = 'បានផ្ញើ Report ទៅអ្នកគ្រប់គ្រងរួចហើយ។';
        } catch (error) {
            errorMessage = error.message || 'មិនអាចផ្ញើ Report បានទេ។';
        } finally {
            safetyBusy = false;
        }
    }

    function backToList() {
        sendTyping(false);
        cleanupRealtime();
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
            <header class="relative flex min-h-16 items-center gap-3 bg-gradient-to-r from-blue-700 to-cyan-600 px-4 py-3 text-white">
                {#if activeConversation}
                    <button class="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-xl hover:bg-white/20" on:click={backToList} aria-label="ត្រឡប់ក្រោយ">←</button>
                {:else}
                    <span class="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-xl">💬</span>
                {/if}
                <div class="min-w-0 flex-1">
                    <h2 id="private-chat-title" class="truncate text-base font-black">{activeMember ? nameOf(activeMember) : 'Private Chat'}</h2>
                    <p class="truncate text-xs font-semibold text-white/75">
                        {#if activeMember && typing}កំពុងវាយសារ…{:else if activeMember}{realtimeConnected ? 'ភ្ជាប់ Realtime' : 'កំពុងភ្ជាប់…'}{:else}ស្វែងរក និងផ្ញើសារទៅសមាជិក{/if}
                    </p>
                </div>
                {#if activeConversation}
                    <button class="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-xl hover:bg-white/20" on:click={() => showSafetyMenu = !showSafetyMenu} aria-label="សុវត្ថិភាព Chat">⋮</button>
                    {#if showSafetyMenu}
                        <div class="absolute right-12 top-14 z-20 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm font-bold text-slate-700 shadow-xl">
                            <button class="block w-full px-4 py-2 text-left hover:bg-slate-100" on:click={() => { showReportForm = true; showSafetyMenu = false; }}>⚑ Report</button>
                            {#if activeConversation.block_state?.blocked_by_me}
                                <button class="block w-full px-4 py-2 text-left text-blue-700 hover:bg-blue-50" on:click={() => updateBlock('unblock')} disabled={safetyBusy}>បើកការទាក់ទងវិញ</button>
                            {:else}
                                <button class="block w-full px-4 py-2 text-left text-red-700 hover:bg-red-50" on:click={() => updateBlock('block')} disabled={safetyBusy}>⛔ Block សមាជិក</button>
                            {/if}
                        </div>
                    {/if}
                {/if}
                <button class="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-xl hover:bg-white/20" on:click={() => dispatch('close')} aria-label="បិទ">×</button>
            </header>

            {#if errorMessage}
                <div class="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700">{errorMessage}</div>
            {/if}
            {#if successMessage}
                <div class="border-b border-green-200 bg-green-50 px-4 py-2 text-xs font-bold text-green-700">{successMessage}</div>
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
                                        {#if message.sender_id === currentUser?.id}<span>· {messageStatus(message)}</span>{/if}
                                    </div>
                                </div>
                            </div>
                        {/each}
                    {/if}
                </div>
                <div class="border-t border-slate-200 bg-white p-3">
                    {#if activeConversation.block_state?.blocked_by_me}
                        <div class="rounded-xl border border-red-200 bg-red-50 p-3 text-center text-xs font-bold text-red-700">អ្នកបាន Block សមាជិកនេះ។ <button class="ml-1 underline" on:click={() => updateBlock('unblock')}>បើកវិញ</button></div>
                    {:else if activeConversation.block_state?.blocked_by_member}
                        <div class="rounded-xl border border-slate-200 bg-slate-100 p-3 text-center text-xs font-bold text-slate-600">មិនអាចផ្ញើសារក្នុងការសន្ទនានេះបានទេ។</div>
                    {:else}
                        {#if typing}<div class="mb-1 text-xs font-bold text-blue-600">{nameOf(activeMember)} កំពុងវាយសារ…</div>{/if}
                        <div class="flex items-end gap-2">
                            <textarea bind:value={composer} rows="1" maxlength="2000" placeholder="សរសេរសារ..." class="max-h-28 min-h-11 flex-1 resize-y rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500" on:input={handleComposerInput} on:blur={() => sendTyping(false)} on:keydown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }}></textarea>
                            <button class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-lg text-white disabled:opacity-50" on:click={sendMessage} disabled={!composer.trim() || sending} aria-label="ផ្ញើសារ">➤</button>
                        </div>
                        <div class="mt-1 text-right text-[10px] text-slate-400">{composer.length}/2000</div>
                    {/if}
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
                    {#if pushSupported && !pushEnabled}
                        <button class="mb-3 flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-amber-900 disabled:opacity-60" on:click={enablePushNotifications} disabled={pushBusy || pushDenied}>
                            <span class="text-xl">🔔</span>
                            <span class="min-w-0 flex-1"><strong class="block text-xs">បើក Push Notification</strong><span class="block text-[10px] opacity-75">ទទួលដំណឹងពេលមានសារថ្មី ទោះបិទ Chat ក៏ដោយ</span></span>
                            {#if pushBusy}<span class="loading loading-spinner loading-xs"></span>{/if}
                        </button>
                    {:else if pushEnabled}
                        <div class="mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700">🔔 Push Notification បានបើក</div>
                    {/if}
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

            {#if showReportForm}
                <div class="absolute inset-0 z-30 grid place-items-center bg-slate-950/50 p-4">
                    <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
                        <h3 class="text-lg font-black text-slate-900">Report {nameOf(activeMember)}</h3>
                        <p class="mt-1 text-xs text-slate-500">Report នឹងត្រូវផ្ញើទៅអ្នកគ្រប់គ្រងដោយសម្ងាត់។</p>
                        <label class="mt-4 block text-xs font-bold text-slate-700" for="chat-report-reason">មូលហេតុ</label>
                        <select id="chat-report-reason" bind:value={reportReason} class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                            <option value="spam">Spam</option>
                            <option value="harassment">ការរំខាន ឬគំរាមកំហែង</option>
                            <option value="inappropriate">ខ្លឹមសារមិនសមរម្យ</option>
                            <option value="privacy">បញ្ហាឯកជនភាព</option>
                            <option value="other">ផ្សេងៗ</option>
                        </select>
                        <label class="mt-3 block text-xs font-bold text-slate-700" for="chat-report-details">ព័ត៌មានបន្ថែម</label>
                        <textarea id="chat-report-details" bind:value={reportDetails} maxlength="1000" rows="4" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="ពណ៌នាបញ្ហា..."></textarea>
                        <div class="mt-4 flex gap-2">
                            <button class="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold" on:click={() => showReportForm = false} disabled={safetyBusy}>បោះបង់</button>
                            <button class="flex-1 rounded-xl bg-red-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50" on:click={submitReport} disabled={safetyBusy}>{safetyBusy ? 'កំពុងផ្ញើ…' : 'ផ្ញើ Report'}</button>
                        </div>
                    </div>
                </div>
            {/if}
        </div>
    </div>
{/if}
