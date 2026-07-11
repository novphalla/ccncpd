<script>
    import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
    import { fade, slide, fly } from 'svelte/transition';
    import { XIcon } from 'lucide-svelte';
    import UserManagement from '$lib/Components/admin/UserManagement.svelte';
    import CourseManagement from './CourseManagement.svelte';
    import MeetingManagement from '$lib/Components/admin/MeetingManagement.svelte';
    import StorageManagement from '$lib/Components/admin/StorageManagement.svelte';
    import Overview from '$lib/Overview.svelte';
    import SystemSettings from '$lib/SystemSettings.svelte';
    import QuizResultManagement from '$lib/Components/admin/QuizResultManagement.svelte';
    import R2FilePicker from '$lib/Components/admin/R2FilePicker.svelte';
    import FormManagement from '$lib/Components/admin/FormManagement.svelte';
    import RegistrationManagement from '$lib/Components/admin/RegistrationManagement.svelte';
    import CourseEnrollmentManagement from '$lib/Components/admin/CourseEnrollmentManagement.svelte';
    import TrashManagement from '$lib/Components/admin/TrashManagement.svelte';
    import SystemAdminManagement from '$lib/Components/admin/SystemAdminManagement.svelte';
    import ActivityLogs from '$lib/Components/admin/ActivityLogs.svelte';
    import UserProfileViewer from '$lib/Components/admin/UserProfileViewer.svelte';
    import ToastNotification from '$lib/Components/ToastNotification.svelte';
    import { PUBLIC_R2_PUBLIC_URL } from '$env/static/public';
    import { handleUpload } from '$lib/utils';
    
    export let supabase;
    export let currentUser;
    export let courses = [];
    export let totalUsers = 0;
    export let loginLogoUrl = '';
    export let faviconUrl = '';
    export let version = '';
    export let showCPDPoints = false;
    export let profileFormId = null;
    export let assistantTelegram = '';
    export let tutorials = [];
    export let evaluationFormUrl = '';
    export let adminTab = 'dashboard';
    export let isMaintenanceMode = false;
    let uploadingTutorialIndex = -1;

    const dispatch = createEventDispatcher();
    let isLocal = false;

    onMount(() => {
        isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    });

    function closeAdmin() {
        dispatch('close');
    }

    function refreshData() {
        dispatch('refresh');
    }

    function handleCpdToggle() {
        dispatch('updateSetting', {
            show_cpd_points: showCPDPoints
        });
    }

    function saveAssistantTelegram() {
        dispatch('updateSetting', { assistant_telegram: assistantTelegram });
        alert('បានរក្សាទុកតំណភ្ជាប់ Telegram ជំនួយការដោយជោគជ័យ!');
    }

    function addTutorial() {
        tutorials = [...tutorials, { title: 'ការណែនាំថ្មី', url: '' }];
    }

    function removeTutorial(index) {
        tutorials = tutorials.filter((_, i) => i !== index);
    }

    function moveTutorial(index, dir) {
        if (index + dir < 0 || index + dir >= tutorials.length) return;
        const temp = tutorials[index];
        tutorials[index] = tutorials[index + dir];
        tutorials[index + dir] = temp;
    }

    function saveTutorials() {
        dispatch('updateSetting', { tutorials });
        alert('បានរក្សាទុកបញ្ជីរបៀបប្រើប្រាស់ដោយជោគជ័យ!');
    }

    async function uploadTutorialFile(e, index) {
        const file = e.target.files[0];
        if (!file) return;
        uploadingTutorialIndex = index;
        try {
            const url = await handleUpload(file, 'tutorials');
            if (url) {
                tutorials[index].url = url;
                tutorials = [...tutorials]; // Force reactivity
                saveTutorials(); // រក្សាទុកទៅ Database ស្វ័យប្រវត្តិ
            }
        } catch (error) {
            console.error("Upload error:", error);
        }
        uploadingTutorialIndex = -1;
        e.target.value = '';
    }

    async function switchTab(tab) {
        adminTab = tab;
        if (tab === 'dashboard') {
            // dashboard loaded
        }
    }

    // --- QUIZ RESULTS LOGIC ---
    let selectedUserProfile = null;

    function viewUserProfile(user) {
        if (!user) return;
        selectedUserProfile = user;
    }
    // File Picker Logic
    let showFilePicker = false;
    let filePickerTarget = '';

    function openFilePicker(target) {
        filePickerTarget = target;
        showFilePicker = true;
    }

    function handleFileSelected(e) {
        const url = e.detail.url;
        
        if (['logo', 'favicon'].includes(filePickerTarget) || filePickerTarget.startsWith('tutorial_')) {
             const updates = {};
             if (filePickerTarget === 'logo') updates.login_logo_url = url;
             else if (filePickerTarget === 'favicon') updates.favicon_url = url;
             else if (filePickerTarget.startsWith('tutorial_')) {
                 const idx = parseInt(filePickerTarget.split('_')[1]);
                 if (tutorials[idx]) {
                     tutorials[idx].url = url;
                     tutorials = [...tutorials]; // Force reactivity
                     updates.tutorials = tutorials;
                 }
             }
             
             supabase.from('app_settings').upsert({ id: 1, ...updates }).then(({ error }) => {
                 if (error) alert("Error: " + error.message);
                 else {
                     dispatch('refreshSettings');
                 }
             });
        }
        
        showFilePicker = false;
    }

    $: tabTitles = {
        dashboard: 'ទិដ្ឋភាពទូទៅ',
        courses: 'CPD Programs / វគ្គសិក្សា',
        meetings: 'កាលវិភាគក្នុងវគ្គសិក្សា',
        registrations: 'ការចុះឈ្មោះ',
        forms: 'បែបបទ និងការវាយតម្លៃ',
        quiz_results: 'លទ្ធផលប្រឡង',
        users: 'សមាជិក',
        storage: 'ឃ្លាំងឯកសារ',
        settings: 'ការកំណត់ប្រព័ន្ធ',
        trash: 'ធុងសំរាម',
        system_admins: 'គ្រប់គ្រង Admin',
        activity_logs: 'កំណត់ត្រាសកម្មភាព'
    };

    $: adminSections = [
        {
            title: 'CPD Management',
            description: 'ចំណុចធំសម្រាប់ flow ចុះឈ្មោះ រៀន ប្រឡង វាយតម្លៃ និងលិខិតបញ្ជាក់។',
            items: [
                { tab: 'courses', label: 'Programs / Courses', note: 'វគ្គ, មេរៀន, លិខិតបញ្ជាក់', tone: 'amber', icon: 'book' },
                { tab: 'meetings', label: 'Course Schedule', note: 'ថ្ងៃរៀន និង Zoom/Meet ក្នុងវគ្គ', tone: 'purple', icon: 'calendar' },
                { tab: 'registrations', label: 'Registrations', note: 'អ្នកចុះឈ្មោះ និងវត្តមាន', tone: 'indigo', icon: 'users' },
                { tab: 'quiz_results', label: 'Results', note: 'លទ្ធផលប្រឡង និងស្ថានភាពជាប់', tone: 'green', icon: 'check' },
                { tab: 'forms', label: 'Evaluation Forms', note: 'Form វាយតម្លៃក្រោយជាប់', tone: 'blue', icon: 'form' },
                { action: 'openCertGen', label: 'Certificates', note: 'បង្កើតលិខិតបញ្ជាក់ពី Excel', tone: 'cyan', icon: 'certificate' }
            ]
        },
        {
            title: 'Content',
            description: 'មាតិកា និងឯកសារដែលប្រើក្នុងវគ្គ។',
            items: [
                { tab: 'courses', label: 'Course Library', note: 'មាតិកា PDF/Video និង Quiz', tone: 'amber', icon: 'book' },
                { tab: 'forms', label: 'Forms Library', note: 'បែបបទចុះឈ្មោះ និងវាយតម្លៃ', tone: 'blue', icon: 'form' },
                { tab: 'storage', label: 'Storage', note: 'រូបភាព PDF Video និង assets', tone: 'pink', icon: 'storage' }
            ]
        },
        {
            title: 'People',
            description: 'សមាជិក Admin និងសកម្មភាពប្រើប្រាស់។',
            items: [
                { tab: 'users', label: 'Members', note: 'គ្រប់គ្រងសមាជិក និង Reset PIN', tone: 'teal', icon: 'users' },
                { tab: 'system_admins', label: 'Admins', note: 'តែងតាំង ឬដកសិទ្ធិ', tone: 'yellow', icon: 'lock', ownerOnly: true },
                { tab: 'activity_logs', label: 'Activity Logs', note: 'ប្រវត្តិសកម្មភាព Admin', tone: 'gray', icon: 'clock', adminOnly: true }
            ]
        },
        {
            title: 'System',
            description: 'ការកំណត់ និងការថែទាំប្រព័ន្ធ។',
            items: [
                { tab: 'settings', label: 'Settings', note: 'System, Telegram, Tutorials', tone: 'slate', icon: 'settings' },
                { tab: 'trash', label: 'Trash', note: 'ស្តារទិន្នន័យដែលបានលុប', tone: 'red', icon: 'trash' }
            ]
        }
    ].map(section => ({
        ...section,
        items: section.items.filter(item =>
            (!item.ownerOnly || currentUser?.role === 'owner') &&
            (!item.adminOnly || ['owner', 'admin'].includes(currentUser?.role))
        )
    }));

    const menuToneClasses = {
        amber: { button: 'hover:border-amber-200 hover:bg-amber-50', icon: 'bg-amber-100 text-amber-700' },
        purple: { button: 'hover:border-purple-200 hover:bg-purple-50', icon: 'bg-purple-100 text-purple-700' },
        indigo: { button: 'hover:border-indigo-200 hover:bg-indigo-50', icon: 'bg-indigo-100 text-indigo-700' },
        green: { button: 'hover:border-green-200 hover:bg-green-50', icon: 'bg-green-100 text-green-700' },
        blue: { button: 'hover:border-blue-200 hover:bg-blue-50', icon: 'bg-blue-100 text-blue-700' },
        cyan: { button: 'hover:border-cyan-200 hover:bg-cyan-50', icon: 'bg-cyan-100 text-cyan-700' },
        pink: { button: 'hover:border-pink-200 hover:bg-pink-50', icon: 'bg-pink-100 text-pink-700' },
        teal: { button: 'hover:border-teal-200 hover:bg-teal-50', icon: 'bg-teal-100 text-teal-700' },
        yellow: { button: 'hover:border-yellow-200 hover:bg-yellow-50', icon: 'bg-yellow-100 text-yellow-700' },
        gray: { button: 'hover:border-gray-300 hover:bg-gray-50', icon: 'bg-gray-100 text-gray-700' },
        slate: { button: 'hover:border-slate-300 hover:bg-slate-50', icon: 'bg-slate-100 text-slate-700' },
        red: { button: 'hover:border-red-200 hover:bg-red-50', icon: 'bg-red-100 text-red-700' }
    };

    function runMenuItem(item) {
        if (item.action === 'openCertGen') {
            dispatch('openCertGen');
            return;
        }
        switchTab(item.tab);
    }
</script>

<div class="screen min-h-screen p-4 text-base-content bg-base-100 relative overflow-hidden">
    
    <div class="relative mx-auto max-w-[1600px] bg-base-200/50 border border-base-300 shadow-xl rounded-2xl p-6 min-h-[calc(100vh-2rem)]">
    <ToastNotification />

    <!-- Header / Top Bar -->
    <div class="mb-8 p-4 bg-base-100 border border-base-300 shadow-md rounded-2xl sticky top-4 z-20">
        <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-4">
                {#if adminTab !== 'dashboard'}
                    <button on:click={() => switchTab('dashboard')} class="rounded-full w-8 h-8 hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none text-gray-700">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="24" height="24">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                        </svg>
                    </button>
                {/if}
                <div class:cursor-pointer={adminTab !== 'dashboard'} on:click={() => adminTab !== 'dashboard' && switchTab('dashboard')}>
                    <div class="text-xs font-bold text-gray-400 uppercase tracking-wider">ផ្ទាំងគ្រប់គ្រង</div>
                    <h1 class="text-2xl font-black text-gray-800 tracking-tight">
                        {tabTitles[adminTab] || 'ការកំណត់ប្រព័ន្ធ'}
                    </h1>
                </div>
            </div>
            
            <div class="flex items-center gap-4">
                <button on:click={closeAdmin} class="flex items-center gap-2 text-gray-600 hidden sm:flex px-2 py-1 rounded-lg hover:bg-gray-100 cursor-pointer border-0 outline-none" title="ត្រឡប់ទៅទំព័រដើម">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="20" height="20">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                    </svg>
                    ទំព័រដើម
                </button>
                 <div class="hidden md:flex flex-col items-end">
                    <span class="text-sm font-bold text-gray-700">{currentUser?.full_name || 'Admin'}</span>
                    <span class="text-xs uppercase tracking-wider font-bold text-gray-400">{currentUser?.role || 'admin'}</span>
                </div>
                <div class="avatar placeholder">
                    <div class="bg-neutral text-neutral-content rounded-full w-10 relative overflow-hidden transition-transform hover:scale-110">
                        <span class="text-lg">{currentUser?.full_name?.[0] || 'A'}</span>
                    </div>
                </div>
                <button on:click={closeAdmin} class="rounded-full w-8 h-8 bg-white hover:bg-red-100 border border-gray-200 shadow-md flex items-center justify-center cursor-pointer outline-none" style="color: #ef4444;" title="Close Admin Panel">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" width="20" height="20">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button> 
            </div>
        </div>
    </div>
    
    {#if adminTab === 'dashboard'}
        <!-- Stats Row -->
        <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
            <div class="stat bg-base-100 rounded-xl border border-base-300 shadow-sm p-6 relative overflow-hidden group">
                <div class="stat-figure text-teal-600 absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-32 h-32"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
                </div>
                <div class="stat-title font-bold text-gray-500">អ្នកប្រើប្រាស់សរុប</div>
                <div class="stat-value text-teal-600 text-4xl mt-2">{totalUsers}</div>
                <div class="stat-desc text-teal-600/60 font-medium">នាក់</div>
            </div>
            
            <div class="stat bg-base-100 rounded-xl border border-base-300 shadow-sm p-6 relative overflow-hidden group">
                <div class="stat-figure text-amber-500 absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-32 h-32"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.967 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
                </div>
                <div class="stat-title font-bold text-gray-500">វគ្គសិក្សា</div>
                <div class="stat-value text-amber-500 text-4xl mt-2">{courses.length}</div>
                <div class="stat-desc text-amber-500/60 font-medium">វគ្គ</div>
            </div>


        </div>

        <!-- User Growth Chart -->
        <div class="mb-8"></div>

        <!-- Menu Groups -->
        <div class="space-y-5">
            {#each adminSections as section}
                {#if section.items.length}
                <section class="bg-base-100 border border-base-300 rounded-xl p-4 shadow-sm">
                    <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1 mb-3">
                        <div>
                            <h3 class="text-lg font-black text-gray-800">{section.title}</h3>
                            <p class="text-xs text-gray-500 mt-0.5">{section.description}</p>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {#each section.items as item}
                            <button on:click={() => runMenuItem(item)}
                                    class="group text-left flex items-center gap-3 rounded-lg border border-base-300 bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md {menuToneClasses[item.tone]?.button || ''}">
                                <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg {menuToneClasses[item.tone]?.icon || ''}">
                                    {#if item.icon === 'book'}
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.967 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
                                    {:else if item.icon === 'calendar'}
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0h18M7.5 12h3m3 0h3m-9 3.75h3m3 0h3" /></svg>
                                    {:else if item.icon === 'users'}
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
                                    {:else if item.icon === 'check'}
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    {:else if item.icon === 'form'}
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6M9 8h6m3.75-3.75h-13.5A2.25 2.25 0 003 6.5v11A2.25 2.25 0 005.25 19.75h13.5A2.25 2.25 0 0021 17.5v-11a2.25 2.25 0 00-2.25-2.25z" /></svg>
                                    {:else if item.icon === 'certificate'}
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M10.125 2.25h-4.5c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125v-9M9 15l2.25 2.25L15 12m-4.875-9.75A3.375 3.375 0 0113.5 5.625v1.5c0 .621.504 1.125 1.125 1.125h1.5a3.375 3.375 0 013.375 3.375" /></svg>
                                    {:else if item.icon === 'storage'}
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 19.5h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" /></svg>
                                    {:else if item.icon === 'lock'}
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                                    {:else if item.icon === 'clock'}
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                    {:else if item.icon === 'settings'}
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                    {:else}
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.6" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                    {/if}
                                </span>
                                <span class="min-w-0">
                                    <span class="block font-bold text-gray-800 truncate">{item.label}</span>
                                    <span class="block text-xs text-gray-500 mt-0.5 leading-snug">{item.note}</span>
                                </span>
                            </button>
                        {/each}
                    </div>
                </section>
                {/if}
            {/each}
        </div>
    {/if}

    {#if adminTab === 'system_admins' && currentUser?.role === 'owner'}
        <SystemAdminManagement {supabase} {currentUser} />
    {/if}

    {#if adminTab === 'activity_logs' && ['owner', 'admin'].includes(currentUser?.role)}
        <ActivityLogs {supabase} {currentUser} />
    {/if}

    {#if adminTab === 'settings'}
        <div class="card bg-base-100 mb-6 p-4 shadow-md border border-base-300">
            <h3 class="font-bold text-lg text-gray-800 mb-4">ការកំណត់ទូទៅ</h3>
            <div class="form-control">
                <label class="label cursor-pointer justify-start gap-4">
                    <span class="label-text font-bold text-gray-700">បង្ហាញពិន្ទុ CPD ក្នុង Profile</span> 
                    <input 
                        type="checkbox" 
                        class="toggle toggle-success" 
                        bind:checked={showCPDPoints} 
                        on:change={handleCpdToggle}
                    />
                </label>
                <label class="label pt-0">
                    <span class="label-text-alt text-gray-500">
                        អនុញ្ញាតឱ្យសមាជិកមើលឃើញពិន្ទុ CPD និងកម្រិត (Level) របស់ពួកគេ។
                    </span>
                </label>
            </div>
            
            <div class="form-control mt-4">
                <label class="label">
                    <span class="label-text font-bold text-gray-700">តំណភ្ជាប់ Telegram ជំនួយការ (Assistant Telegram Link)</span>
                </label>
                <div class="flex gap-2 w-full max-w-md">
                    <input type="text" class="input input-bordered w-full" placeholder="ឧ. https://t.me/DigitalKCN" bind:value={assistantTelegram} />
                    <button class="btn btn-primary" on:click={saveAssistantTelegram}>រក្សាទុក</button>
                </div>
                <label class="label"><span class="label-text-alt text-gray-500">ប្រើសម្រាប់ទាក់ទងជំនួយការពេលសមាជិកភ្លេចលេខកូដ និងសួរព័ត៌មានផ្សេងៗ។</span></label>
            </div>
        </div>

        <div class="card bg-base-100 mb-6 p-4 shadow-md border border-base-300">
            <h3 class="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">💡 ការណែនាំសមាជិក (Tutorials)</h3>

            <div class="form-control">
                <label class="label">
                    <span class="label-text font-bold text-gray-700">បញ្ជីរបៀបប្រើប្រាស់ (Tutorials & Guides)</span>
                </label>
                <div class="bg-base-200/50 p-4 rounded-xl border border-base-300">
                    {#each tutorials as tut, i}
                        <div class="flex items-center gap-2 mb-2 bg-white p-2 rounded-lg shadow-sm border border-base-200" in:fade>
                            <div class="flex flex-col gap-1">
                                <button class="btn btn-xs btn-ghost p-0 px-1" on:click={() => moveTutorial(i, -1)} disabled={i === 0}>▲</button>
                                <button class="btn btn-xs btn-ghost p-0 px-1" on:click={() => moveTutorial(i, 1)} disabled={i === tutorials.length - 1}>▼</button>
                            </div>
                            <input type="text" class="input input-sm input-bordered w-1/3" placeholder="ចំណងជើង..." bind:value={tut.title} />
                            <input type="text" class="input input-sm input-bordered flex-1" placeholder="Link/ឯកសារ..." bind:value={tut.url} />
                            <label class="btn btn-sm btn-outline btn-info btn-square cursor-pointer" title="Upload ឯកសារថ្មីពីកុំព្យូទ័រ">
                                {#if uploadingTutorialIndex === i}
                                    <span class="loading loading-spinner loading-xs"></span>
                                {:else}
                                    📤
                                {/if}
                                <input type="file" class="hidden" accept="image/*,video/*,.pdf" on:change={(e) => uploadTutorialFile(e, i)} />
                            </label>
                            <button class="btn btn-sm btn-outline btn-square" on:click={() => openFilePicker(`tutorial_${i}`)} title="រើសពី R2">📁</button>
                            <button class="btn btn-sm btn-outline btn-error btn-square" on:click={() => removeTutorial(i)} title="លុបការណែនាំ">🗑️</button>
                        </div>
                    {/each}
                    <button class="btn btn-sm btn-outline mt-2 w-full border-dashed" on:click={addTutorial}>+ បន្ថែមការណែនាំថ្មី</button>
                    <div class="mt-4 flex justify-end"><button class="btn btn-primary" on:click={saveTutorials}>រក្សាទុកការណែនាំ</button></div>
                </div>
                <label class="label"><span class="label-text-alt text-gray-500">សមាជិកនឹងឃើញបញ្ជីប៊ូតុងជ្រើសរើស "របៀបប្រើប្រាស់" នៅក្នុង Modal តែមួយ។</span></label>
            </div>
        </div>
        <SystemSettings 
            {supabase} 
            {loginLogoUrl} 
            {faviconUrl} 
            {version} 
            {currentUser}
            {evaluationFormUrl}
            on:refreshSettings={() => dispatch('refreshSettings')}
            on:openFilePicker={(e) => openFilePicker(e.detail)}
        />
    {/if}

{#if showFilePicker}
    <R2FilePicker 
        {currentUser} 
        {isLocal} 
        on:select={handleFileSelected} 
        on:close={() => showFilePicker = false} 
    />
{/if}

    {#if adminTab === 'meetings'}
        <MeetingManagement {supabase} {courses} on:refresh={refreshData} />
    {/if}

    {#if adminTab === 'courses'}
        <CourseManagement {supabase} {courses} {currentUser} on:refresh={refreshData} />
    {/if}

    {#if adminTab === 'users'}
        <UserManagement {supabase} on:refresh={refreshData} />
    {/if}

    {#if adminTab === 'storage'}
        <StorageManagement {currentUser} />
    {/if}

    {#if adminTab === 'trash'}
        <TrashManagement {supabase} on:refresh={refreshData} />
    {/if}

    {#if adminTab === 'quiz_results'}
        <QuizResultManagement 
            {supabase} 
            {courses} 
            {loginLogoUrl} 
            on:viewUserProfile={(e) => viewUserProfile(e.detail)} 
        />
    {/if}

    {#if adminTab === 'registrations'}
        <CourseEnrollmentManagement
            {supabase}
            {currentUser}
            {courses}
        />
        <details class="bg-base-100 border border-base-300 rounded-xl shadow-sm overflow-hidden">
            <summary class="px-5 py-4 cursor-pointer font-bold text-gray-800 flex items-center justify-between bg-gray-50">
                <span>ការចុះឈ្មោះប្រជុំ / ទិន្នន័យចាស់</span>
                <span class="text-xs font-normal text-gray-500">បើកមើលពេលត្រូវការ</span>
            </summary>
            <div class="p-5">
                <RegistrationManagement 
                    {supabase} 
                    on:viewUserProfile={(e) => viewUserProfile(e.detail)} 
                />
            </div>
        </details>
    {/if}

    {#if adminTab === 'forms'}
        <FormManagement 
            {supabase} 
            {currentUser} 
            {loginLogoUrl} 
            on:viewUserProfile={(e) => viewUserProfile(e.detail)} 
        />
    {/if}

    <!-- User Profile Details Modal (Popup) -->
    <UserProfileViewer 
        user={selectedUserProfile} 
        on:close={() => selectedUserProfile = null} 
    />
    </div>
</div>
