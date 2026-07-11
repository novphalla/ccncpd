<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fade, scale } from 'svelte/transition';
    export let supabase;
    import MeetingEditModal from './MeetingEditModal.svelte';

    const dispatch = createEventDispatcher();
    export let courses = [];
    let adminMeetings = [];
    let meetingSearch = '';
    let showUpcomingOnly = false;
    let forms = [];
    let showRegistrantsModal = false;
    let currentMeetingRegistrants = [];
    let currentMeetingTitle = '';
    let filterStartDate = '';
    let filterEndDate = '';
    let loadingMeetings = false;
    let currentPage = 1;
    let itemsPerPage = 10;
    let totalItems = 0;
    let stats = { totalMeetings: 0, totalRegistrantsThisMonth: 0 };

    // Attendance Export State
    let isExportingAttendance = false;
    let attendanceProgressTotal = 0;
    let attendanceProgressCurrent = 0;

    onMount(() => {
        fetchAdminMeetings();
        loadForms();
        loadStats();
    });

    let showEditModal = false;
    let selectedMeeting = null;

    async function loadForms() {
        const { data } = await supabase.from('custom_forms').select('id, title').order('created_at', { ascending: false }).limit(200);
        forms = data || [];
    }

    async function fetchAdminMeetings() {
        loadingMeetings = true;
        
        const from = (currentPage - 1) * itemsPerPage;
        const to = from + itemsPerPage - 1;

        let query = supabase.from('live_meetings').select('*, custom_forms(title), meeting_registrations(count)', { count: 'exact' }).is('deleted_at', null).order('scheduled_at', {ascending: false});
        
        if (meetingSearch) query = query.ilike('title', `%${meetingSearch}%`);
        if (showUpcomingOnly) {
            const now = new Date().toISOString();
            query = query.gte('scheduled_at', now);
        }
        if (filterStartDate) {
            query = query.gte('scheduled_at', new Date(filterStartDate + 'T00:00:00').toISOString());
        }
        if (filterEndDate) {
            query = query.lte('scheduled_at', new Date(filterEndDate + 'T23:59:59.999').toISOString());
        }
        
        query = query.range(from, to);

        const { data, count } = await query;
        adminMeetings = data || [];
        totalItems = count || 0;
        console.log({adminMeetings})
        loadingMeetings = false;
    }

    async function loadStats() {
        // 1. Total Meetings (Active)
        const { count: meetingCount } = await supabase
            .from('live_meetings')
            .select('id', { count: 'exact', head: true })
            .is('deleted_at', null);
        
        // 2. Registrants this month
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        
        const { count: registrantCount } = await supabase
            .from('meeting_registrations')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', startOfMonth.toISOString());

        stats = {
            totalMeetings: meetingCount || 0,
            totalRegistrantsThisMonth: registrantCount || 0
        };
    }

    function editMeeting(m) {
        selectedMeeting = m;
        showEditModal = true;
    }

    function courseTitleFor(meeting) {
        if (!meeting?.course_id) return '';
        return courses.find(course => String(course.id) === String(meeting.course_id))?.title || '';
    }

    async function duplicateMeeting(meeting) {
        if (!confirm(`តើអ្នកពិតជាចង់ចម្លងការប្រជុំ "${meeting.title}" ដែរឬទេ?`)) return;

        // កំណត់កាលបរិច្ឆេទទៅថ្ងៃស្អែក (រក្សាម៉ោងដដែល)
        const originalDate = new Date(meeting.scheduled_at);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(originalDate.getHours(), originalDate.getMinutes(), 0, 0);

        const payload = {
            title: `${meeting.title} (Copy)`,
            scheduled_at: tomorrow.toISOString(),
            meeting_url: meeting.meeting_url,
            registration_form_id: meeting.registration_form_id,
            course_id: meeting.course_id || null,
            is_published: false // Default to draft for copy
        };

        const { error } = await supabase.from('live_meetings').insert(payload);

        if (error) {
            alert("Error duplicating meeting: " + error.message);
        } else {
            alert("បានចម្លងការប្រជុំដោយជោគជ័យ!");
            fetchAdminMeetings();
            dispatch('refresh');
        }
    }

    async function deleteMeeting(id) {
        if (!confirm("តើអ្នកពិតជាចង់លុបការប្រជុំនេះ? (វានឹងចូលទៅក្នុងធុងសំរាម)")) return;
        const { error } = await supabase.from('live_meetings').update({ deleted_at: new Date().toISOString() }).eq('id', id);
        if (error) alert("Error deleting: " + error.message);
        else {
            fetchAdminMeetings();
            loadStats();
            dispatch('refresh'); // ជូនដំណឹងឱ្យ Refresh ទិន្នន័យនៅទំព័រដើម
        }
    }

    function copyToClipboard(text) {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => alert("បានចម្លងតំណភ្ជាប់!"));
    }

    function exportToCSV() {
        const headers = ['Title', 'Date', 'Link'];
        const csvContent = [
            headers.join(','),
            ...adminMeetings.map(m => {
                const date = new Date(m.scheduled_at).toLocaleDateString();
                return `"${m.title}","${date}","${m.meeting_url || ''}"`;
            })
        ].join('\n');

        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "meetings_export.csv";
        link.click();
    }

    async function exportAttendance(meeting) {
        // Assumes 'meeting_attendance' table exists with columns: meeting_id, user_id, created_at
        // and a foreign key to 'users' table.
        isExportingAttendance = true;
        attendanceProgressTotal = 0;
        attendanceProgressCurrent = 0;

        // រាប់ចំនួនសរុបជាមុន ដើម្បីយកមកធ្វើ Progress Bar
        const { count, error: countError } = await supabase
            .from('meeting_attendance')
            .select('id', { count: 'exact', head: true })
            .eq('meeting_id', meeting.id);

        if (countError) {
            isExportingAttendance = false;
            return alert("មិនអាចរាប់ចំនួនវត្តមានបានទេ: " + countError.message);
        }
        attendanceProgressTotal = count || 0;

        if (attendanceProgressTotal === 0) {
            isExportingAttendance = false;
            return alert("មិនមានទិន្នន័យវត្តមានសម្រាប់ការប្រជុំនេះទេ");
        }

        let allData = [];
        let hasMore = true;
        let from = 0;
        const step = 1000;
        
        while (hasMore) {
            const { data, error } = await supabase
                .from('meeting_attendance')
                .select('user_id, created_at, users (full_name, phone_number)')
                .eq('meeting_id', meeting.id)
                .order('created_at', { ascending: true })
                .range(from, from + step - 1);
            
            if (error) {
                isExportingAttendance = false;
                return alert("មិនអាចទាញយកវត្តមានបានទេ: " + error.message);
            }
            
            if (data && data.length > 0) {
                allData = [...allData, ...data];
                attendanceProgressCurrent = allData.length;
                from += step;
                if (data.length < step) hasMore = false;
            } else hasMore = false;
        }
        
        isExportingAttendance = false;

        // Filter duplicates based on user_id
        const uniqueData = [];
        const seenUserIds = new Set();
        allData.forEach(row => {
            if (!seenUserIds.has(row.user_id)) {
                seenUserIds.add(row.user_id);
                uniqueData.push(row);
            }
        });

        const csvContent = [
            "ឈ្មោះ,ទូរស័ព្ទ,ម៉ោងចូល",
            ...uniqueData.map(row => `"${row.users?.full_name || 'N/A'}","=${row.users?.phone_number || 'N/A'}","${new Date(row.created_at).toLocaleString('km-KH')}"`)
        ].join('\n');

        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `attendance_${meeting.title}.csv`;
        link.click();
    }

    async function getCount(meetingId) {
        const { data, error } = await supabase
            .rpc('get_meeting_participant_count', { meeting_id_input: meetingId });
        
        if (error) console.error('Error:', error);
        else console.log('ចំនួនអ្នកចូលរួម:', data);
        return data;
    }

    async function viewRegistrants(meeting) {
        currentMeetingTitle = meeting.title;
        let allData = [];
        let hasMore = true;
        let from = 0;
        const step = 1000;
        
        while (hasMore) {
            const { data, error } = await supabase
                .from('meeting_registrations')
                .select('*')
                .eq('meeting_id', meeting.id)
                .order('created_at', { ascending: false })
                .range(from, from + step - 1);
            if (error) {
                return alert("Error loading registrants: " + error.message);
            }
            if (data && data.length > 0) {
                allData = [...allData, ...data];
                from += step;
                if (data.length < step) hasMore = false;
            } else hasMore = false;
        }
        currentMeetingRegistrants = allData;
            showRegistrantsModal = true;
    }

    function exportRegistrantsToCSV() {
        if (!currentMeetingRegistrants.length) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");

        const BOM = "\uFEFF";
        const headers = ['ល.រ', 'ឈ្មោះ (ខ្មែរ)', 'ឈ្មោះ (ឡាតាំង)', 'ភេទ', 'លេខទូរស័ព្ទ', 'មុខតំណែង / កម្រិតជំនាញ', 'កន្លែងធ្វើការ', 'ខេត្ត'];
        const csvRows = [headers.join(',')];

        currentMeetingRegistrants.forEach((reg, i) => {
            const row = [
                i + 1,
                `"${(reg.name_khmer || '').replace(/"/g, '""')}"`,
                `"${(reg.name_latin || '').replace(/"/g, '""')}"`,
                `"${reg.gender || ''}"`,
                `="${(reg.phone || '').replace(/"/g, '""')}"`,
                `"${(reg.position || '').replace(/"/g, '""')}"`,
                `"${(reg.workplace || '').replace(/"/g, '""')}"`,
                `"${reg.province || ''}"`
            ];
            csvRows.push(row.join(','));
        });

        const blob = new Blob([BOM + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `registrants_${currentMeetingTitle}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    function truncateText(text, maxLength) {
        if (!text) return '';
        if (text.length <= maxLength) return text;
        return text.substr(0, maxLength) + '...';
    }

    function formatDate(dateString) {
        if (!dateString) return '';
        return new Date(dateString).toLocaleDateString('km-KH');
    }

    function changePage(page) {
        if (page < 1 || (page - 1) * itemsPerPage >= totalItems) return;
        currentPage = page;
        fetchAdminMeetings();
    }

    function resetFilters() {
        meetingSearch = '';
        filterStartDate = '';
        filterEndDate = '';
        showUpcomingOnly = false;
        currentPage = 1;
        fetchAdminMeetings();
    }

    function openCreateModal() {
        selectedMeeting = {
            title: '',
            scheduled_at: new Date().toISOString(),
            meeting_url: '',
            registration_form_id: null,
            course_id: null,
            is_published: true,
            join_available_at: ''
        };
        showEditModal = true;
    }

</script>

<div class="card bg-base-100 p-5 shadow-md border border-base-300">
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
            <h3 class="font-bold text-xl text-gray-800">📅 កាលវិភាគរៀន / ចូលប្រជុំតាមវគ្គ</h3>
            <p class="text-sm text-gray-500 mt-1">ភ្ជាប់ Zoom/Google Meet ទៅវគ្គសិក្សា ដើម្បីឲ្យ user ចូលតាមប៊ូតុង “ចូលរៀន” ក្នុងវគ្គតែមួយ។</p>
        </div>
        <div class="flex flex-wrap gap-2 w-full md:w-auto justify-end items-center">
            <button on:click={openCreateModal} class="btn btn-sm btn-primary shadow-sm hover:shadow-md">
                + បង្កើតការប្រជុំ
            </button>
            <button on:click={fetchAdminMeetings} class="btn btn-sm btn-outline shadow-sm hover:shadow-md">
                {#if loadingMeetings}<span class="loading loading-spinner loading-xs"></span>{/if} Refresh
            </button>
            <div class="flex flex-wrap gap-1 bg-base-200/50 p-1 px-2 rounded-lg border border-base-300 items-center">
                <span class="text-xs font-bold text-gray-500 mr-1 hidden lg:inline-block">Export:</span>
                <button on:click={exportToCSV} class="btn btn-xs btn-success text-white shadow-sm" title="ទាញយកទិន្នន័យជា CSV">📊 CSV</button>
            </div>
        </div>
    </div>
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div class="stat bg-indigo-50/50 border border-indigo-100/50 rounded-xl p-3">
            <div class="stat-figure text-primary">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0h18M5.25 12h13.5h-13.5zm1 5.25h13.5h-13.5z" /></svg>
            </div>
            <div class="stat-title text-indigo-900 font-bold text-xs">ការប្រជុំសរុប</div>
            <div class="stat-value text-primary">{stats.totalMeetings}</div>
            <div class="stat-desc text-indigo-600">វគ្គដែលកំពុងដំណើរការ</div>
        </div>
        
        <div class="stat bg-green-50/50 border border-green-100/50 rounded-xl p-3">
            <div class="stat-figure text-success">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
            </div>
            <div class="stat-title text-green-900 font-bold text-xs">អ្នកចុះឈ្មោះ (ខែនេះ)</div>
            <div class="stat-value text-success">{stats.totalRegistrantsThisMonth}</div>
            <div class="stat-desc text-green-600">គិតចាប់ពីថ្ងៃទី ១</div>
        </div>
    </div>

    <div class="bg-base-200/50 p-3 border border-base-300 rounded-xl mb-4 flex flex-col xl:flex-row gap-3 items-start xl:items-center justify-between">
        <div class="flex flex-wrap gap-2 w-full xl:w-auto flex-1 items-center">
            <div class="relative w-full sm:w-auto sm:min-w-[200px]">
                <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
                <input bind:value={meetingSearch} on:input={() => { currentPage = 1; fetchAdminMeetings(); }} placeholder="ស្វែងរកចំណងជើង..." class="input input-sm input-bordered w-full pl-8" />
            </div>
            
            <div class="flex items-center gap-1 w-full sm:w-auto">
                <input type="date" bind:value={filterStartDate} on:change={() => { currentPage = 1; fetchAdminMeetings(); }} class="input input-sm input-bordered w-full sm:w-auto" title="ចាប់ពីថ្ងៃ" />
                <span class="text-gray-400 text-xs">-</span>
                <input type="date" bind:value={filterEndDate} on:change={() => { currentPage = 1; fetchAdminMeetings(); }} class="input input-sm input-bordered w-full sm:w-auto" title="ដល់ថ្ងៃ" />
                {#if meetingSearch || filterStartDate || filterEndDate || showUpcomingOnly}
                    <button on:click={resetFilters} class="btn btn-xs btn-square btn-outline btn-error ml-1" title="Reset Filter">✕</button>
                {/if}
            </div>
        </div>

        <div class="flex items-center shrink-0">
            <label class="cursor-pointer label gap-2 p-0">
                <span class="label-text text-xs font-bold text-gray-600">មិនទាន់ហួសកំណត់</span> 
                <input type="checkbox" bind:checked={showUpcomingOnly} on:change={() => { currentPage = 1; fetchAdminMeetings(); }} class="checkbox checkbox-xs checkbox-primary" />
            </label>
        </div>
    </div>

    <div class="overflow-x-auto bg-base-100 rounded-xl border border-base-300">
        <table class="table table-xs w-full">
            <thead class="bg-base-200 text-base-content uppercase text-xs font-bold border-b border-base-300">
                <tr><th>ប្រធានបទ</th><th>វគ្គសិក្សា</th><th>កាលបរិច្ឆេទ</th><th>តំណភ្ជាប់</th><th>Form ចុះឈ្មោះ</th><th>អ្នកចុះឈ្មោះ</th><th>ផ្សាយ</th><th class="text-right">សកម្មភាព</th></tr>
            </thead>
            <tbody >
                {#each adminMeetings as m, i}
                    <tr class="group hover border-b border-base-200 last:border-none transition-colors" in:fade={{ duration: 200, delay: i * 30 }}>
                        <td class="font-bold text-gray-800" title={m.title}>{truncateText(m.title, 40)}</td>
                        <td>
                            {#if courseTitleFor(m)}
                                <span class="badge badge-sm badge-primary text-white max-w-56 truncate">{courseTitleFor(m)}</span>
                            {:else}
                                <span class="badge badge-sm badge-ghost text-gray-400">មិនទាន់ភ្ជាប់វគ្គ</span>
                            {/if}
                        </td>
                        <td>{new Date(m.scheduled_at).toLocaleDateString()}</td>
                        <td>
                            {#if m.meeting_url}<button on:click={() => copyToClipboard(m.meeting_url)} class="btn btn-xs btn-ghost" title="ចម្លង">📋</button>{/if}
                        </td>
                        <td>
                            {#if m.custom_forms}
                                <span class="badge badge-xs badge-info text-white">{m.custom_forms.title}</span>
                            {:else}
                                <span class="text-gray-300 text-xs">-</span>
                            {/if}
                        </td>
                        <td>
                            <button class="badge badge-xs badge-ghost hover:bg-gray-200 cursor-pointer" on:click={() => viewRegistrants(m)}>
                                {m.meeting_registrations ? m.meeting_registrations[0]?.count : 0} នាក់
                            </button>
                        </td>
                        <td>
                            <input type="checkbox" class="toggle toggle-xs toggle-success" checked={m.is_published} 
                                on:change={async (e) => {
                                    await supabase.from('live_meetings').update({ is_published: e.target.checked }).eq('id', m.id);
                                    dispatch('refresh');
                                }} />
                        </td>
                        <td class="text-right space-x-1 whitespace-nowrap">
                            <button on:click={() => exportAttendance(m)} class="btn btn-xs btn-outline btn-success" title="ទាញយកវត្តមាន" disabled={isExportingAttendance}>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                                </svg>
                            </button>
                            <button on:click={() => duplicateMeeting(m)} class="btn btn-xs btn-outline btn-secondary" title="ចម្លង">📋</button>
                            <button on:click={() => editMeeting(m)} class="btn btn-xs btn-outline btn-info" title="កែប្រែ">✏️</button>
                            <button on:click={() => deleteMeeting(m.id)} class="btn btn-xs btn-outline btn-error" title="លុប">✕</button>
                        </td>
                    </tr>
                {/each}
            </tbody>

        </table>
    </div>

    <!-- Pagination -->
    <div class="flex flex-col md:flex-row justify-between items-center mt-4 gap-4">
        <div class="text-sm text-gray-500">
            បង្ហាញ {totalItems === 0 ? 0 : ((currentPage - 1) * itemsPerPage) + 1} ដល់ {Math.min(currentPage * itemsPerPage, totalItems)} នៃ {totalItems}
        </div>
        <div class="join">
            <button class="join-item btn btn-sm btn-outline" disabled={currentPage === 1} on:click={() => changePage(currentPage - 1)}>«</button>
            <button class="join-item btn btn-sm btn-ghost">ទំព័រ {currentPage}</button>
            <button class="join-item btn btn-sm btn-outline" disabled={currentPage * itemsPerPage >= totalItems} on:click={() => changePage(currentPage + 1)}>»</button>
        </div>
    </div>
</div>

{#if showEditModal}
    <MeetingEditModal 
        bind:show={showEditModal}
        meeting={selectedMeeting}
        {supabase}
        forms={forms}
        {courses}
        on:close={({detail}) => { showEditModal = false; selectedMeeting = null; if(detail && detail.refresh) { fetchAdminMeetings(); dispatch('refresh'); } }}
    />
{/if}

{#if showRegistrantsModal}
    <div class="modal modal-open bg-black/50" transition:fade={{ duration: 200 }}>
        <div class="modal-box w-11/12 max-w-5xl">
            <h3 class="font-bold text-lg mb-4">អ្នកចុះឈ្មោះ: {currentMeetingTitle}</h3>
            <div class="overflow-x-auto max-h-[60vh] border rounded-lg my-4">
                <table class="table table-xs table-pin-rows">
                    <thead class="bg-gray-50">
                        <tr>
                            <th>ល.រ</th>
                            <th>ឈ្មោះ (ខ្មែរ)</th>
                            <th>ឈ្មោះ (ឡាតាំង)</th>
                            <th>ភេទ</th>
                            <th>លេខទូរស័ព្ទ</th>
                            <th>មុខតំណែង / កម្រិតជំនាញ</th>
                            <th>កន្លែងធ្វើការ</th>
                            <th>ខេត្ត</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each currentMeetingRegistrants as reg, i}
                            <tr>
                                <th>{i + 1}</th>
                                <td>{reg.name_khmer || '-'}</td>
                                <td>{reg.name_latin || '-'}</td>
                                <td>{reg.gender || '-'}</td>
                                <td>{reg.phone || '-'}</td>
                                <td>{reg.position || '-'}</td>
                                <td>{reg.workplace || '-'}</td>
                                <td>{reg.province || '-'}</td>
                            </tr>
                        {:else}
                            <tr><td colspan="8" class="text-center py-4">មិនមានអ្នកចុះឈ្មោះទេ</td></tr>
                        {/each}
                    </tbody>
                </table>
            </div>

            <div class="modal-action">
                <button class="btn btn-success text-white" on:click={exportRegistrantsToCSV} disabled={!currentMeetingRegistrants.length}>Export CSV</button>
                <button class="btn btn-ghost" on:click={() => showRegistrantsModal = false}>បិទ</button>
            </div>
        </div>
    </div>
{/if}

<!-- Attendance Export Progress Overlay -->
{#if isExportingAttendance}
    <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" transition:fade={{ duration: 200 }}>
        <div class="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-sm text-center">
            <div class="mb-4">
                <span class="loading loading-spinner loading-lg text-primary"></span>
            </div>
            <h3 class="font-bold text-lg text-gray-800 mb-2">កំពុងទាញយកទិន្នន័យវត្តមាន...</h3>
            {#if attendanceProgressTotal > 0}
                <div class="w-full bg-gray-100 rounded-full h-3 mb-2 overflow-hidden shadow-inner mt-4">
                    <div class="bg-primary h-3 rounded-full transition-all duration-300" style="width: {Math.round((attendanceProgressCurrent / attendanceProgressTotal) * 100)}%"></div>
                </div>
                <div class="flex justify-between text-xs font-bold text-gray-500">
                    <span>{attendanceProgressCurrent} / {attendanceProgressTotal} វត្តមាន</span>
                    <span class="text-primary">{Math.round((attendanceProgressCurrent / attendanceProgressTotal) * 100)}%</span>
                </div>
            {/if}
        </div>
    </div>
{/if}
