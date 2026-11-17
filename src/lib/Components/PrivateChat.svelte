<script>
    import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';

    export let open = false;
    export let currentUser;
    export let supabase;

    const dispatch = createEventDispatcher();
    const allowedFileTypes = new Set([
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]);
    const maxFileSize = 10 * 1024 * 1024;
    const reactionOptions = ['👍', '❤️', '😂'];

    let conversations = [];
    let activeConversation = null;
    let activeMember = null;
    let messages = [];
    let loading = false;
    let loadingOlder = false;
    let hasMore = false;
    let sending = false;
    let composer = '';
    let replyTo = null;
    let editingMessage = null;
    let selectedFile = null;
    let fileInput;
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
    let memberOnline = false;
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
    let showArchived = false;
    let archivedCount = 0;

    $: if (open && !wasOpen) {
        wasOpen = true;
        loadConversations();
    }
    $: if (!open && wasOpen) {
        wasOpen = false;
        resetActiveConversation();
        memberSearch = '';
        memberResults = [];
    }

    onMount(() => {
        pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        pushDenied = pushSupported && Notification.permission === 'denied';
        if (pushSupported && Notification.permission === 'granted') syncPushSubscription();
        pollTimer = setInterval(() => {
            if (!open || document.visibilityState !== 'visible') return;
            if (activeConversation) loadMessages(false);
            else loadConversations(false);
        }, 30000);
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

    function lastSeenText(value) {
        if (memberOnline) return 'សកម្មឥឡូវនេះ';
        if (!value) return realtimeConnected ? 'Offline' : 'កំពុងភ្ជាប់…';
        const elapsed = Date.now() - new Date(value).getTime();
        if (elapsed < 60_000) return 'សកម្មមុននេះបន្តិច';
        if (elapsed < 3_600_000) return `សកម្ម ${Math.floor(elapsed / 60_000)} នាទីមុន`;
        if (elapsed < 86_400_000) return `សកម្ម ${Math.floor(elapsed / 3_600_000)} ម៉ោងមុន`;
        return `សកម្មចុងក្រោយ ${timeOf(value)}`;
    }

    function messageStatus(message) {
        if (message.read_at) return 'បានមើល ✓✓';
        if (message.delivered_at) return 'បានទទួល ✓✓';
        return 'បានផ្ញើ ✓';
    }

    function fileSize(value) {
        const size = Number(value || 0);
        if (size < 1024) return `${size} B`;
        if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
        return `${(size / 1024 / 1024).toFixed(1)} MB`;
    }

    function isImage(message) {
        return String(message?.attachment_type || '').startsWith('image/');
    }

    function canEdit(message) {
        return message.sender_id === currentUser?.id && !message.deleted_at;
    }

    function cleanupRealtime() {
        if (realtimeChannel && supabase) {
            realtimeChannel.untrack().catch(() => {});
            supabase.removeChannel(realtimeChannel).catch(() => {});
        }
        realtimeChannel = null;
        realtimeConnected = false;
        memberOnline = false;
        typing = false;
        clearTimeout(typingTimer);
    }

    function connectRealtime(topic) {
        cleanupRealtime();
        if (!supabase || !topic) return;
        realtimeChannel = supabase.channel(`private-chat:${topic}`, {
            config: {
                private: false,
                broadcast: { self: false, ack: false },
                presence: { key: currentUser?.id }
            }
        });
        realtimeChannel
            .on('broadcast', { event: 'message' }, ({ payload }) => {
                if (payload?.sender_id !== currentUser?.id) loadMessages(false);
            })
            .on('broadcast', { event: 'message_update' }, () => loadMessages(false))
            .on('broadcast', { event: 'receipt' }, () => loadMessages(false))
            .on('broadcast', { event: 'block' }, () => loadMessages(false))
            .on('broadcast', { event: 'typing' }, ({ payload }) => {
                if (payload?.user_id === currentUser?.id) return;
                typing = Boolean(payload?.typing);
                clearTimeout(typingTimer);
                if (typing) typingTimer = setTimeout(() => typing = false, 2500);
            })
            .on('presence', { event: 'sync' }, () => {
                const present = Object.values(realtimeChannel?.presenceState() || {}).flat();
                memberOnline = present.some(item => item?.user_id === activeMember?.id);
            })
            .subscribe(async status => {
                realtimeConnected = status === 'SUBSCRIBED';
                if (status === 'SUBSCRIBED') {
                    await realtimeChannel.track({ user_id: currentUser?.id, online_at: new Date().toISOString() }).catch(() => {});
                }
            });
    }

    function sendTyping(isTyping = true) {
        if (!realtimeChannel || !realtimeConnected) return;
        const now = Date.now();
        if (isTyping && now - lastTypingSent < 900) return;
        lastTypingSent = now;
        realtimeChannel.send({
            type: 'broadcast', event: 'typing',
            payload: { user_id: currentUser?.id, typing: isTyping }
        }).catch(() => {});
    }

    function handleComposerInput() {
        sendTyping(Boolean(composer.trim()));
    }

    function urlBase64ToUint8Array(value) {
        const padding = '='.repeat((4 - value.length % 4) % 4);
        const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
        return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    }

    async function savePushSubscription(subscription) {
        const response = await fetch('/api/subscribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
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
            if (!configResponse.ok || !config.available || !config.public_key) throw new Error('Push Notification មិនទាន់បានកំណត់នៅ Server ទេ។');
            const permission = await Notification.requestPermission();
            pushDenied = permission === 'denied';
            if (permission !== 'granted') throw new Error('សូមអនុញ្ញាត Notification ក្នុង Browser settings។');
            const registration = await navigator.serviceWorker.ready;
            let subscription = await registration.pushManager.getSubscription();
            if (!subscription) subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(config.public_key)
            });
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
            const response = await fetch(`/api/private-chat${showArchived ? '?archived=1' : ''}`, { credentials: 'same-origin', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចទាញយកសារបានទេ។');
            conversations = payload.conversations || [];
            archivedCount = payload.archived_count || 0;
            dispatch('count', payload.unread_count || 0);
            errorMessage = '';
        } catch (error) {
            errorMessage = error.message || 'មិនអាចទាញយកសារបានទេ។';
        } finally {
            loading = false;
        }
    }

    async function toggleArchivedList() {
        showArchived = !showArchived;
        conversations = [];
        await loadConversations();
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
            const response = await fetch(`/api/private-chat?search=${encodeURIComponent(memberSearch.trim())}`, { credentials: 'same-origin', cache: 'no-store' });
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
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
                body: JSON.stringify({ action: 'start', user_id: member.id })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចចាប់ផ្ដើម Chat បានទេ។');
            activeConversation = { ...payload.conversation, block_state: payload.block_state || {}, settings: payload.settings || {} };
            activeMember = payload.member;
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

    function mergeMessages(existing, incoming) {
        const map = new Map(existing.map(message => [message.id, message]));
        for (const message of incoming) map.set(message.id, message);
        return [...map.values()].sort((left, right) => new Date(left.created_at) - new Date(right.created_at));
    }

    async function loadMessages(showLoader = true, older = false) {
        if (!activeConversation?.id || loadingOlder) return;
        if (older) loadingOlder = true;
        else if (showLoader) loading = true;
        const previousLast = messages.at(-1)?.id;
        const previousHeight = listElement?.scrollHeight || 0;
        try {
            const before = older && messages[0]?.created_at ? `&before=${encodeURIComponent(messages[0].created_at)}` : '';
            const response = await fetch(`/api/private-chat?conversation_id=${encodeURIComponent(activeConversation.id)}&limit=50${before}`, { credentials: 'same-origin', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចទាញយកសារបានទេ។');
            if (older) messages = mergeMessages(payload.messages || [], messages);
            else if (showLoader) messages = payload.messages || [];
            else messages = mergeMessages(messages, payload.messages || []);
            if (payload.member) activeMember = payload.member;
            activeConversation = {
                ...activeConversation, ...(payload.conversation || {}),
                block_state: payload.block_state || activeConversation.block_state || {},
                settings: payload.settings || activeConversation.settings || {}
            };
            if (older || showLoader) hasMore = Boolean(payload.has_more);
            await markRead();
            await tick();
            if (older && listElement) listElement.scrollTop = listElement.scrollHeight - previousHeight;
            else if (showLoader || previousLast !== messages.at(-1)?.id) listElement?.scrollTo({ top: listElement.scrollHeight, behavior: showLoader ? 'auto' : 'smooth' });
        } catch (error) {
            errorMessage = error.message || 'មិនអាចទាញយកសារបានទេ។';
        } finally {
            loading = false;
            loadingOlder = false;
        }
    }

    async function markRead() {
        if (!activeConversation?.id || !messages.some(message => message.sender_id !== currentUser?.id && !message.read_at)) return;
        const response = await fetch('/api/private-chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify({ action: 'mark_read', conversation_id: activeConversation.id })
        });
        if (response.ok) {
            const now = new Date().toISOString();
            messages = messages.map(message => message.sender_id !== currentUser?.id && !message.read_at ? { ...message, read_at: now } : message);
            conversations = conversations.map(item => item.id === activeConversation.id ? { ...item, unread_count: 0 } : item);
            dispatch('count', conversations.reduce((total, item) => total + Number(item.unread_count || 0), 0));
        }
    }

    function chooseFile(event) {
        const file = event.currentTarget.files?.[0] || null;
        if (!file) return;
        if (!allowedFileTypes.has(file.type)) {
            errorMessage = 'អនុញ្ញាតតែរូបភាព PDF Word Excel PowerPoint និង TXT ប៉ុណ្ណោះ។';
            event.currentTarget.value = '';
            return;
        }
        if (file.size > maxFileSize) {
            errorMessage = 'ឯកសារត្រូវមានទំហំមិនលើស 10MB។';
            event.currentTarget.value = '';
            return;
        }
        selectedFile = file;
        editingMessage = null;
        errorMessage = '';
    }

    function clearComposerContext() {
        replyTo = null;
        editingMessage = null;
        selectedFile = null;
        if (fileInput) fileInput.value = '';
    }

    function beginReply(message) {
        replyTo = message;
        editingMessage = null;
    }

    function beginEdit(message) {
        editingMessage = message;
        replyTo = null;
        selectedFile = null;
        composer = message.body || '';
    }

    async function sendMessage() {
        const text = composer.trim();
        if ((!text && !selectedFile) || sending || !activeConversation?.id) return;
        sending = true;
        try {
            let response;
            if (editingMessage) {
                response = await fetch('/api/private-chat', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
                    body: JSON.stringify({ action: 'edit', conversation_id: activeConversation.id, message_id: editingMessage.id, body: text })
                });
            } else if (selectedFile) {
                const form = new FormData();
                form.append('action', 'send');
                form.append('conversation_id', activeConversation.id);
                form.append('body', text);
                if (replyTo?.id) form.append('reply_to_id', replyTo.id);
                form.append('file', selectedFile);
                response = await fetch('/api/private-chat', { method: 'POST', credentials: 'same-origin', body: form });
            } else {
                response = await fetch('/api/private-chat', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
                    body: JSON.stringify({ action: 'send', conversation_id: activeConversation.id, body: text, reply_to_id: replyTo?.id || null })
                });
            }
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចផ្ញើសារបានទេ។');
            messages = mergeMessages(messages, [payload.message]);
            composer = '';
            clearComposerContext();
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

    async function deleteMessage(message) {
        if (!confirm('លុបសារនេះមែនទេ?')) return;
        try {
            const response = await fetch('/api/private-chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
                body: JSON.stringify({ action: 'delete', conversation_id: activeConversation.id, message_id: message.id })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចលុបសារបានទេ។');
            messages = mergeMessages(messages, [payload.message]);
        } catch (error) {
            errorMessage = error.message || 'មិនអាចលុបសារបានទេ។';
        }
    }

    async function reactToMessage(message, emoji) {
        try {
            const response = await fetch('/api/private-chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
                body: JSON.stringify({ action: 'react', conversation_id: activeConversation.id, message_id: message.id, emoji })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចដាក់ Reaction បានទេ។');
            await loadMessages(false);
        } catch (error) {
            errorMessage = error.message || 'មិនអាចដាក់ Reaction បានទេ។';
        }
    }

    async function updateSetting(action, enabled) {
        if (!activeConversation?.id || safetyBusy) return;
        safetyBusy = true;
        try {
            const response = await fetch('/api/private-chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
                body: JSON.stringify({ action, conversation_id: activeConversation.id, enabled })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចកែការកំណត់បានទេ។');
            activeConversation = { ...activeConversation, settings: payload.settings || {} };
            showSafetyMenu = false;
            if (action === 'set_archive') backToList();
        } catch (error) {
            errorMessage = error.message || 'មិនអាចកែការកំណត់បានទេ។';
        } finally {
            safetyBusy = false;
        }
    }

    async function updateBlock(action) {
        if (!activeConversation?.id || safetyBusy) return;
        const label = action === 'block' ? `បិទការទាក់ទងពី ${nameOf(activeMember)}?` : `បើកការទាក់ទងជាមួយ ${nameOf(activeMember)} វិញ?`;
        if (!confirm(label)) return;
        safetyBusy = true;
        try {
            const response = await fetch('/api/private-chat', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
                body: JSON.stringify({ action, conversation_id: activeConversation.id })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចកែស្ថានភាព Block បានទេ។');
            activeConversation = { ...activeConversation, block_state: payload.block_state || {} };
            showSafetyMenu = false;
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
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
                body: JSON.stringify({ action: 'report', conversation_id: activeConversation.id, reason: reportReason, details: reportDetails.trim() })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចផ្ញើ Report បានទេ។');
            showReportForm = false;
            reportReason = 'spam';
            reportDetails = '';
            successMessage = 'បានផ្ញើ Report ទៅអ្នកគ្រប់គ្រងរួចហើយ។';
        } catch (error) {
            errorMessage = error.message || 'មិនអាចផ្ញើ Report បានទេ។';
        } finally {
            safetyBusy = false;
        }
    }

    function resetActiveConversation() {
        sendTyping(false);
        cleanupRealtime();
        activeConversation = null;
        activeMember = null;
        messages = [];
        composer = '';
        hasMore = false;
        clearComposerContext();
    }

    function backToList() {
        resetActiveConversation();
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
                {:else}<span class="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-xl">💬</span>{/if}
                <div class="min-w-0 flex-1">
                    <h2 id="private-chat-title" class="truncate text-base font-black">{activeMember ? nameOf(activeMember) : 'Private Chat'}</h2>
                    <p class="truncate text-xs font-semibold text-white/75">
                        {#if activeMember && typing}កំពុងវាយសារ…{:else if activeMember}{lastSeenText(activeMember.last_seen_at)}{:else}ស្វែងរក និងផ្ញើសារទៅសមាជិក{/if}
                    </p>
                </div>
                {#if activeConversation}
                    <button class="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-xl hover:bg-white/20" on:click={() => showSafetyMenu = !showSafetyMenu} aria-label="ការកំណត់ Chat">⋮</button>
                    {#if showSafetyMenu}
                        <div class="absolute right-12 top-14 z-20 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm font-bold text-slate-700 shadow-xl">
                            <button class="block w-full px-4 py-2 text-left hover:bg-slate-100" on:click={() => updateSetting('set_mute', !activeConversation.settings?.muted)}>{activeConversation.settings?.muted ? '🔔 បើកការជូនដំណឹង' : '🔕 បិទការជូនដំណឹង'}</button>
                            <button class="block w-full px-4 py-2 text-left hover:bg-slate-100" on:click={() => updateSetting('set_archive', !activeConversation.settings?.archived_at)}>{activeConversation.settings?.archived_at ? 'យកចេញពី Archive' : '🗄️ ដាក់ក្នុង Archive'}</button>
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

            {#if errorMessage}<div class="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700">{errorMessage}</div>{/if}
            {#if successMessage}<div class="border-b border-green-200 bg-green-50 px-4 py-2 text-xs font-bold text-green-700">{successMessage}</div>{/if}

            {#if activeConversation}
                <div bind:this={listElement} class="flex-1 space-y-3 overflow-y-auto bg-slate-100 p-4">
                    {#if hasMore}
                        <div class="text-center"><button class="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-xs font-bold text-slate-600 disabled:opacity-50" on:click={() => loadMessages(false, true)} disabled={loadingOlder}>{loadingOlder ? 'កំពុងទាញ…' : 'ទាញសារចាស់បន្ថែម'}</button></div>
                    {/if}
                    {#if loading && messages.length === 0}
                        <div class="flex h-40 items-center justify-center"><span class="loading loading-spinner text-blue-600"></span></div>
                    {:else if messages.length === 0}
                        <div class="flex h-48 flex-col items-center justify-center text-center text-slate-500"><div class="text-4xl">👋</div><strong class="mt-3">ចាប់ផ្ដើមការសន្ទនា</strong><span class="mt-1 text-xs">ផ្ញើសារដំបូងទៅ {nameOf(activeMember)}</span></div>
                    {:else}
                        {#each messages as message (message.id)}
                            <div class="group flex {message.sender_id === currentUser?.id ? 'justify-end' : 'justify-start'}">
                                <div class="max-w-[86%]">
                                    <div class="rounded-2xl px-3 py-2 shadow-sm {message.sender_id === currentUser?.id ? 'rounded-br-sm bg-blue-600 text-white' : 'rounded-bl-sm bg-white text-slate-800'}">
                                        {#if message.reply_to}
                                            <div class="mb-2 rounded-lg border-l-4 border-cyan-300 bg-black/10 px-2 py-1 text-[11px] opacity-90">
                                                {message.reply_to.deleted ? 'សារដែលបានលុប' : (message.reply_to.body || `📎 ${message.reply_to.attachment_name || 'ឯកសារ'}`)}
                                            </div>
                                        {/if}
                                        {#if message.deleted_at}
                                            <p class="text-sm italic opacity-70">សារនេះត្រូវបានលុប</p>
                                        {:else}
                                            {#if message.attachment_url}
                                                {#if isImage(message)}
                                                    <a href={message.attachment_url} target="_blank" rel="noopener"><img src={message.attachment_url} alt={message.attachment_name || 'រូបភាព'} class="mb-2 max-h-64 w-full rounded-xl object-contain" loading="lazy" /></a>
                                                {:else}
                                                    <a href={message.attachment_url} target="_blank" rel="noopener" class="mb-2 flex items-center gap-2 rounded-xl bg-black/10 p-2 text-xs font-bold underline"><span class="text-xl">📎</span><span class="min-w-0 flex-1 break-all">{message.attachment_name}<small class="block opacity-70">{fileSize(message.attachment_size)}</small></span></a>
                                                {/if}
                                            {/if}
                                            {#if message.body}<p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>{/if}
                                        {/if}
                                        <div class="mt-1 flex items-center justify-end gap-1 text-[10px] {message.sender_id === currentUser?.id ? 'text-white/70' : 'text-slate-400'}">
                                            <span>{timeOf(message.created_at)}</span>{#if message.edited_at}<span>· បានកែ</span>{/if}{#if message.sender_id === currentUser?.id}<span>· {messageStatus(message)}</span>{/if}
                                        </div>
                                    </div>
                                    {#if !message.deleted_at}
                                        <div class="mt-1 flex flex-wrap items-center gap-1 {message.sender_id === currentUser?.id ? 'justify-end' : 'justify-start'}">
                                            {#each reactionOptions as emoji}
                                                {@const reaction = message.reactions?.find(item => item.emoji === emoji)}
                                                <button class="rounded-full border px-1.5 py-0.5 text-[11px] {reaction?.reacted_by_me ? 'border-blue-400 bg-blue-100' : 'border-slate-200 bg-white'}" on:click={() => reactToMessage(message, emoji)} aria-label={`Reaction ${emoji}`}>{emoji}{#if reaction?.count} {reaction.count}{/if}</button>
                                            {/each}
                                            <button class="px-1 text-[10px] font-bold text-slate-500" on:click={() => beginReply(message)}>ឆ្លើយតប</button>
                                            {#if canEdit(message)}<button class="px-1 text-[10px] font-bold text-blue-600" on:click={() => beginEdit(message)}>✏️ កែសារ</button>{/if}
                                            {#if message.sender_id === currentUser?.id}<button class="px-1 text-[10px] font-bold text-red-500" on:click={() => deleteMessage(message)}>លុប</button>{/if}
                                        </div>
                                    {/if}
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
                        {#if replyTo || editingMessage || selectedFile}
                            <div class="mb-2 flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs text-slate-700">
                                <span class="min-w-0 flex-1 truncate">{editingMessage ? '✏️ កែសារ' : replyTo ? `↩️ ឆ្លើយតប៖ ${replyTo.body || replyTo.attachment_name || 'ឯកសារ'}` : `📎 ${selectedFile?.name} (${fileSize(selectedFile?.size)})`}</span>
                                <button class="font-black" on:click={clearComposerContext} aria-label="បោះបង់">×</button>
                            </div>
                        {/if}
                        <div class="flex items-end gap-2">
                            <label class="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-xl border border-slate-300 bg-white text-lg" title="ផ្ញើរូបភាព ឬឯកសារ">📎<input bind:this={fileInput} type="file" class="hidden" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx" on:change={chooseFile} disabled={Boolean(editingMessage)} /></label>
                            <textarea bind:value={composer} rows="1" maxlength="2000" placeholder={editingMessage ? 'កែសារ...' : 'សរសេរសារ...'} class="max-h-28 min-h-11 flex-1 resize-y rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-blue-500" on:input={handleComposerInput} on:blur={() => sendTyping(false)} on:keydown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }}></textarea>
                            <button class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-600 text-lg text-white disabled:opacity-50" on:click={sendMessage} disabled={(!composer.trim() && !selectedFile) || sending} aria-label="ផ្ញើសារ">{sending ? '…' : '➤'}</button>
                        </div>
                        <div class="mt-1 flex justify-between text-[10px] text-slate-400"><span>ឯកសារអតិបរមា 10MB</span><span>{composer.length}/2000</span></div>
                    {/if}
                </div>
            {:else}
                <div class="border-b border-slate-200 bg-white p-3">
                    <label class="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 focus-within:border-blue-500"><span>🔎</span><input bind:value={memberSearch} on:input={scheduleMemberSearch} class="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" placeholder="ស្វែងរកឈ្មោះសមាជិក..." />{#if searching}<span class="loading loading-spinner loading-xs text-blue-600"></span>{/if}</label>
                </div>
                <div class="flex-1 overflow-y-auto bg-slate-50 p-3">
                    {#if pushSupported && !pushEnabled}
                        <button class="mb-3 flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-amber-900 disabled:opacity-60" on:click={enablePushNotifications} disabled={pushBusy || pushDenied}><span class="text-xl">🔔</span><span class="min-w-0 flex-1"><strong class="block text-xs">បើក Push Notification</strong><span class="block text-[10px] opacity-75">ទទួលដំណឹងពេលមានសារថ្មី ទោះបិទ Chat ក៏ដោយ</span></span>{#if pushBusy}<span class="loading loading-spinner loading-xs"></span>{/if}</button>
                    {:else if pushEnabled}<div class="mb-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700">🔔 Push Notification បានបើក</div>{/if}
                    {#if memberSearch.trim().length >= 2}
                        <div class="mb-2 text-xs font-black text-slate-500">លទ្ធផលស្វែងរក</div>
                        {#if !searching && memberResults.length === 0}<div class="rounded-xl bg-white p-5 text-center text-sm text-slate-500">រកមិនឃើញសមាជិក</div>{:else}<div class="space-y-2">{#each memberResults as member (member.id)}<button class="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-300 hover:bg-blue-50" on:click={() => startChat(member)}><div class="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 font-black text-blue-700">{#if member.avatar_url}<img src={member.avatar_url} alt="" class="h-full w-full object-cover" />{:else}{initials(member)}{/if}</div><div class="min-w-0"><strong class="block truncate text-sm text-slate-800">{nameOf(member)}</strong><span class="text-xs text-slate-400">ចាប់ផ្ដើម Chat</span></div></button>{/each}</div>{/if}
                    {:else if loading}
                        <div class="flex h-40 items-center justify-center"><span class="loading loading-spinner text-blue-600"></span></div>
                    {:else}
                        <div class="mb-3 flex items-center justify-between"><strong class="text-xs text-slate-500">{showArchived ? 'សារ Archive' : 'ការសន្ទនា'}</strong><button class="rounded-full border border-slate-300 bg-white px-3 py-1 text-[10px] font-bold text-slate-600" on:click={toggleArchivedList}>{showArchived ? '← សារធម្មតា' : `Archive${archivedCount ? ` (${archivedCount})` : ''}`}</button></div>
                        {#if conversations.length === 0}<div class="flex h-56 flex-col items-center justify-center text-center text-slate-500"><div class="text-4xl">💬</div><strong class="mt-3">{showArchived ? 'មិនមានសារ Archive' : 'មិនទាន់មានការសន្ទនា'}</strong><span class="mt-1 text-xs">{showArchived ? 'សារដែលដាក់ Archive នឹងបង្ហាញទីនេះ។' : 'ស្វែងរកឈ្មោះសមាជិកដើម្បីចាប់ផ្ដើម។'}</span></div>{:else}<div class="space-y-2">{#each conversations as conversation (conversation.id)}<button class="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-300" on:click={() => openConversation(conversation)}><div class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-blue-100 font-black text-blue-700">{#if conversation.member?.avatar_url}<img src={conversation.member.avatar_url} alt="" class="h-full w-full object-cover" />{:else}{initials(conversation.member)}{/if}</div><div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-2"><strong class="truncate text-sm text-slate-800">{nameOf(conversation.member)} {conversation.settings?.muted ? '🔕' : ''}</strong><span class="text-[10px] text-slate-400">{timeOf(conversation.last_message?.created_at || conversation.last_message_at)}</span></div><p class="mt-1 truncate text-xs {conversation.unread_count ? 'font-bold text-slate-700' : 'text-slate-400'}">{conversation.last_message?.sender_id === currentUser?.id ? 'អ្នក: ' : ''}{conversation.last_message?.body || 'ការសន្ទនាថ្មី'}</p></div>{#if conversation.unread_count}<span class="grid h-6 min-w-6 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-black text-white">{conversation.unread_count > 99 ? '99+' : conversation.unread_count}</span>{/if}</button>{/each}</div>{/if}
                    {/if}
                </div>
            {/if}

            {#if showReportForm}
                <div class="absolute inset-0 z-30 grid place-items-center bg-slate-950/50 p-4"><div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"><h3 class="text-lg font-black text-slate-900">Report {nameOf(activeMember)}</h3><p class="mt-1 text-xs text-slate-500">Report នឹងត្រូវផ្ញើទៅអ្នកគ្រប់គ្រងដោយសម្ងាត់។</p><label class="mt-4 block text-xs font-bold text-slate-700" for="chat-report-reason">មូលហេតុ</label><select id="chat-report-reason" bind:value={reportReason} class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"><option value="spam">Spam</option><option value="harassment">ការរំខាន ឬគំរាមកំហែង</option><option value="inappropriate">ខ្លឹមសារមិនសមរម្យ</option><option value="privacy">បញ្ហាឯកជនភាព</option><option value="other">ផ្សេងៗ</option></select><label class="mt-3 block text-xs font-bold text-slate-700" for="chat-report-details">ព័ត៌មានបន្ថែម</label><textarea id="chat-report-details" bind:value={reportDetails} maxlength="1000" rows="4" class="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="ពណ៌នាបញ្ហា..."></textarea><div class="mt-4 flex gap-2"><button class="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold" on:click={() => showReportForm = false} disabled={safetyBusy}>បោះបង់</button><button class="flex-1 rounded-xl bg-red-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50" on:click={submitReport} disabled={safetyBusy}>{safetyBusy ? 'កំពុងផ្ញើ…' : 'ផ្ញើ Report'}</button></div></div></div>
            {/if}
        </div>
    </div>
{/if}
