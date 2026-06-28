<script>
    import { onMount } from 'svelte';
    import { PUBLIC_R2_PUBLIC_URL } from '$env/static/public';

    export let currentUser;

    // ── State ───────────────────────────────────────────
    let allFiles   = [];
    let loading    = false;
    let isUploading = false;

    // Folder tabs
    const FOLDERS = [
        { key: '',               label: 'ទាំងអស់',        icon: '🗂️' },
        { key: 'lessons/',       label: 'មេរៀន',          icon: '📚' },
        { key: 'avatars/',       label: 'រូបតំណាង',    icon: '👤' },
        { key: 'thumbnails/',    label: 'Cover',           icon: '🖼️' },
        { key: 'course_assets/', label: 'Course Assets',  icon: '📁' },
        { key: 'manual_uploads/',label: 'Manual',         icon: '📤' },
    ];
    let activeFolder = '';

    // Search / sort / filter
    let searchText = '';
    let sortBy     = 'uploaded'; // key | size | uploaded
    let sortAsc    = false;
    let typeFilter = 'all';     // all | image | pdf | video | other

    // Pagination
    let currentPage = 1;
    const pageSize  = 25;

    // Bulk select
    let selected = new Set();
    $: allPageSelected = pagedFiles.length > 0 && pagedFiles.every(f => selected.has(f.key));

    // ── Derived ─────────────────────────────────────────
    $: filtered = allFiles.filter(f => {
        if (!f.key.startsWith(activeFolder)) return false;
        if (searchText && !f.key.toLowerCase().includes(searchText.toLowerCase())) return false;
        if (typeFilter !== 'all') {
            const t = fileType(f.key);
            if (t !== typeFilter) return false;
        }
        return true;
    });

    $: sorted = [...filtered].sort((a, b) => {
        let va = a[sortBy], vb = b[sortBy];
        if (sortBy === 'key') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
        if (va < vb) return sortAsc ? -1 :  1;
        if (va > vb) return sortAsc ?  1 : -1;
        return 0;
    });

    $: totalPages  = Math.max(1, Math.ceil(sorted.length / pageSize));
    $: pagedFiles  = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    $: totalSize   = allFiles.reduce((s, f) => s + (f.size || 0), 0);
    $: folderSize  = filtered.reduce((s, f) => s + (f.size || 0), 0);

    // Folder file counts for tab badges
    $: folderCounts = Object.fromEntries(
        FOLDERS.map(f => [f.key, f.key === '' ? allFiles.length : allFiles.filter(x => x.key.startsWith(f.key)).length])
    );

    // ── Helpers ─────────────────────────────────────────
    function fileType(key) {
        if (key.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) return 'image';
        if (key.match(/\.pdf$/i))                          return 'pdf';
        if (key.match(/\.(mp4|webm|ogg|mov)$/i))           return 'video';
        return 'other';
    }

    function fileIcon(key) {
        const t = fileType(key);
        if (t === 'image') return '🖼️';
        if (t === 'pdf')   return '📄';
        if (t === 'video') return '🎥';
        return '📁';
    }

    function formatSize(bytes) {
        if (!bytes) return '0 B';
        const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
    }

    function setSort(col) {
        if (sortBy === col) sortAsc = !sortAsc;
        else { sortBy = col; sortAsc = false; }
    }

    function sortIcon(col) {
        if (sortBy !== col) return '↕';
        return sortAsc ? '↑' : '↓';
    }

    function setFolder(key) {
        activeFolder = key;
        searchText   = '';
        currentPage  = 1;
        selected     = new Set();
    }

    // ── Auth ────────────────────────────────────────────
    async function authHeaders() {
        if (!currentUser?.id) throw new Error('Not authenticated');
        return { 'X-User-Id': currentUser.id };
    }

    // ── API calls ────────────────────────────────────────
    async function loadFiles() {
        loading = true; allFiles = []; currentPage = 1; selected = new Set();
        try {
            let cursor = null, collected = [];
            do {
                let url = `/api/storage?limit=1000&prefix=`;
                if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
                const h   = await authHeaders();
                const res = await fetch(url, { headers: h });
                const d   = await res.json();
                if (d.error) throw new Error(d.error);
                collected = [...collected, ...d.objects];
                cursor = d.truncated ? d.cursor : null;
            } while (cursor);
            allFiles = collected;
        } catch (e) {
            alert('Error: ' + e.message);
        } finally {
            loading = false;
        }
    }

    async function doDelete(key) {
        const h = await authHeaders();
        const res = await fetch('/api/storage', {
            method: 'DELETE',
            headers: { ...h, 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: key })
        });
        const d = await res.json();
        if (!d.success) throw new Error(d.error || 'Delete failed');
    }

    async function deleteOne(key) {
        if (!confirm(`លុប "${key}" ចេញ?`)) return;
        try {
            await doDelete(key);
            allFiles = allFiles.filter(f => f.key !== key);
            selected.delete(key); selected = new Set(selected);
            if (currentPage > 1 && (currentPage - 1) * pageSize >= sorted.length) currentPage--;
        } catch (e) { alert('Error: ' + e.message); }
    }

    async function bulkDelete() {
        if (!selected.size) return;
        if (!confirm(`លុប ${selected.size} ឯកសារ?`)) return;
        const keys = [...selected];
        let failed = 0;
        for (const key of keys) {
            try { await doDelete(key); allFiles = allFiles.filter(f => f.key !== key); }
            catch { failed++; }
        }
        selected = new Set();
        if (failed) alert(`${failed} ឯកសារ លុបមិនបាន`);
        if (currentPage > totalPages) currentPage = totalPages;
    }

    async function handleUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        isUploading = true;
        try {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('folder', 'manual_uploads');
            const h = await authHeaders();
            const res = await fetch('/api/storage', { method: 'POST', headers: h, body: fd });
            const d = await res.json();
            if (!res.ok) throw new Error(d.error);
            await loadFiles();
        } catch (err) { alert('Upload Error: ' + err.message); }
        finally { isUploading = false; e.target.value = ''; }
    }

    function toggleSelect(key) {
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        selected = new Set(selected);
    }

    function togglePageSelect() {
        if (allPageSelected) pagedFiles.forEach(f => selected.delete(f.key));
        else pagedFiles.forEach(f => selected.add(f.key));
        selected = new Set(selected);
    }

    onMount(loadFiles);
</script>

<!-- ── Header ────────────────────────────────────── -->
<div class="flex flex-wrap gap-3 items-center justify-between mb-4">
    <div>
        <h2 class="text-xl font-bold">ឃ្លាំងឯកសារ (R2 Storage)</h2>
        <p class="text-xs text-gray-400 mt-0.5">
            សរុប <strong>{allFiles.length}</strong> ឯកសារ ·
            <strong>{formatSize(totalSize)}</strong> ប្រើប្រាស់
        </p>
    </div>
    <div class="flex gap-2 items-center flex-wrap">
        {#if selected.size > 0}
        <button class="btn btn-sm btn-error text-white gap-1" on:click={bulkDelete}>
            🗑️ លុប ({selected.size})
        </button>
        {/if}
        <input id="su-input" type="file" class="hidden" accept="image/*,video/*,audio/*,application/pdf" on:change={handleUpload} disabled={isUploading} />
        <button class="btn btn-sm btn-primary text-white" on:click={() => document.getElementById('su-input').click()} disabled={isUploading}>
            {#if isUploading}<span class="loading loading-spinner loading-xs"></span>{:else}⬆️{/if}
            Upload
        </button>
        <button class="btn btn-sm btn-ghost" on:click={loadFiles} title="Refresh">🔄</button>
    </div>
</div>

<!-- ── Folder Tabs ────────────────────────────────── -->
<div class="flex gap-2 flex-wrap mb-3">
    {#each FOLDERS as f}
    <button
        class="btn btn-xs rounded-full gap-1 {activeFolder === f.key ? 'btn-primary text-white' : 'btn-outline'}"
        on:click={() => setFolder(f.key)}>
        {f.icon} {f.label}
        <span class="badge badge-sm {activeFolder === f.key ? 'badge-neutral text-white' : 'badge-ghost'}">
            {folderCounts[f.key] ?? 0}
        </span>
    </button>
    {/each}
</div>

<!-- ── Search + Type filter + Size info ──────────── -->
<div class="flex flex-wrap gap-2 items-center mb-3">
    <input bind:value={searchText}
           on:input={() => currentPage = 1}
           placeholder="🔍 ស្វែងរកឈ្មោះ..."
           class="input input-sm input-bordered flex-1 min-w-[180px]" />

    <select bind:value={typeFilter} on:change={() => currentPage = 1}
            class="select select-sm select-bordered">
        <option value="all">ប្រភេទទាំងអស់</option>
        <option value="image">🖼️ រូបភាព</option>
        <option value="pdf">📄 PDF</option>
        <option value="video">🎥 វីដេអូ</option>
        <option value="other">📁 ផ្សេងៗ</option>
    </select>

    <span class="text-xs text-gray-500">
        {sorted.length} ឯកសារ · {formatSize(folderSize)}
    </span>
</div>

<!-- ── Table ─────────────────────────────────────── -->
<div class="overflow-x-auto bg-white border rounded-xl">
    <table class="table table-xs w-full">
        <thead class="bg-gray-50 sticky top-0 z-10 border-b">
            <tr>
                <th>
                    <input type="checkbox" class="checkbox checkbox-xs"
                           checked={allPageSelected}
                           on:change={togglePageSelect} />
                </th>
                <th class="w-12">Preview</th>
                <th>
                    <button class="flex items-center gap-1 font-semibold hover:text-primary"
                            on:click={() => setSort('key')}>
                        ឈ្មោះ {sortIcon('key')}
                    </button>
                </th>
                <th>
                    <button class="flex items-center gap-1 font-semibold hover:text-primary"
                            on:click={() => setSort('size')}>
                        ទំហំ {sortIcon('size')}
                    </button>
                </th>
                <th>
                    <button class="flex items-center gap-1 font-semibold hover:text-primary"
                            on:click={() => setSort('uploaded')}>
                        កាលបរិច្ឆេទ {sortIcon('uploaded')}
                    </button>
                </th>
                <th>សកម្មភាព</th>
            </tr>
        </thead>
        <tbody>
            {#each pagedFiles as file (file.key)}
            <tr class="hover:bg-gray-50 border-b border-gray-100 {selected.has(file.key) ? 'bg-blue-50' : ''}">
                <td>
                    <input type="checkbox" class="checkbox checkbox-xs"
                           checked={selected.has(file.key)}
                           on:change={() => toggleSelect(file.key)} />
                </td>
                <td>
                    {#if fileType(file.key) === 'image'}
                        <img src={`${PUBLIC_R2_PUBLIC_URL}/${file.key}`} alt=""
                             class="w-9 h-9 object-cover rounded-md border" loading="lazy" />
                    {:else}
                        <span class="text-xl">{fileIcon(file.key)}</span>
                    {/if}
                </td>
                <td class="max-w-xs">
                    <div class="truncate font-mono text-xs text-gray-700" title={file.key}>{file.key}</div>
                    <div class="text-xs text-gray-400">{fileType(file.key)}</div>
                </td>
                <td class="whitespace-nowrap text-xs">{formatSize(file.size)}</td>
                <td class="whitespace-nowrap text-xs text-gray-500">{new Date(file.uploaded).toLocaleString('km-KH')}</td>
                <td class="whitespace-nowrap">
                    <a href={`${PUBLIC_R2_PUBLIC_URL}/${file.key}`} target="_blank"
                       class="btn btn-xs btn-ghost" title="បើក">🔗</a>
                    <button class="btn btn-xs btn-error text-white"
                            on:click={() => deleteOne(file.key)} title="លុប">🗑️</button>
                </td>
            </tr>
            {:else}
            <tr>
                <td colspan="6" class="text-center py-10 text-gray-400">
                    {loading ? 'កំពុងផ្ទុក...' : 'មិនមានឯកសារ'}
                </td>
            </tr>
            {/each}
        </tbody>
    </table>
    {#if loading}
    <div class="text-center p-4"><span class="loading loading-spinner text-primary"></span> កំពុងផ្ទុក...</div>
    {/if}
</div>

<!-- ── Pagination ─────────────────────────────────── -->
<div class="flex justify-between items-center mt-3">
    <span class="text-xs text-gray-500">
        បង្ហាញ {Math.min((currentPage - 1) * pageSize + 1, sorted.length)}–{Math.min(currentPage * pageSize, sorted.length)} នៃ {sorted.length}
    </span>
    <div class="join">
        <button class="join-item btn btn-xs btn-outline" disabled={currentPage <= 1}
                on:click={() => currentPage = 1}>«</button>
        <button class="join-item btn btn-xs btn-outline" disabled={currentPage <= 1}
                on:click={() => currentPage--}>‹</button>
        <span class="join-item btn btn-xs btn-ghost pointer-events-none">
            {currentPage} / {totalPages}
        </span>
        <button class="join-item btn btn-xs btn-outline" disabled={currentPage >= totalPages}
                on:click={() => currentPage++}>›</button>
        <button class="join-item btn btn-xs btn-outline" disabled={currentPage >= totalPages}
                on:click={() => currentPage = totalPages}>»</button>
    </div>
</div>
