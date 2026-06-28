<script>
    import { createEventDispatcher, onMount, tick } from 'svelte';
    export let supabase;
    export let totalUsers = 0;
    export let courses = [];
    export let forms = [];
    export let currentUser;

    const dispatch = createEventDispatcher();

    let userGrowthChart = null;
    let userGrowthCanvas;
    let userGrowthLoading = false;
    let genderChart = null;
    let genderCanvas;
    let genderLoading = false;

    onMount(() => {
        loadUserGrowthStats();
        loadGenderStats();
    });

    async function loadUserGrowthStats() {
        userGrowthLoading = true;
        // Scope to last 13 months to avoid full table scan
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - 13);
        const { data, error } = await supabase
            .from('users')
            .select('created_at')
            .gte('created_at', cutoff.toISOString())
            .order('created_at', { ascending: true });

        if (error) {
            console.error("Error loading user stats:", error);
            userGrowthLoading = false;
        } else {
            userGrowthLoading = false;
            await tick();
            await processUserGrowthData(data);
        }
    }

    async function processUserGrowthData(users) {
        if (!users || users.length === 0) return;
        if (!userGrowthCanvas) return;

        const counts = {};
        users.forEach(u => {
            const date = new Date(u.created_at);
            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            counts[key] = (counts[key] || 0) + 1;
        });

        const sortedKeys = Object.keys(counts).sort();
        const displayKeys = sortedKeys.slice(-12);

        const labels = displayKeys.map(k => {
            const [y, m] = k.split('-');
            const date = new Date(parseInt(y), parseInt(m) - 1, 1);
            return date.toLocaleDateString('km-KH', { month: 'long', year: 'numeric' });
        });
        const data = displayKeys.map(k => counts[k]);

        if (typeof window !== 'undefined') {
            const { default: Chart } = await import('chart.js/auto');
            
            if (userGrowthChart) userGrowthChart.destroy();
            
            userGrowthChart = new Chart(userGrowthCanvas, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'សិស្សចុះឈ្មោះ',
                        data: data,
                        backgroundColor: 'rgba(13, 148, 136, 0.6)',
                        borderColor: 'rgba(13, 148, 136, 1)',
                        borderWidth: 1,
                        borderRadius: 4,
                        barThickness: 20
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, grid: { color: '#f3f4f6' }, ticks: { precision: 0 } },
                        x: { grid: { display: false } }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (context) => ` ${context.raw} នាក់`
                            }
                        }
                    }
                }
            });
        }
    }

    async function loadGenderStats() {
        genderLoading = true;
        const { data, error } = await supabase
            .from('users')
            .select('gender')
            .limit(5000);

        if (error) {
            console.error("Error loading gender stats:", error);
            genderLoading = false;
        } else {
            genderLoading = false;
            await tick();
            await processGenderData(data);
        }
    }

    async function processGenderData(users) {
        if (!users || users.length === 0) return;
        if (!genderCanvas) return;

        let male = 0;
        let female = 0;
        let other = 0;

        users.forEach(u => {
            const g = (u.gender || '').toLowerCase();
            if (g === 'male' || g === 'ប្រុស') male++;
            else if (g === 'female' || g === 'ស្រី') female++;
            else other++;
        });

        if (typeof window !== 'undefined') {
            const { default: Chart } = await import('chart.js/auto');
            if (genderChart) genderChart.destroy();
            
            genderChart = new Chart(genderCanvas, {
                type: 'doughnut',
                data: {
                    labels: ['ប្រុស (Male)', 'ស្រី (Female)', 'ផ្សេងៗ'],
                    datasets: [{
                        data: [male, female, other],
                        backgroundColor: ['#3b82f6', '#ec4899', '#9ca3af'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'bottom' } }
                }
            });
        }
    }

    function switchTab(tab) {
        dispatch('switchTab', tab);
    }
</script>

<div class="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
    <div class="stat bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-6 relative overflow-hidden group">
        <div class="stat-figure text-primary absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-32 h-32"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
        </div>
        <div class="stat-title font-bold text-gray-500">អ្នកប្រើប្រាស់សរុប</div>
        <div class="stat-value text-teal-600 text-4xl mt-2">{totalUsers}</div>
        <div class="stat-desc text-teal-600/60 font-medium">នាក់</div>
    </div>
    
    <div class="stat bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-6 relative overflow-hidden group">
        <div class="stat-figure text-secondary absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-32 h-32"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.967 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
        </div>
        <div class="stat-title font-bold text-gray-500">វគ្គសិក្សា</div>
        <div class="stat-value text-amber-500 text-4xl mt-2">{courses.length}</div>
        <div class="stat-desc text-amber-500/60 font-medium">វគ្គ</div>
    </div>

     <div class="stat bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-6 relative overflow-hidden group">
        <div class="stat-figure text-accent absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-32 h-32"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
        </div>
        <div class="stat-title font-bold text-gray-500">បែបបទ (Forms)</div>
        <div class="stat-value text-blue-500 text-4xl mt-2">{forms.length}</div>
        <div class="stat-desc text-blue-500/60 font-medium">ទម្រង់</div>
    </div>
</div>

<!-- User Growth Chart -->
<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
    <div class="lg:col-span-2 p-6 bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <h3 class="font-bold text-lg text-gray-700 mb-4">📊 ស្ថិតិសិស្សចុះឈ្មោះប្រចាំខែ (12 ខែចុងក្រោយ)</h3>
        <div class="h-64 w-full">
            {#if userGrowthLoading}
                <div class="flex h-full items-center justify-center"><span class="loading loading-spinner"></span></div>
            {:else}
                <canvas bind:this={userGrowthCanvas}></canvas>
            {/if}
        </div>
    </div>
    <div class="p-6 bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <h3 class="font-bold text-lg text-gray-700 mb-4">👥 សមាមាត្រយេនឌ័រ</h3>
        <div class="h-64 w-full relative">
            {#if genderLoading}
                <div class="flex h-full items-center justify-center"><span class="loading loading-spinner"></span></div>
            {:else}
                <canvas bind:this={genderCanvas}></canvas>
            {/if}
        </div>
    </div>
</div>

<!-- Menu Grid -->
<h3 class="text-lg font-bold text-gray-700 mb-4 px-1">ម៉ឺនុយគ្រប់គ្រង</h3>
<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
    <!-- User Management -->
    <button on:click={() => switchTab('users')} class="group bg-white p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-200 text-left flex flex-col items-start">
        <div class="p-3 rounded-none bg-teal-100 text-teal-800 border-2 border-black mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
        </div>
        <h3 class="font-bold text-gray-800 text-lg">អ្នកប្រើប្រាស់</h3>
        <p class="text-sm text-gray-500 mt-1">គ្រប់គ្រងសមាជិក និងសិទ្ធិ</p>
    </button>

    <!-- Course Management -->
    <button on:click={() => switchTab('courses')} class="group bg-white p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-200 text-left flex flex-col items-start">
        <div class="p-3 rounded-none bg-amber-100 text-amber-800 border-2 border-black mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.967 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>
        </div>
        <h3 class="font-bold text-gray-800 text-lg">វគ្គសិក្សា</h3>
        <p class="text-sm text-gray-500 mt-1">មេរៀន, លិខិតបញ្ជាក់ការសិក្សា</p>
    </button>

    <!-- Meeting Management -->
    <button on:click={() => switchTab('meetings')} class="group bg-white p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-200 text-left flex flex-col items-start">
        <div class="p-3 rounded-none bg-purple-100 text-purple-800 border-2 border-black mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0h18M5.25 12h13.5h-13.5zm1 5.25h13.5h-13.5z" /></svg>
        </div>
        <h3 class="font-bold text-gray-800 text-lg">ការប្រជុំ</h3>
        <p class="text-sm text-gray-500 mt-1">កាលវិភាគ, Zoom/Google Meet</p>
    </button>

    <!-- Forms -->
    <button on:click={() => switchTab('forms')} class="group bg-white p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-200 text-left flex flex-col items-start">
        <div class="p-3 rounded-none bg-blue-100 text-blue-800 border-2 border-black mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" /></svg>
        </div>
        <h3 class="font-bold text-gray-800 text-lg">បែបបទ (Forms)</h3>
        <p class="text-sm text-gray-500 mt-1">បង្កើត Form, ស្ទង់មតិ</p>
    </button>

    <!-- Registrations -->
    <button on:click={() => switchTab('registrations')} class="group bg-white p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-200 text-left flex flex-col items-start">
        <div class="p-3 rounded-none bg-indigo-100 text-indigo-800 border-2 border-black mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>
        </div>
        <h3 class="font-bold text-gray-800 text-lg">អ្នកចុះឈ្មោះ</h3>
        <p class="text-sm text-gray-500 mt-1">បញ្ជីអ្នកចុះឈ្មោះប្រជុំ</p>
    </button>

    <!-- Quiz Results -->
    <button on:click={() => switchTab('quiz_results')} class="group bg-white p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-200 text-left flex flex-col items-start">
        <div class="p-3 rounded-none bg-green-100 text-green-800 border-2 border-black mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <h3 class="font-bold text-gray-800 text-lg">លទ្ធផលប្រឡង</h3>
        <p class="text-sm text-gray-500 mt-1">ពិន្ទុ និងប្រវត្តិសិស្ស</p>
    </button>

    <!-- Certificate Generator (Excel) -->
    <button on:click={() => dispatch('openCertGen')} class="group bg-white p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-200 text-left flex flex-col items-start">
        <div class="p-3 rounded-none bg-cyan-100 text-cyan-800 border-2 border-black mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M10.125 2.25h-4.5c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125v-9M10.125 2.25h.375a9 9 0 019 9v.375M10.125 2.25A3.375 3.375 0 0113.5 5.625v1.5c0 .621.504 1.125 1.125 1.125h1.5a3.375 3.375 0 013.375 3.375M9 15l2.25 2.25L15 12" /></svg>
        </div>
        <h3 class="font-bold text-gray-800 text-lg">បង្កើតសញ្ញាបត្រ</h3>
        <p class="text-sm text-gray-500 mt-1">Excel Import</p>
    </button>

    <!-- Notifications -->
    <button on:click={() => switchTab('notifications')} class="group bg-white p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-200 text-left flex flex-col items-start">
        <div class="p-3 rounded-none bg-red-100 text-red-800 border-2 border-black mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" /></svg>
        </div>
        <h3 class="font-bold text-gray-800 text-lg">ការជូនដំណឹង</h3>
        <p class="text-sm text-gray-500 mt-1">ផ្ញើសារទៅសមាជិក</p>
    </button>

    <!-- Storage -->
    <button on:click={() => switchTab('storage')} class="group bg-white p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-200 text-left flex flex-col items-start">
        <div class="p-3 rounded-none bg-pink-100 text-pink-800 border-2 border-black mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
        </div>
        <h3 class="font-bold text-gray-800 text-lg">ឃ្លាំងឯកសារ</h3>
        <p class="text-sm text-gray-500 mt-1">គ្រប់គ្រងរូបភាព/ឯកសារ</p>
    </button>

    {#if currentUser?.role === 'owner'}
        <!-- Owner Only: Admin Management -->
        <button on:click={() => switchTab('system_admins')} class="group bg-yellow-50 p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-200 text-left flex flex-col items-start">
            <div class="p-3 rounded-none bg-yellow-100 text-yellow-800 border-2 border-black mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
            </div>
            <h3 class="font-bold text-yellow-900 text-lg">គ្រប់គ្រង Admin</h3>
            <p class="text-sm text-yellow-700/70 mt-1">តែងតាំង/ដកសិទ្ធិ</p>
        </button>

        <!-- Owner Only: Logs -->
        <button on:click={() => switchTab('activity_logs')} class="group bg-gray-100 p-6 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-none transition-all duration-200 text-left flex flex-col items-start">
            <div class="p-3 rounded-none bg-gray-200 text-gray-800 border-2 border-black mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-8 h-8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <h3 class="font-bold text-gray-900 text-lg">Log សកម្មភាព</h3>
            <p class="text-sm text-gray-600 mt-1">ប្រវត្តិសកម្មភាព Admin</p>
        </button>
    {/if}
</div>