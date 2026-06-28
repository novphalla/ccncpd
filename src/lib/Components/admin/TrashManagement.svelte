<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fade } from 'svelte/transition';

    export let supabase;

    const dispatch = createEventDispatcher();

    let deletedCourses = [];
    let deletedMeetings = [];
    let deletedForms = [];
    let loadingTrash = false;

    onMount(() => {
        loadTrash();
    });

    async function loadTrash() {
        loadingTrash = true;
        
        // Fetch all deleted data concurrently using Promise.all
        const [coursesRes, meetingsRes, formsRes] = await Promise.all([
            supabase.from('courses').select('id, title, deleted_at, thumbnail_url, is_published, cpd_points').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(200),
            supabase.from('live_meetings').select('id, title, deleted_at, scheduled_at').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(200),
            supabase.from('custom_forms').select('id, title, deleted_at, is_published').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(200)
        ]);

        // Handle Courses
        if (coursesRes.error) console.error("Error loading courses trash:", coursesRes.error);
        else deletedCourses = coursesRes.data || [];

        // Handle Meetings
        if (meetingsRes.error) console.error("Error loading meetings trash:", meetingsRes.error);
        else deletedMeetings = meetingsRes.data || [];

        // Handle Forms
        if (formsRes.error) console.error("Error loading forms trash:", formsRes.error);
        else deletedForms = formsRes.data || [];

        loadingTrash = false;
    }

    async function handleTrashAction(action, table, id, confirmMsg) {
        if (!confirm(confirmMsg)) return;
        
        let error;
        if (action === 'restore') {
            ({ error } = await supabase.from(table).update({ deleted_at: null }).eq('id', id));
        } else if (action === 'delete') {
            ({ error } = await supabase.from(table).delete().eq('id', id));
        }

        if (error) {
            alert(`Error: ${error.message}`);
        } else {
            loadTrash();
            if (action === 'restore') dispatch('refresh');
            alert(action === 'restore' ? "បានស្តារជោគជ័យ!" : "បានលុបជាស្ថាពរ!");
        }
    }
</script>

<div class="card bg-base-100 p-5 shadow-md border border-base-300">
    <div class="flex justify-between items-center mb-4">
        <h3 class="font-bold text-lg text-red-800">🗑️ ធុងសំរាម (Trash)</h3>
        <button class="btn btn-sm btn-primary" on:click={loadTrash}>
            {#if loadingTrash}<span class="loading loading-spinner loading-xs"></span>{/if}
            Refresh
        </button>
    </div>
    
    <h4 class="font-bold mb-2 text-gray-700">វគ្គសិក្សា (Courses)</h4>
    <div class="overflow-x-auto bg-base-100 rounded-xl border border-base-300">
        <table class="table w-full">
            <thead class="bg-base-200 text-base-content">
                <tr><th>ចំណងជើង</th><th>កាលបរិច្ឆេទលុប</th><th>សកម្មភាព</th></tr>
            </thead>
            <tbody>
                {#each deletedCourses as course, i}
                    <tr class="hover" in:fade={{ duration: 200, delay: i * 30 }}>
                        <td><div class="font-bold">{course.title}</div><div class="text-xs opacity-50">{course.description || ''}</div></td>
                        <td class="text-sm">{new Date(course.deleted_at).toLocaleString('km-KH')}</td>
                        <td><button class="btn btn-success btn-xs text-white mr-2" on:click={() => handleTrashAction('restore', 'courses', course.id, "តើអ្នកចង់ស្តារវគ្គនេះមកវិញមែនទេ?")}>♻️ ស្តារ</button><button class="btn btn-error btn-xs text-white" on:click={() => handleTrashAction('delete', 'courses', course.id, "⚠️ គ្រោះថ្នាក់! តើអ្នកពិតជាចង់លុបវគ្គនេះជាស្ថាពរមែនទេ?")}>🔥 លុបចោល</button></td>
                    </tr>
                {:else}<tr><td colspan="3" class="text-center py-8 text-gray-500">មិនមានវគ្គក្នុងធុងសំរាមទេ</td></tr>{/each}
            </tbody>
        </table>
    </div>

    <h4 class="font-bold mt-6 mb-2 text-gray-700">បែបបទ (Forms)</h4>
    <div class="overflow-x-auto bg-base-100 rounded-xl border border-base-300">
        <table class="table w-full">
            <thead class="bg-base-200 text-base-content">
                <tr><th>ចំណងជើង</th><th>កាលបរិច្ឆេទលុប</th><th>សកម្មភាព</th></tr>
            </thead>
            <tbody>
                {#each deletedForms as form, i}
                    <tr class="hover" in:fade={{ duration: 200, delay: i * 30 }}>
                        <td><div class="font-bold">{form.title}</div><div class="text-xs opacity-50">{form.description || ''}</div></td>
                        <td class="text-sm">{new Date(form.deleted_at).toLocaleString('km-KH')}</td>
                        <td><button class="btn btn-success btn-xs text-white mr-2" on:click={() => handleTrashAction('restore', 'custom_forms', form.id, "តើអ្នកចង់ស្តារបែបបទនេះមកវិញមែនទេ?")}>♻️ ស្តារ</button><button class="btn btn-error btn-xs text-white" on:click={() => handleTrashAction('delete', 'custom_forms', form.id, "⚠️ គ្រោះថ្នាក់! តើអ្នកពិតជាចង់លុបបែបបទនេះជាស្ថាពរមែនទេ?")}>🔥 លុបចោល</button></td>
                    </tr>
                {:else}<tr><td colspan="3" class="text-center py-8 text-gray-500">មិនមានបែបបទក្នុងធុងសំរាមទេ</td></tr>{/each}
            </tbody>
        </table>
    </div>

    <h4 class="font-bold mt-6 mb-2 text-gray-700">ការប្រជុំ (Meetings)</h4>
    <div class="overflow-x-auto bg-base-100 rounded-xl border border-base-300">
        <table class="table w-full">
            <thead class="bg-base-200 text-base-content">
                <tr><th>ចំណងជើង</th><th>កាលបរិច្ឆេទលុប</th><th>សកម្មភាព</th></tr>
            </thead>
            <tbody>
                {#each deletedMeetings as meeting, i}
                    <tr class="hover" in:fade={{ duration: 200, delay: i * 30 }}>
                        <td><div class="font-bold">{meeting.title}</div><div class="text-xs opacity-50">{new Date(meeting.scheduled_at).toLocaleString('km-KH')}</div></td>
                        <td class="text-sm">{new Date(meeting.deleted_at).toLocaleString('km-KH')}</td>
                        <td><button class="btn btn-success btn-xs text-white mr-2" on:click={() => handleTrashAction('restore', 'live_meetings', meeting.id, "តើអ្នកចង់ស្តារការប្រជុំនេះមកវិញមែនទេ?")}>♻️ ស្តារ</button><button class="btn btn-error btn-xs text-white" on:click={() => handleTrashAction('delete', 'live_meetings', meeting.id, "⚠️ គ្រោះថ្នាក់! តើអ្នកពិតជាចង់លុបការប្រជុំនេះជាស្ថាពរមែនទេ?")}>🔥 លុបចោល</button></td>
                    </tr>
                {:else}<tr><td colspan="3" class="text-center py-8 text-gray-500">មិនមានការប្រជុំក្នុងធុងសំរាមទេ</td></tr>{/each}
            </tbody>
        </table>
    </div>
</div>