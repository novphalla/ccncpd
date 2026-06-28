<script>
    import { onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    import { SearchIcon, XIcon } from 'lucide-svelte';

    export let supabase;
    export let currentUser;

    let activityLogs = [];
    let loading = false;
    let searchQuery = '';
    let searchTimer;
    let page = 1;
    const pageSize = 50;
    let hasMore = true;
    let startDate = '';
    let endDate = '';

    onMount(() => {
        loadActivityLogs();
    });

    function handleSearch() {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            loadActivityLogs();
        }, 300);
    }

    function handleFilterChange() {
        loadActivityLogs();
    }

    function clearDateFilter() {
        startDate = '';
        endDate = '';
        loadActivityLogs();
    }

    function clearSearch() {
        searchQuery = '';
        loadActivityLogs();
    }

    async function loadActivityLogs(isLoadMore = false) {
        if (typeof isLoadMore !== 'boolean') isLoadMore = false; // ការពារ Error ពេលចុចចេញពី UI ផ្ទាល់

        // អនុញ្ញាតឱ្យទាំង Owner និង Admin អាចមើលបាន
        if (!['owner', 'admin'].includes(currentUser?.role)) return;
        loading = true;
        
        if (!isLoadMore) {
            page = 1;
            hasMore = true;
        }
        
        let query = supabase
            .from('admin_logs')
            .select('*, users!inner(full_name, name_latin, role)')
            
        // បើអ្នកប្រើជា Admin ធម្មតា គឺមិនអាចទាញយក Log ដែលធ្វើឡើងដោយ Owner បានទេ
        if (currentUser.role !== 'owner') query = query.neq('users.role', 'owner');
            
        // បន្ថែមលក្ខខណ្ឌស្វែងរកឈ្មោះ ឬឈ្មោះឡាតាំង
        if (searchQuery.trim()) {
            const safeSearch = searchQuery.trim().replace(/,/g, ' '); // ការពារ Error ពេលមានសញ្ញាក្បៀស
            query = query.or(`full_name.ilike.%${safeSearch}%,name_latin.ilike.%${safeSearch}%`, { foreignTable: 'users' });
        }

        // បន្ថែមលក្ខខណ្ឌចម្រោះតាមកាលបរិច្ឆេទ
        if (startDate) {
            const start = new Date(`${startDate}T00:00:00`);
            query = query.gte('created_at', start.toISOString());
        }
        if (endDate) {
            const end = new Date(`${endDate}T23:59:59.999`);
            query = query.lte('created_at', end.toISOString());
        }

        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;
        query = query.range(from, to).order('created_at', { ascending: false });

        const { data, error } = await query;
        if (error) console.error("Error fetching logs:", error);
        else {
            if (isLoadMore) activityLogs = [...activityLogs, ...(data || [])];
            else activityLogs = data || [];
            
            if (!data || data.length < pageSize) hasMore = false;
        }
        loading = false;
    }

    function loadMore() {
        if (!loading && hasMore) {
            page++;
            loadActivityLogs(true);
        }
    }
</script>

<div class="card bg-base-100 p-5 shadow-md border border-base-300">
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-4">
        <h3 class="font-bold text-lg text-gray-800">📜 កំណត់ត្រាសកម្មភាព (Activity Logs)</h3>
        <div class="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
            <div class="flex items-center gap-1 bg-base-200/50 p-1 rounded-lg border border-base-300 w-full md:w-auto">
                <input type="date" bind:value={startDate} on:change={handleFilterChange} class="input input-sm input-bordered bg-white flex-1 md:w-[130px]" title="ចាប់ពីថ្ងៃទី" />
                <span class="text-gray-500 text-xs px-1">ដល់</span>
                <input type="date" bind:value={endDate} on:change={handleFilterChange} class="input input-sm input-bordered bg-white flex-1 md:w-[130px]" title="ដល់ថ្ងៃទី" />
                {#if startDate || endDate}
                    <button type="button" class="btn btn-xs btn-ghost text-error px-1" on:click={clearDateFilter} title="លុបកាលបរិច្ឆេទ">
                        <XIcon class="w-4 h-4" />
                    </button>
                {/if}
            </div>
            <div class="relative w-full md:w-64">
                {#if loading && searchQuery}
                    <span class="absolute left-2.5 top-1/2 -translate-y-1/2 loading loading-spinner loading-xs text-primary"></span>
                {:else}
                    <SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                {/if}
                <input type="text" bind:value={searchQuery} on:input={handleSearch} placeholder="ស្វែងរកឈ្មោះអ្នកធ្វើសកម្មភាព..." class="input input-sm input-bordered w-full pl-8 pr-8" />
                {#if searchQuery}
                    <button type="button" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors" on:click={clearSearch}>
                        <XIcon class="w-4 h-4" />
                    </button>
                {/if}
            </div>
            <button class="btn btn-sm btn-ghost shrink-0" on:click={() => loadActivityLogs()} disabled={loading}>
                {#if loading && !searchQuery}<span class="loading loading-spinner loading-xs"></span>{/if} Refresh
            </button>
        </div>
    </div>
    <div class="overflow-x-auto bg-base-100 rounded-xl border border-base-300">
        <table class="table w-full">
            <thead class="bg-base-200 text-base-content">
                <tr><th>កាលបរិច្ឆេទ</th><th>អ្នកធ្វើសកម្មភាព</th><th>សកម្មភាព</th><th>លម្អិត</th></tr>
            </thead>
            <tbody>
                {#if activityLogs.length === 0 && !loading}
                    <tr><td colspan="4" class="text-center py-6 text-gray-500">មិនមានកំណត់ត្រាសកម្មភាពទេ</td></tr>
                {/if}
                {#each activityLogs as log, i}
                    <tr class="hover" in:fade={{ duration: 200, delay: i * 30 }}>
                        <td class="text-xs">{new Date(log.created_at).toLocaleString('km-KH')}</td>
                        <td><div class="font-bold">{log.users?.full_name || 'Unknown'}</div>{#if log.users?.name_latin}<div class="text-xs opacity-50">{log.users.name_latin}</div>{/if}</td>
                        <td><span class="badge badge-ghost">{log.action}</span></td><td class="text-sm text-gray-600">{log.details}</td>
                    </tr>
                {/each}
            </tbody>
        </table>
    </div>

    {#if hasMore && activityLogs.length > 0}
        <div class="flex justify-center mt-4 mb-2">
            <button class="btn btn-sm btn-outline shadow-sm hover:shadow-md" on:click={loadMore} disabled={loading}>
                {#if loading}<span class="loading loading-spinner loading-xs"></span>{/if} ទាញយកបន្ថែម (Load More)
            </button>
        </div>
    {/if}
</div>