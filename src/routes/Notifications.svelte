<script>
    import { onMount } from 'svelte';

    export let supabase;

    // ជំនួសការប្រើ alert ជាមួយប្រព័ន្ធ Toast Notification (ប្រសិនបើមាន)
    // import { addToast } from '$lib/stores/toast';

    let notificationForm = { title: '', message: '', type: 'info' };
    let adminNotifications = [];
    let sendingNotification = false;

    onMount(() => {
        loadAdminNotifications();
    });

    async function loadAdminNotifications() {
        const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
        adminNotifications = data || [];
    }

    async function sendNotification() {
        if (!notificationForm.title || !notificationForm.message) {
            alert("សូមបំពេញចំណងជើង និងខ្លឹមសារ!"); // អាចប្តូរទៅជា addToast("...", "warning");
            return;
        }
        
        sendingNotification = true;
        
        const { error: pushError } = await supabase.functions.invoke('push-notification', {
            body: {
                title: notificationForm.title,
                message: notificationForm.message,
                type: notificationForm.type
            }
        });

        if (pushError) {
            console.warn("Push notification failed:", pushError);
            alert("បរាជ័យក្នុងការផ្ញើការជូនដំណឹង (Edge Function): " + pushError.message); // អាចប្តូរទៅជា addToast("...", "error");
            sendingNotification = false;
            return;
        }

        const { error } = await supabase.from('notifications').insert({
            title: notificationForm.title,
            message: notificationForm.message,
            type: notificationForm.type,
            created_at: new Date().toISOString()
        });
        
        if (error) {
            console.error("Database Insert Error:", error);
            alert("បានផ្ញើការជូនដំណឹងជោគជ័យ! (ប៉ុន្តែការរក្សាទុកក្នុងប្រវត្តិបរាជ័យ)"); // អាចប្តូរទៅជា addToast("...", "warning");
        } else {
            alert("បានផ្ញើការជូនដំណឹងជោគជ័យ!"); // អាចប្តូរទៅជា addToast("...", "success");
            loadAdminNotifications();
        }
        
        notificationForm = { title: '', message: '', type: 'info' };
        sendingNotification = false;
    }

    async function deleteNotification(id) {
        if(!confirm("លុបការជូនដំណឹងនេះ?")) return;
        await supabase.from('notifications').delete().eq('id', id);
        loadAdminNotifications();
    }
</script>

<div class="glass-panel rounded-3xl p-5">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- Form -->
        <div class="bg-white p-4 rounded-xl shadow-sm border h-fit">
            <h3 class="font-bold text-lg mb-4">ផ្ញើការជូនដំណឹងថ្មី</h3>
            <div class="form-control w-full mb-2"><label class="label">ចំណងជើង</label><input bind:value={notificationForm.title} class="input input-bordered w-full" placeholder="ចំណងជើង..." /></div>
            <div class="form-control w-full mb-2"><label class="label">ខ្លឹមសារ</label><textarea bind:value={notificationForm.message} class="textarea textarea-bordered w-full h-24" placeholder="សរសេរខ្លឹមសារនៅទីនេះ..."></textarea></div>
            <div class="form-control w-full mb-4"><label class="label">ប្រភេទ</label><select bind:value={notificationForm.type} class="select select-bordered w-full"><option value="info">ព័ត៌មាន (Info)</option><option value="warning">ព្រមាន (Warning)</option><option value="success">ជោគជ័យ (Success)</option></select></div>
            <button on:click={sendNotification} class="btn btn-primary w-full" disabled={sendingNotification}>
                {#if sendingNotification}<span class="loading loading-spinner loading-xs"></span>{/if}
                ផ្ញើការជូនដំណឹង
            </button>
        </div>
        <!-- List -->
        <div class="md:col-span-2 bg-white p-4 rounded-xl shadow-sm border">
            <h3 class="font-bold text-lg mb-4">ប្រវត្តិការជូនដំណឹង</h3>
            <div class="flex flex-col gap-2 max-h-[500px] overflow-y-auto">
                {#each adminNotifications as notif}
                    <div class="p-3 border rounded-lg flex justify-between items-start hover:bg-gray-50"><div><div class="font-bold text-gray-800">{notif.title} <span class="badge badge-xs badge-ghost">{notif.type}</span></div><p class="text-sm text-gray-600 mt-1">{notif.message}</p><div class="text-xs text-gray-400 mt-2">{new Date(notif.created_at).toLocaleString('km-KH')}</div></div><button on:click={() => deleteNotification(notif.id)} class="btn btn-xs btn-ghost text-error">លុប</button></div>
                {/each}
            </div>
        </div>
    </div>
</div>