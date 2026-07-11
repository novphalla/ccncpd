<script>
    import { createEventDispatcher } from 'svelte';
    import { fade, scale } from 'svelte/transition';

    export let show = false;
    export let meeting = null;
    export let forms = [];
    export let supabase;
    export let courses = [];

    const dispatch = createEventDispatcher();

    let newMeeting = { title: '', date: '', link: '', registration_form_id: null, course_id: null, is_published: true, join_available_at: '' };
    let isSubmitting = false;
    let editingMeetingId = null;

    // អថេរសម្រាប់កត់ចំណាំការពារកុំឱ្យ Reset ទិន្នន័យពេលកំពុងវាយអក្សរ
    let loadedMeeting = null;

    $: if (show && meeting && meeting !== loadedMeeting) {
        loadedMeeting = meeting;
        editingMeetingId = meeting.id;
        const d = new Date(meeting.scheduled_at);
        const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        let joinLocalIso = '';
        if (meeting.join_available_at) {
            const jd = new Date(meeting.join_available_at);
            joinLocalIso = new Date(jd.getTime() - jd.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        }
        newMeeting = {
            title: meeting.title,
            date: localIso,
            link: meeting.meeting_url,
            registration_form_id: meeting.registration_form_id,
            course_id: meeting.course_id || null,
            is_published: meeting.is_published,
            join_available_at: joinLocalIso
        };
    }

    // Reset ពេលបិទ Modal ដើម្បីឱ្យការបើកលើកក្រោយដំណើរការធម្មតា
    $: if (!show) {
        loadedMeeting = null;
    }

    async function createMeeting() {
        if (!newMeeting.title || !newMeeting.date) {
            alert("សូមបំពេញឈ្មោះប្រធានបទ និងកាលបរិច្ឆេទឱ្យបានត្រឹមត្រូវ!");
            return;
        }

        isSubmitting = true;
        const payload = {
            title: newMeeting.title,
            scheduled_at: new Date(newMeeting.date).toISOString(),
            meeting_url: newMeeting.link,
            registration_form_id: newMeeting.registration_form_id || null,
            course_id: newMeeting.course_id || null,
            is_published: newMeeting.is_published,
            join_available_at: newMeeting.join_available_at ? new Date(newMeeting.join_available_at).toISOString() : null
        };
        let error;
        if (editingMeetingId) {
            const res = await supabase.from('live_meetings').update(payload).eq('id', editingMeetingId);
            error = res.error;
        } else {
            const res = await supabase.from('live_meetings').insert(payload);
            error = res.error;
        }
        if (!error) { 
            alert(editingMeetingId ? "បានកែប្រែការប្រជុំ!" : "បានបង្កើតការប្រជុំ!"); 
            dispatch('close', { refresh: true });
        } else alert("កំហុស: " + error.message);
        isSubmitting = false;
    }
</script>

{#if show && meeting}
    <div class="modal modal-open bg-black/50" transition:fade={{ duration: 200 }}>
        <div class="modal-box" transition:scale={{ start: 0.9, duration: 200 }}>
            <h3 class="font-bold text-lg mb-4">{editingMeetingId ? 'កែប្រែការប្រជុំ' : 'បង្កើតការប្រជុំថ្មី'}</h3>
            
            <div class="form-control w-full mb-2">
                <label for="mm-title" class="label font-bold">ប្រធានបទ</label>
                <input id="mm-title" bind:value={newMeeting.title} placeholder="ប្រធានបទ" class="input input-bordered w-full" />
            </div>
            
            <div class="form-control w-full mb-2">
                <label for="mm-date" class="label font-bold">កាលបរិច្ឆេទ</label>
                <input id="mm-date" bind:value={newMeeting.date} type="datetime-local" class="input input-bordered w-full" />
            </div>
            
            <div class="form-control w-full mb-2">
                <label for="mm-link" class="label font-bold">តំណភ្ជាប់ (Link)</label>
                <input id="mm-link" bind:value={newMeeting.link} placeholder="Zoom / Google Meet Link" class="input input-bordered w-full" />
            </div>

            <div class="form-control w-full mb-2">
                <label for="mm-course" class="label font-bold">
                    <span>ភ្ជាប់ជាមួយវគ្គសិក្សា</span>
                    <span class="label-text-alt text-gray-400">ដើម្បីបង្ហាញជា “ចូលរៀន” ក្នុងវគ្គ</span>
                </label>
                <select id="mm-course" bind:value={newMeeting.course_id} class="select select-bordered w-full">
                    <option value={null}>-- មិនភ្ជាប់វគ្គ --</option>
                    {#each courses as course}
                        <option value={course.id}>{course.title}</option>
                    {/each}
                </select>
            </div>

            <div class="form-control w-full mb-2">
                <label for="mm-join-at" class="label font-bold">
                    <span>ចាប់ផ្តើមចូលរួមបាន (Join Available At)</span>
                    <span class="label-text-alt text-gray-400">ទុកទទេ = ចូលរួមបានភ្លាមៗ</span>
                </label>
                <input id="mm-join-at" bind:value={newMeeting.join_available_at} type="datetime-local" class="input input-bordered w-full" />
            </div>
            
            <div class="form-control w-full mb-2">
                <label for="mm-form" class="label font-bold">Form ចុះឈ្មោះ</label>
                <select id="mm-form" bind:value={newMeeting.registration_form_id} class="select select-bordered w-full">
                    <option value={null}>-- ប្រើ Form ចុះឈ្មោះលំនាំដើម --</option>
                    {#each forms as form}
                        <option value={form.id}>{form.title}</option>
                    {/each}
                </select>
            </div>
            
            <div class="form-control mb-4">
                <label class="cursor-pointer label justify-start gap-2">
                    <input type="checkbox" bind:checked={newMeeting.is_published} class="checkbox checkbox-primary" />
                    <span class="label-text">ដាក់ឱ្យដំណើរការ (Publish)</span>
                </label>
            </div>

            <div class="modal-action">
                <button class="btn btn-ghost" on:click={() => dispatch('close', { refresh: false })}>បោះបង់</button>
                <button class="btn btn-primary text-white" on:click={createMeeting} disabled={isSubmitting}>
                    {#if isSubmitting}<span class="loading loading-spinner loading-xs"></span>{/if}
                    {editingMeetingId ? 'រក្សាទុកការកែប្រែ' : 'បង្កើត'}
                </button>
            </div>
        </div>
    </div>
{/if}
