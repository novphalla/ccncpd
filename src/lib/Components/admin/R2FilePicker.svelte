<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    import { XIcon } from 'lucide-svelte';
    import { PUBLIC_R2_PUBLIC_URL } from '$env/static/public';

    export let currentUser = null;
    export let isLocal = false;

    const dispatch = createEventDispatcher();

    let pickerFiles = [];
    let pickerLoading = false;
    let pickerCursor = null;
    let pickerHasMore = false;
    let pickerSearch = '';
    let pickerPreviewUrl = null;
    let pickerPreviewKey = null;
    let pickerPreviewType = null;
    let pickerPage = 1;
    let pickerPageSize = 10;
    let pickerFilter = 'all'; // 'all', 'image', 'pdf', 'video'
    let pickerUploading = false;
    let pickerUploadTotal = 0;
    let pickerUploadCompleted = 0;

    onMount(() => {
        loadPickerFiles(true);
    });

    async function loadPickerFiles(reset = false) {
        if (reset) { pickerFiles = []; pickerCursor = null; }
        pickerLoading = true;
        try {
            let url = `/api/storage?limit=20&prefix=${encodeURIComponent(pickerSearch)}`;
            if (pickerCursor) url += `&cursor=${encodeURIComponent(pickerCursor)}`;
            const res = await fetch(url, {
                headers: { 'X-User-Id': currentUser?.id || '' }
            });
            const data = await res.json();
            if (data.objects) {
                pickerFiles = [...pickerFiles, ...data.objects];
                pickerHasMore = data.truncated;
                pickerCursor = data.cursor;
            }
        } catch(e) { console.error(e); }
        finally { pickerLoading = false; }
    }

    async function handlePickerUpload(e) {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        pickerUploading = true;
        pickerUploadTotal = files.length;
        pickerUploadCompleted = 0;
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const formData = new FormData();
                const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
                const renamedFile = new File([file], safeName, { type: file.type });
                
                formData.append('file', renamedFile);
                formData.append('folder', 'uploads');
                
                const res = await fetch('/api/storage', {
                    method: 'POST',
                    headers: { 'X-User-Id': currentUser?.id || '' },
                    body: formData
                });
                if (!res.ok) throw new Error(await res.text());
                pickerUploadCompleted++;
            }
            
            await loadPickerFiles(true);
        } catch (error) {
            alert("មានបញ្ហាក្នុងការ Upload: " + error.message);
        } finally {
            pickerUploading = false;
            e.target.value = '';
        }
    }

    async function renamePickerFile(e, file) {
        e.stopPropagation();
        const oldName = file.key.split('/').pop();
        const folderMatch = file.key.match(/^(.*)\//);
        const folder = folderMatch ? folderMatch[1] : 'uploads';

        let newName = prompt("បញ្ចូលឈ្មោះថ្មីសម្រាប់ឯកសារនេះ:", oldName);
        if (!newName || newName === oldName) return;

        // រក្សាទុកកន្ទុយឯកសារ (Extension) ដដែល
        const oldExt = oldName.split('.').pop();
        if (!newName.toLowerCase().endsWith('.' + oldExt.toLowerCase())) {
            newName += '.' + oldExt;
        }
        const safeName = newName.replace(/[^a-zA-Z0-9.-]/g, '_');
        
        pickerLoading = true;
        try {
            // ទាញយក (Download) -> បញ្ចូលថ្មី (Upload) -> លុបចាស់ (Delete)
            const fileRes = await fetch(`${PUBLIC_R2_PUBLIC_URL}/${file.key}`);
            if (!fileRes.ok) throw new Error("មិនអាចទាញយកឯកសារដើមបានទេ (CORS Error)");
            const blob = await fileRes.blob();
            
            const formData = new FormData();
            formData.append('file', new File([blob], safeName, { type: blob.type }));
            formData.append('folder', folder);
            
            const uploadRes = await fetch('/api/storage', { method: 'POST', headers: { 'X-User-Id': currentUser?.id || '' }, body: formData });
            if (!uploadRes.ok) throw new Error(await uploadRes.text());
            
            await fetch('/api/storage', { method: 'DELETE', headers: { 'X-User-Id': currentUser?.id || '', 'Content-Type': 'application/json' }, body: JSON.stringify({ url: file.key }) });
            
            await loadPickerFiles(true);
        } catch (error) {
            alert("មានបញ្ហាពេលប្តូរឈ្មោះ: " + error.message + "\n(បញ្ជាក់៖ R2 Bucket របស់អ្នកត្រូវអនុញ្ញាត CORS ទើបអាចប្តូរឈ្មោះបាន)");
        } finally {
            pickerLoading = false;
        }
    }

    async function nextPickerPage() {
        if (pickerPage < totalPickerPages) {
            pickerPage++;
        } else if (pickerHasMore) {
            await loadPickerFiles();
            if (pickerPage < totalPickerPages) pickerPage++;
        }
    }

    $: filteredPickerFiles = pickerFiles.filter(f => {
        if (pickerFilter === 'all') return true;
        const ext = f.key.split('.').pop().toLowerCase();
        if (pickerFilter === 'image') return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico'].includes(ext);
        if (pickerFilter === 'pdf') return ext === 'pdf';
        if (pickerFilter === 'video') return ['mp4', 'webm', 'ogg', 'mov'].includes(ext);
        return true;
    });

    $: paginatedPickerFiles = filteredPickerFiles.slice((pickerPage - 1) * pickerPageSize, pickerPage * pickerPageSize);
    $: totalPickerPages = Math.ceil(filteredPickerFiles.length / pickerPageSize);
    
    $: { pickerSearch; pickerPage = 1; pickerFilter; }

    function selectFile(key) {
        const url = `${PUBLIC_R2_PUBLIC_URL}/${key}`;
        dispatch('select', { key, url });
    }

    function openPickerPreview(e, file) {
        e.stopPropagation();
        pickerPreviewUrl = `${PUBLIC_R2_PUBLIC_URL}/${file.key}`;
        pickerPreviewKey = file.key;
        
        const ext = file.key.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico'].includes(ext)) pickerPreviewType = 'image';
        else if (ext === 'pdf') pickerPreviewType = 'pdf';
        else if (['mp4', 'webm', 'ogg', 'mov'].includes(ext)) pickerPreviewType = 'video';
    }

    function closePickerPreview() {
        pickerPreviewUrl = null;
        pickerPreviewKey = null;
        pickerPreviewType = null;
    }
</script>

<script context="module">
    function draggable(node) {
        let startX, startY, initialLeft, initialTop;
        const modalBox = node.closest('.modal-box');
        if (!modalBox) return;
        function onMouseDown(e) {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'INPUT') return;
            startX = e.clientX;
            startY = e.clientY;
            const style = window.getComputedStyle(modalBox);
            const matrix = new DOMMatrix(style.transform);
            initialLeft = matrix.m41;
            initialTop = matrix.m42;
            modalBox.style.transition = 'none';
            modalBox.style.animation = 'none';
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
            node.style.cursor = 'grabbing';
        }
        function onMouseMove(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            modalBox.style.transform = `translate(${initialLeft + dx}px, ${initialTop + dy}px)`;
        }
        function onMouseUp() {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            node.style.cursor = 'grab';
        }
        node.style.cursor = 'grab';
        node.addEventListener('mousedown', onMouseDown);
        return { destroy() { node.removeEventListener('mousedown', onMouseDown); } };
    }
</script>

<div class="modal modal-open bg-black/60 z-[100]" transition:fade={{ duration: 200 }}>
    <div class="modal-box text-base-content w-11/12 max-w-5xl p-0 overflow-hidden rounded-2xl flex flex-col max-h-[90vh] shadow-2xl">
        <div class="p-4 border-b shrink-0" use:draggable>
        <h3 class="font-bold text-lg mb-4">
            ជ្រើសរើសរូបភាពពីឃ្លាំង (R2) 
            <span class="text-sm font-normal text-gray-500">{isLocal ? '(Local / ក្នុងម៉ាស៊ីន)' : '(Production / លើអនឡាញ)'}</span>
        </h3>
        
        <div class="flex flex-col md:flex-row gap-2 mb-4">
            <div class="join">
                <button class="join-item btn btn-sm {pickerFilter === 'all' ? 'btn-active btn-primary' : ''}" on:click={() => pickerFilter = 'all'}>ទាំងអស់</button>
                <button class="join-item btn btn-sm {pickerFilter === 'image' ? 'btn-active btn-primary' : ''}" on:click={() => pickerFilter = 'image'}>រូបភាព</button>
                <button class="join-item btn btn-sm {pickerFilter === 'pdf' ? 'btn-active btn-primary' : ''}" on:click={() => pickerFilter = 'pdf'}>PDF</button>
                <button class="join-item btn btn-sm {pickerFilter === 'video' ? 'btn-active btn-primary' : ''}" on:click={() => pickerFilter = 'video'}>វីដេអូ</button>
            </div>
            <div class="flex gap-2 flex-1">
                <input bind:value={pickerSearch} placeholder="ស្វែងរក..." class="input input-sm input-bordered w-full" on:keydown={(e) => e.key === 'Enter' && loadPickerFiles(true)} />
                <button class="btn btn-sm btn-primary" on:click={() => loadPickerFiles(true)}>ស្វែងរក</button>
            {#if pickerUploading && pickerUploadTotal > 0}
                <div class="flex flex-col justify-center min-w-[100px] px-2">
                    <progress class="progress progress-info w-full" value={pickerUploadCompleted} max={pickerUploadTotal}></progress>
                    <span class="text-[10px] text-center leading-none mt-1">{Math.round((pickerUploadCompleted / pickerUploadTotal) * 100)}% ({pickerUploadCompleted}/{pickerUploadTotal})</span>
                </div>
            {/if}
            <label class="btn btn-sm btn-info text-white cursor-pointer {pickerUploading ? 'btn-disabled opacity-50' : ''}">
                {#if pickerUploading}<span class="loading loading-spinner loading-xs"></span>{:else}📤 Upload{/if}
                <input type="file" multiple class="hidden" on:change={handlePickerUpload} disabled={pickerUploading} />
            </label>
            </div>
        </div>
        </div>

        <div class="flex gap-4 p-4 overflow-y-auto flex-1 min-h-0">
            <!-- File List -->
            <div class="flex-1 overflow-y-auto border rounded relative">
                <table class="table table-xs w-full table-pin-rows">
                    <thead class="bg-base-200 text-base-content"><tr><th>រូបភាព</th><th>ឈ្មោះ</th><th class="text-right">ទំហំ</th><th class="text-right">សកម្មភាព</th></tr></thead>
                    <tbody>
                        {#each paginatedPickerFiles as file, i}
                            <tr class="hover transition-colors cursor-pointer" on:click={() => selectFile(file.key)} in:fade={{ duration: 200, delay: i * 30 }}>
                                <td>
                                    {#if file.key.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/i)}
                                    <img src={`${PUBLIC_R2_PUBLIC_URL}/${file.key}`} alt="preview" class="w-8 h-8 object-cover rounded-md" />
                                    {:else if file.key.match(/\.pdf$/i)}
                                        <span class="text-red-500 text-lg">📄</span>
                                    {:else if file.key.match(/\.(mp4|webm|ogg|mov)$/i)}
                                        <span class="text-blue-500 text-lg">🎥</span>
                                    {:else}
                                        <span class="text-lg">📁</span>
                                    {/if}
                                </td>
                                <td class="truncate max-w-xs" title={file.key}>{file.key}</td>
                                <td class="text-right text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</td>
                                <td class="text-right">
                                    <button class="btn btn-xs btn-ghost btn-square" on:click={(e) => renamePickerFile(e, file)} title="ប្តូរឈ្មោះ">✏️</button>
                                    <button class="btn btn-xs btn-ghost btn-square" on:click={(e) => openPickerPreview(e, file)} title="Preview">👁️</button>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
                {#if pickerLoading}<div class="text-center p-2"><span class="loading loading-spinner loading-xs"></span></div>{/if}

                <!-- Pagination Controls -->
                <div class="flex flex-col justify-between items-center p-2 gap-2 border-t sticky bottom-0 bg-base-100 shadow-sm">
                    <div class="join">
                        <button class="join-item btn btn-xs" disabled={pickerPage === 1} on:click={() => pickerPage--}>«</button>
                        <button class="join-item btn btn-xs">ទំព័រ {pickerPage} / {totalPickerPages || 1}</button>
                        <button class="join-item btn btn-xs" disabled={pickerPage === totalPickerPages && !pickerHasMore} on:click={nextPickerPage}>
                            {pickerPage === totalPickerPages && pickerHasMore ? 'ផ្ទុកបន្ថែម »' : '»'}
                        </button>
                    </div>
                    <div class="flex items-center gap-2">
                        <select bind:value={pickerPageSize} class="select select-bordered select-xs">
                            <option value={10}>10 / ទំព័រ</option>
                            <option value={20}>20 / ទំព័រ</option>
                            <option value={50}>50 / ទំព័រ</option>
                        </select>
                        <div class="text-[10px] text-gray-500">សរុប: {filteredPickerFiles.length} {pickerHasMore ? '+' : ''}</div>
                    </div>
                </div>
            </div>

            <!-- Preview Panel -->
            {#if pickerPreviewUrl}
                <div class="w-1/2 border rounded-xl bg-base-200 flex flex-col shadow-lg">
                    <div class="p-2 border-b flex justify-between items-center bg-base-100 rounded-t-xl">
                        <span class="font-bold text-xs">Preview: {pickerPreviewType ? pickerPreviewType.toUpperCase() : 'FILE'}</span>
                        <button class="rounded-full w-6 h-6 hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none text-gray-500" on:click={closePickerPreview}><XIcon class="w-4 h-4" /></button>
                    </div>
                    <div class="flex-1 flex items-center justify-center overflow-hidden p-2 bg-base-300/50">
                        {#if pickerPreviewType === 'image'}
                            <img src={pickerPreviewUrl} alt="Preview" class="max-w-full max-h-full object-contain shadow" />
                        {:else if pickerPreviewType === 'pdf'}
                            <iframe src={pickerPreviewUrl} title="PDF Preview" class="w-full h-full bg-base-100 shadow border"></iframe>
                        {:else if pickerPreviewType === 'video'}
                            <video src={pickerPreviewUrl} controls class="max-w-full max-h-full shadow"></video>
                        {/if}
                    </div>
                    <div class="p-2 border-t bg-base-100 text-center rounded-b-xl">
                        <button class="btn btn-sm btn-primary w-full" on:click={() => selectFile(pickerPreviewKey)}>✅ ជ្រើសរើសរូបនេះ</button>
                    </div>
                </div>
            {/if}
        </div>
        <div class="modal-action p-4 border-t m-0 shrink-0"><button class="btn" on:click={() => dispatch('close')}>បិទ</button></div>
    </div>
</div>