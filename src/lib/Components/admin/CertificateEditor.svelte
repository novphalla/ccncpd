<script>
    import { onMount, tick, onDestroy } from 'svelte';
    import QRCode from 'qrcode';
    import { 
        ZoomInIcon, ZoomOutIcon, RotateCcwIcon, TargetIcon, UndoIcon, RedoIcon, 
        DownloadIcon, EyeIcon, UploadIcon 
    } from 'lucide-svelte';
    import { PUBLIC_R2_PUBLIC_URL } from '$env/static/public';
    import { normalizeAssetUrl } from '$lib/utils.js';

    export let editingCourse;

    $: certTemplateUrl = normalizeAssetUrl(editingCourse?.cert_template_url, PUBLIC_R2_PUBLIC_URL);

    let certificateElement;
    let previewImageElement;
    let isDownloadingJpg = false;
    let showGrid = false;
    let previewZoom = 1;
    let draggingItem = null;
    let selectedItem = null;
    let startX, startY, initialX, initialY;
    let qrCodeDataUrl = '';
    let loading = false;
    
    // Undo/Redo State
    let certHistory = [];
    let certHistoryIndex = -1;

    onMount(() => {
        // Initialize History
        if (editingCourse && editingCourse.cert_config) {
            certHistory = [JSON.parse(JSON.stringify(editingCourse.cert_config))];
            certHistoryIndex = 0;
        }
        
        const savedZoom = localStorage.getItem('certPreviewZoom');
        previewZoom = savedZoom ? parseFloat(savedZoom) : 1;
        
        generateSampleQr();
    });

    onDestroy(() => {
        if (typeof window !== 'undefined') {
            window.removeEventListener('mousemove', onDrag);
            window.removeEventListener('mouseup', stopDrag);
        }
    });

    function saveCertHistory() {
        if (certHistoryIndex < certHistory.length - 1) {
            certHistory = certHistory.slice(0, certHistoryIndex + 1);
        }
        certHistory.push(JSON.parse(JSON.stringify(editingCourse.cert_config)));
        certHistoryIndex++;

        if (certHistory.length > 50) {
            certHistory.shift();
            certHistoryIndex--;
        }
    }

    function undoCert() {
        if (certHistoryIndex > 0) {
            certHistoryIndex--;
            editingCourse.cert_config = JSON.parse(JSON.stringify(certHistory[certHistoryIndex]));
        }
    }

    function redoCert() {
        if (certHistoryIndex < certHistory.length - 1) {
            certHistoryIndex++;
            editingCourse.cert_config = JSON.parse(JSON.stringify(certHistory[certHistoryIndex]));
        }
    }

    function zoomIn() {
        previewZoom = Math.min(previewZoom + 0.1, 3);
        localStorage.setItem('certPreviewZoom', previewZoom);
    }

    function zoomOut() {
        previewZoom = Math.max(previewZoom - 0.1, 0.5);
        localStorage.setItem('certPreviewZoom', previewZoom);
    }

    function resetZoom() {
        previewZoom = 1;
        localStorage.setItem('certPreviewZoom', previewZoom);
    }

    function handleKeydown(e) {
        const tag = e.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;

        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            undoCert();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
            e.preventDefault();
            redoCert();
        }

        if (selectedItem && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
            const step = e.shiftKey ? 10 : 1;
            
            if (e.key === 'ArrowUp') editingCourse.cert_config[selectedItem].y -= step;
            if (e.key === 'ArrowDown') editingCourse.cert_config[selectedItem].y += step;
            if (e.key === 'ArrowLeft') editingCourse.cert_config[selectedItem].x -= step;
            if (e.key === 'ArrowRight') editingCourse.cert_config[selectedItem].x += step;
            
            saveCertHistory();
        }
    }

    async function urlToBase64(url) {
        try {
            const response = await fetch(url, { mode: 'cors', cache: 'no-cache' });
            const blob = await response.blob();
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (e) { console.error("Base64 conversion failed", e); return null; }
    }

    function patchClonedDoc(clonedDoc) {
        clonedDoc.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());
        clonedDoc.querySelectorAll('style').forEach(el => el.remove());
        const style = clonedDoc.createElement('style');
        style.textContent = `* { box-sizing: border-box; } .relative { position: relative; } .absolute { position: absolute; } .w-full { width: 100%; } .h-auto { height: auto; } .block { display: block; } .bg-white { background-color: #ffffff; }`;
        clonedDoc.head.appendChild(style);
    }

    async function downloadAsJpg() {
        if (!certificateElement) {
            alert('មិនអាចរកឃើញ Element របស់លិខិតបញ្ជាក់');
            return;
        }

        isDownloadingJpg = true;
        const originalZoom = previewZoom;
        previewZoom = 1;
        await tick();
        // Wait for transition to finish (duration-200)
        await new Promise(r => setTimeout(r, 300));

        let originalSrc = null;
        if (previewImageElement && certTemplateUrl && !certTemplateUrl.startsWith('data:')) {
            originalSrc = certTemplateUrl;
            const base64 = await urlToBase64(originalSrc);
            if (base64) previewImageElement.src = base64;
        }

        try {
            const { default: html2canvas } = await import('html2canvas');
            const canvas = await html2canvas(certificateElement, {
                scale: 2,
                useCORS: true,
                logging: false,
                onclone: (clonedDoc) => patchClonedDoc(clonedDoc)
            });
            const imageUrl = canvas.toDataURL('image/jpeg', 0.9);
            const link = document.createElement('a');
            link.href = imageUrl;
            link.download = 'certificate-preview.jpg';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error('Error generating JPG:', error);
            alert('មានបញ្ហាក្នុងការបង្កើត JPG: ' + (error.message || error));
        } finally {
            isDownloadingJpg = false;
            previewZoom = originalZoom;
            if (originalSrc && previewImageElement) previewImageElement.src = originalSrc;
        }
    }

    async function previewCertificate() {
        if (!certificateElement) return alert('មិនអាចរកឃើញ Element របស់លិខិតបញ្ជាក់');
        
        const originalZoom = previewZoom;
        previewZoom = 1;
        await tick();
        // Wait for transition to finish (duration-200)
        await new Promise(r => setTimeout(r, 300));

        let originalSrc = null;
        if (previewImageElement && certTemplateUrl && !certTemplateUrl.startsWith('data:')) {
            originalSrc = certTemplateUrl;
            const base64 = await urlToBase64(originalSrc);
            if (base64) previewImageElement.src = base64;
        }

        try {
            const { default: html2canvas } = await import('html2canvas');
            const canvas = await html2canvas(certificateElement, {
                scale: 2,
                useCORS: true,
                logging: false,
                onclone: (clonedDoc) => patchClonedDoc(clonedDoc)
            });
            const imgUrl = canvas.toDataURL('image/jpeg', 0.9);
            const win = window.open("", "Preview", "width=800,height=600");
            if(win) {
                win.document.write(`<body style="margin:0;display:flex;justify-content:center;align-items:center;background:#333;"><img src="${imgUrl}" style="max-width: 100%; max-height: 100vh; box-shadow: 0 0 20px rgba(0,0,0,0.5);"></body>`);
                win.document.title = "Preview Certificate";
            } else {
                alert("Popup ត្រូវបានប្លុក! សូមអនុញ្ញាត popups សម្រាប់វិបសាយនេះ។");
            }
        } catch (e) { 
            console.error(e); 
            alert("Error generating preview: " + (e.message || e)); 
        } 
        finally {
            previewZoom = originalZoom;
            if (originalSrc && previewImageElement) previewImageElement.src = originalSrc;
        }
    }

    function startDrag(e, key) {
        e.preventDefault();
        e.stopPropagation();
        draggingItem = key;
        selectedItem = key;
        startX = e.clientX; startY = e.clientY;
        initialX = editingCourse.cert_config[key].x; initialY = editingCourse.cert_config[key].y;
        window.addEventListener('mousemove', onDrag); window.addEventListener('mouseup', stopDrag);
    }

    function onDrag(e) {
        if (!draggingItem || !previewImageElement) return;
        const scaleX = previewImageElement.naturalWidth / previewImageElement.clientWidth;
        const scaleY = previewImageElement.naturalHeight / previewImageElement.clientHeight;
        
        let newX = Math.round(initialX + (e.clientX - startX) * scaleX);
        let newY = Math.round(initialY + (e.clientY - startY) * scaleY);

        if (showGrid) {
            const w = previewImageElement.naturalWidth;
            const h = previewImageElement.naturalHeight;
            const thresholdX = w * 0.02;
            const thresholdY = h * 0.02;

            if (Math.abs(newX - w / 2) < thresholdX) newX = w / 2;
            else {
                for (let i = 1; i < 10; i++) {
                    const gridX = w * (i / 10);
                    if (Math.abs(newX - gridX) < thresholdX) { newX = gridX; break; }
                }
            }

            if (Math.abs(newY - h / 2) < thresholdY) newY = h / 2;
            else {
                for (let i = 1; i < 10; i++) {
                    const gridY = h * (i / 10);
                    if (Math.abs(newY - gridY) < thresholdY) { newY = gridY; break; }
                }
            }
        }

        editingCourse.cert_config[draggingItem].x = newX;
        editingCourse.cert_config[draggingItem].y = newY;
    }

    function stopDrag() {
        if (draggingItem) saveCertHistory();
        draggingItem = null;
        window.removeEventListener('mousemove', onDrag); window.removeEventListener('mouseup', stopDrag);
    }

    function centerElement(key) {
        if (!previewImageElement || !previewImageElement.naturalWidth) return alert("សូមរង់ចាំរូបភាព Load សិន");
        editingCourse.cert_config[key].x = previewImageElement.naturalWidth / 2;
        if (editingCourse.cert_config[key].align) editingCourse.cert_config[key].align = 'center';
        saveCertHistory();
    }

    async function generateSampleQr() {
        try {
            const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://ccn-cpd.pages.dev';
            const sampleUrl = `${baseUrl}/verify?u=sample&c=sample`;
            
            const qrBase64 = await QRCode.toDataURL(sampleUrl, { 
                margin: 1, 
                width: 300,
                errorCorrectionLevel: 'H' 
            });

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const qrImg = new Image();
            const logoImg = new Image();

            qrImg.src = qrBase64;
            await new Promise(r => qrImg.onload = r);

            canvas.width = qrImg.width;
            canvas.height = qrImg.height;
            ctx.drawImage(qrImg, 0, 0);

            logoImg.src = '/ccn-logo.png';
            await new Promise(resolve => {
                logoImg.onload = () => {
                    const logoSize = canvas.width * 0.22;
                    const center = (canvas.width - logoSize) / 2;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(center - 2, center - 2, logoSize + 4, logoSize + 4);
                    ctx.drawImage(logoImg, center, center, logoSize, logoSize);
                    resolve();
                };
                logoImg.onerror = resolve;
            });

            qrCodeDataUrl = canvas.toDataURL();
        } catch (err) { console.error("QR Gen Error:", err); }
    }

    async function handleUpload(e, field, folder = 'certificates') {
        const file = e.target.files[0];
        if (!file) return;
        
        loading = true;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', folder);

        try {
            const res = await fetch('/api/storage', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            
            editingCourse[field] = data.publicUrl;
            editingCourse = { ...editingCourse };
        } catch (error) {
            alert("Upload failed: " + error.message);
        } finally {
            loading = false;
        }
    }

    function injectCustomFont(fontName, fontUrl) {
        const styleId = `font-${fontName}`;
        let style = document.getElementById(styleId);
        if (!style) {
            style = document.createElement('style');
            style.id = styleId;
            document.head.appendChild(style);
        }
        style.textContent = `
            @font-face {
                font-family: 'CustomFont-${fontName}';
                src: url('${fontUrl}');
            }
        `;
    }

    async function uploadFont(e, type) {
        const file = e.target.files[0];
        if (!file) return;
        
        loading = true;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', 'fonts');

        try {
            const res = await fetch('/api/storage', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            
            if (type === 'name') {
                editingCourse.cert_config.name.customFontUrl = data.publicUrl;
                injectCustomFont('name', data.publicUrl);
            }
            else if (type === 'name_latin') {
                editingCourse.cert_config.name_latin.customFontUrl = data.publicUrl;
                injectCustomFont('name_latin', data.publicUrl);
            }
        } catch (error) { alert("Upload failed: " + error.message); } finally { loading = false; }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="space-y-6">
    <!-- Settings Card -->
    <div class="bg-base-100 p-5 rounded-2xl border border-base-300 shadow-sm">
        <h4 class="font-bold text-lg text-base-content mb-4">⚙️ ការកំណត់លក្ខខណ្ឌ</h4>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control w-full">
                <label class="label font-bold text-gray-700 pb-1">ពិន្ទុជាប់ (Passing Score %)</label>
                <input type="number" bind:value={editingCourse.passing_score} class="input input-bordered w-full bg-base-100 rounded-xl focus:ring-2 focus:ring-primary/20" placeholder="70" min="0" max="100" />
            </div>

            <!-- Post-test Auto Close -->
            <div class="form-control w-full">
                <label class="label font-bold text-gray-700 pb-1">ថ្ងៃបិទ Post-test (Auto Close)</label>
                <input type="datetime-local" bind:value={editingCourse.post_test_auto_close_date} class="input input-bordered w-full bg-base-100 rounded-xl focus:ring-2 focus:ring-primary/20" />
                <label class="label text-xs text-gray-400 pt-1">ទុកទទេ = មិនបិទដោយស្វ័យប្រវត្តិ</label>
            </div>

            <div class="form-control">
                <label class="label font-bold text-gray-700 pb-1">ថ្ងៃបើកលិខិតបញ្ជាក់</label>
                <input type="date" bind:value={editingCourse.start_date} class="input input-bordered w-full bg-base-100 rounded-xl focus:ring-2 focus:ring-primary/20" />
                <label class="label text-xs text-gray-400 pt-1">ទុកទទេ = បើកជានិច្ច</label>
            </div>
            <div class="form-control">
                <label class="label font-bold text-gray-700 pb-1">ថ្ងៃបិទលិខិតបញ្ជាក់</label>
                <input type="date" bind:value={editingCourse.end_date} class="input input-bordered w-full bg-base-100 rounded-xl focus:ring-2 focus:ring-primary/20" />
                <label class="label text-xs text-gray-400 pt-1">ទុកទទេ = មិនកំណត់ថ្ងៃបិទ</label>
            </div>
        </div>
    </div>

    <!-- Template Upload -->
    <div class="bg-base-100 p-5 rounded-2xl border border-base-300 shadow-sm">
        <h4 class="font-bold text-lg text-base-content mb-4">🖼️ រូបភាព Template</h4>
        <div class="form-control">
            <input type="file" accept="image/*" on:change={(e) => handleUpload(e, 'cert_template_url')} class="file-input file-input-bordered w-full bg-base-100 rounded-xl" />
            {#if editingCourse.cert_template_url}
                <div class="mt-4 border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-gray-50">
                    <img src={certTemplateUrl} alt="Template" class="w-full h-48 object-contain" />
                </div>
            {/if}
        </div>
    </div>

    <!-- Preview & Config -->
    <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
        <h4 class="font-bold text-lg text-gray-800 mb-4">👀 កែសម្រួលលិខិតបញ្ជាក់</h4>
        
        <div class="p-4 border border-gray-200 rounded-xl bg-gray-50 relative flex flex-col gap-3">
        {#if editingCourse.cert_template_url}
            <!-- Toolbar -->
            <div class="flex flex-wrap justify-between items-center bg-white p-2 rounded-xl border border-gray-200 shadow-sm z-10 gap-2">
                <div class="flex items-center gap-2">
                    <div class="join">
                        <button class="join-item w-8 h-8 flex items-center justify-center bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-l-md cursor-pointer" style="color: #4b5563;" on:click={zoomOut} title="Zoom Out"><ZoomOutIcon class="w-4 h-4" /></button>
                        <button class="join-item btn btn-sm px-3 font-mono bg-white border-gray-200 text-xs">{Math.round(previewZoom * 100)}%</button>
                        <button class="join-item w-8 h-8 flex items-center justify-center bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-r-md cursor-pointer" style="color: #4b5563;" on:click={zoomIn} title="Zoom In"><ZoomInIcon class="w-4 h-4" /></button>
                    </div>
                    <button class="w-8 h-8 rounded hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none text-gray-500" on:click={resetZoom} title="Reset Zoom"><RotateCcwIcon class="w-4 h-4" /></button>
                    <label class="label cursor-pointer gap-2 ml-2 border-l pl-2">
                        <span class="label-text text-xs font-bold">Grid</span> 
                        <input type="checkbox" bind:checked={showGrid} class="toggle toggle-xs toggle-info" />
                    </label>
                </div>
                <div class="flex gap-1">
                    <button class="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 cursor-pointer border-0 outline-none text-gray-600 disabled:opacity-40" on:click={undoCert} disabled={certHistoryIndex <= 0} title="Undo (Ctrl+Z)"><UndoIcon class="w-4 h-4 mr-1" /> Undo</button>
                    <button class="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 cursor-pointer border-0 outline-none text-gray-600 disabled:opacity-40" on:click={redoCert} disabled={certHistoryIndex >= certHistory.length - 1} title="Redo (Ctrl+Y)"><RedoIcon class="w-4 h-4 mr-1" /> Redo</button>
                </div>
            </div>

            <div class="overflow-auto max-h-[600px] border border-gray-200 rounded-xl bg-gray-200/50 flex justify-center relative p-4 shadow-inner">
            <div bind:this={certificateElement} 
                 class="relative bg-white shadow-md select-none transition-all duration-200 ease-out origin-top"
                 style="width: {previewZoom * 100}%; min-width: {previewZoom * 100}%;"
                 on:mousedown={() => selectedItem = null}>
                <img 
                    src={certTemplateUrl} 
                    alt="Template" 
                    class="w-full h-auto block"
                    bind:this={previewImageElement}
                    crossorigin="anonymous"
                    on:load={() => previewImageElement = previewImageElement}
                />
                
                {#if showGrid}
                    <div class="absolute inset-0 pointer-events-none z-0">
                        <!-- Center Lines -->
                        <div class="absolute top-0 bottom-0 left-1/2 w-0.5 bg-red-500/50 transform -translate-x-1/2"></div>
                        <div class="absolute left-0 right-0 top-1/2 h-0.5 bg-red-500/50 transform -translate-y-1/2"></div>
                        <!-- Grid 10% -->
                        {#each Array(9) as _, i}
                            <div class="absolute top-0 bottom-0 w-px bg-blue-400/20" style="left: {(i + 1) * 10}%"></div>
                            <div class="absolute left-0 right-0 h-px bg-blue-400/20" style="top: {(i + 1) * 10}%"></div>
                        {/each}
                    </div>
                {/if}
                
                {#if previewImageElement && previewImageElement.naturalWidth}
                    <!-- Name -->
                    <div class="absolute cursor-move border {selectedItem === 'name' ? 'border-2 border-blue-600 z-20' : 'border-dashed border-blue-500'} hover:bg-blue-500/10 px-2 whitespace-nowrap"
                        style="left: {(editingCourse.cert_config.name.x / previewImageElement.naturalWidth) * 100}%; top: {(editingCourse.cert_config.name.y / previewImageElement.naturalHeight) * 100}%; transform: translate(-50%, -50%); font-size: {(editingCourse.cert_config.name.fontSize / previewImageElement.naturalWidth) * previewImageElement.clientWidth}px; color: {editingCourse.cert_config.name.color}; font-family: {editingCourse.cert_config.name.font === 'Custom' ? 'CustomFont-name' : editingCourse.cert_config.name.font}, Arial; font-weight: {editingCourse.cert_config.name.fontWeight || 'bold'};"
                        on:mousedown={(e) => startDrag(e, 'name')}>
                        ឈ្មោះ សិស្ស
                    </div>
                    <!-- Latin Name -->
                    <div class="absolute cursor-move border {selectedItem === 'name_latin' ? 'border-2 border-green-600 z-20' : 'border-dashed border-green-500'} hover:bg-green-500/10 px-2 whitespace-nowrap"
                        style="left: {(editingCourse.cert_config.name_latin.x / previewImageElement.naturalWidth) * 100}%; top: {(editingCourse.cert_config.name_latin.y / previewImageElement.naturalHeight) * 100}%; transform: translate(-50%, -50%); font-size: {(editingCourse.cert_config.name_latin.fontSize / previewImageElement.naturalWidth) * previewImageElement.clientWidth}px; color: {editingCourse.cert_config.name_latin.color}; font-family: {editingCourse.cert_config.name_latin.font === 'Custom' ? 'CustomFont-name_latin' : editingCourse.cert_config.name_latin.font}, Arial; font-weight: {editingCourse.cert_config.name_latin.fontWeight || 'bold'};"
                        on:mousedown={(e) => startDrag(e, 'name_latin')}>
                        Student Name
                    </div>
                    {#if editingCourse.cert_config.qr.visible !== false}
                    <!-- QR -->
                    <div class="absolute cursor-move border {selectedItem === 'qr' ? 'border-2 border-purple-600 z-20' : 'border-dashed border-purple-500'} hover:bg-purple-500/10 flex items-center justify-center bg-white/50"
                        style="left: {(editingCourse.cert_config.qr.x / previewImageElement.naturalWidth) * 100}%; top: {(editingCourse.cert_config.qr.y / previewImageElement.naturalHeight) * 100}%; width: {(editingCourse.cert_config.qr.size / previewImageElement.naturalWidth) * 100}%; aspect-ratio: 1/1; transform: translate(-50%, -50%);"
                        on:mousedown={(e) => startDrag(e, 'qr')}>
                        {#if qrCodeDataUrl}
                            <img src={qrCodeDataUrl} alt="QR" class="w-full h-full object-contain pointer-events-none" />
                        {:else}
                            <span class="text-xs font-bold text-purple-700">QR</span>
                        {/if}
                    </div>
                    {/if}
                    {#if editingCourse.cert_config.id.visible !== false}
                    <!-- ID -->
                    <div class="absolute cursor-move border {selectedItem === 'id' ? 'border-2 border-red-600 z-20' : 'border-dashed border-red-500'} hover:bg-red-500/10 px-2 whitespace-nowrap"
                        style="left: {(editingCourse.cert_config.id.x / previewImageElement.naturalWidth) * 100}%; top: {(editingCourse.cert_config.id.y / previewImageElement.naturalHeight) * 100}%; transform: translate(-50%, -50%); font-size: {(editingCourse.cert_config.id.fontSize / previewImageElement.naturalWidth) * previewImageElement.clientWidth}px; color: {editingCourse.cert_config.id.color}; font-family: Arial; font-weight: {editingCourse.cert_config.id.fontWeight || 'bold'};"
                        on:mousedown={(e) => startDrag(e, 'id')}>
                        ID: 123456
                    </div>
                {/if}
                {/if}
            </div>
            </div>
            <div class="flex justify-between items-center text-xs text-gray-500 px-1">
                <span>💡 អូសឈ្មោះដើម្បីប្តូរទីតាំង (Drag to move)</span>
                <button class="btn btn-sm btn-primary text-white shadow-sm rounded-lg" on:click={previewCertificate}><EyeIcon class="w-4 h-4 mr-1" /> Preview ពេញ</button>
            </div>
        {:else}
            <div class="h-64 flex items-center justify-center bg-gray-100 rounded-xl text-gray-400 border border-dashed border-gray-300">សូម Upload រូបភាព Template ជាមុនសិន</div>
        {/if}

        <!-- ប៊ូតុងសម្រាប់ទាញយក -->
        <button on:click={downloadAsJpg} class="btn btn-secondary text-white mt-4 w-full rounded-xl shadow-sm" disabled={isDownloadingJpg}>
            {#if isDownloadingJpg}<span class="loading loading-spinner loading-xs"></span>{:else}<DownloadIcon class="w-5 h-5 mr-1" />{/if}
            🖼️ {isDownloadingJpg ? 'កំពុងទាញយក...' : 'ទាញយកជា JPG'}
        </button>
    </div>
    </div>

    <!-- Configuration Forms -->
    <div class="space-y-3 mt-6">
        <!-- Khmer Name -->
        <div class="collapse collapse-arrow bg-white border border-gray-200 rounded-xl shadow-sm">
            <input type="checkbox" /> 
            <div class="collapse-title text-md font-bold text-gray-700">🅰️ ឈ្មោះខ្មែរ (Khmer Name)</div>
            <div class="collapse-content"> 
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
            <div class="form-control">
                <label class="label text-xs">ទីតាំង X</label>
                <div class="flex gap-1">
                    <input type="number" bind:value={editingCourse.cert_config.name.x} class="input input-sm input-bordered w-full bg-gray-50 rounded-lg" />
                        <button class="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-lg bg-white hover:bg-gray-50 cursor-pointer" style="color: #4b5563;" on:click={() => centerElement('gender')} title="តម្រើមចំកណ្តាល"><TargetIcon class="w-4 h-4" /></button>
                </div>
            </div>
                    <div class="form-control"><label class="label text-xs">ទីតាំង Y</label><input type="number" bind:value={editingCourse.cert_config.name.y} class="input input-sm input-bordered bg-gray-50 rounded-lg" /></div>
                    <div class="form-control"><label class="label text-xs">ទំហំ (Size)</label><input type="number" bind:value={editingCourse.cert_config.name.fontSize} class="input input-sm input-bordered bg-gray-50 rounded-lg" /></div>
                    <div class="form-control"><label class="label text-xs">ពណ៌</label><input type="color" bind:value={editingCourse.cert_config.name.color} class="h-8 w-full rounded-lg cursor-pointer" /></div>
                    <div class="form-control">
                        <label class="label text-xs">កម្រាស់ (Weight)</label>
                        <select bind:value={editingCourse.cert_config.name.fontWeight} class="select select-sm select-bordered w-full bg-gray-50 text-gray-900 rounded-lg">
                            <option value="normal">ធម្មតា</option>
                            <option value="bold">ដិត</option>
                        </select>
                    </div>
                    <div class="form-control">
                        <label class="label text-xs">តម្រឹម (Align)</label>
                        <select bind:value={editingCourse.cert_config.name.align} class="select select-sm select-bordered w-full bg-gray-50 text-gray-900 rounded-lg">
                            <option value="left">ឆ្វេង</option>
                            <option value="center">កណ្តាល</option>
                            <option value="right">ស្តាំ</option>
                        </select>
                    </div>
                    <div class="form-control md:col-span-2">
                        <label class="label text-xs">Font</label>
                        <select bind:value={editingCourse.cert_config.name.font} class="select select-sm select-bordered w-full bg-gray-50 rounded-lg">
                            <option value="Arial">Arial</option>
                            <option value="Nokora">Nokora (Khmer)</option>
                            <option value="Moul">Moul (Khmer)</option>
                            <option value="Custom">Custom (Upload)</option>
                        </select>
                    </div>
                    {#if editingCourse.cert_config.name.font === 'Custom'}
                        <div class="form-control md:col-span-2">
                            <label class="label text-xs">Upload Font</label>
                            <input type="file" accept=".ttf,.woff2" on:change={(e) => uploadFont(e, 'name')} class="file-input file-input-sm file-input-bordered w-full" />
                        </div>
                    {/if}
                </div>
            </div>
        </div>

        <!-- Latin Name -->
        <div class="collapse collapse-arrow bg-white border border-gray-200 rounded-xl shadow-sm">
            <input type="checkbox" /> 
            <div class="collapse-title text-md font-bold text-gray-700">🔠 ឈ្មោះឡាតាំង (Latin Name)</div>
            <div class="collapse-content"> 
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
            <div class="form-control">
                <label class="label text-xs">ទីតាំង X</label>
                <div class="flex gap-1">
                    <input type="number" bind:value={editingCourse.cert_config.name_latin.x} class="input input-sm input-bordered w-full bg-gray-50 rounded-lg" />
                        <button class="w-8 h-8 flex items-center justify-center border border-gray-300 rounded-lg bg-white hover:bg-gray-50 cursor-pointer" style="color: #4b5563;" on:click={() => centerElement('name_latin')} title="តម្រើមចំកណ្តាល"><TargetIcon class="w-4 h-4" /></button>
                </div>
            </div>
                    <div class="form-control"><label class="label text-xs">ទីតាំង Y</label><input type="number" bind:value={editingCourse.cert_config.name_latin.y} class="input input-sm input-bordered bg-gray-50 rounded-lg" /></div>
                    <div class="form-control"><label class="label text-xs">ទំហំ (Size)</label><input type="number" bind:value={editingCourse.cert_config.name_latin.fontSize} class="input input-sm input-bordered bg-gray-50 rounded-lg" /></div>
                    <div class="form-control"><label class="label text-xs">ពណ៌</label><input type="color" bind:value={editingCourse.cert_config.name_latin.color} class="h-8 w-full rounded-lg cursor-pointer" /></div>
                    <div class="form-control">
                        <label class="label text-xs">កម្រាស់ (Weight)</label>
                        <select bind:value={editingCourse.cert_config.name_latin.fontWeight} class="select select-sm select-bordered w-full bg-gray-50 text-gray-900 rounded-lg">
                            <option value="normal">ធម្មតា</option>
                            <option value="bold">ដិត</option>
                        </select>
                    </div>
                    <div class="form-control">
                        <label class="label text-xs">តម្រឹម (Align)</label>
                        <select bind:value={editingCourse.cert_config.name_latin.align} class="select select-sm select-bordered w-full bg-gray-50 text-gray-900 rounded-lg">
                            <option value="left">ឆ្វេង</option>
                            <option value="center">កណ្តាល</option>
                            <option value="right">ស្តាំ</option>
                        </select>
                    </div>
                    <div class="form-control md:col-span-2">
                        <label class="label text-xs">Font</label>
                        <select bind:value={editingCourse.cert_config.name_latin.font} class="select select-sm select-bordered w-full bg-gray-50 rounded-lg">
                            <option value="Arial">Arial</option>
                            <option value="Times New Roman">Times New Roman</option>
                            <option value="Custom">Custom (Upload)</option>
                        </select>
                    </div>
                    {#if editingCourse.cert_config.name_latin.font === 'Custom'}
                        <div class="form-control md:col-span-2">
                            <label class="label text-xs">Upload Font</label>
                            <input type="file" accept=".ttf,.woff2" on:change={(e) => uploadFont(e, 'name_latin')} class="file-input file-input-sm file-input-bordered w-full" />
                        </div>
                    {/if}
                </div>
            </div>
        </div>

        <!-- QR Code -->
        <div class="collapse collapse-arrow bg-white border border-gray-200 rounded-xl shadow-sm">
            <input type="checkbox" /> 
            <div class="collapse-title text-md font-bold text-gray-700 !flex justify-between items-center pr-10">
                <span>📱 QR Code</span>
                <div class="flex items-center gap-2 relative z-[2]" on:click|stopPropagation>
                    <span class="text-xs font-normal text-gray-500">បង្ហាញ</span>
                    <input type="checkbox" class="toggle toggle-sm toggle-primary" checked={editingCourse.cert_config.qr.visible !== false} on:change={(e) => { editingCourse.cert_config.qr.visible = e.target.checked; saveCertHistory(); }} />
                </div>
            </div>
            <div class="collapse-content"> 
                <div class="grid grid-cols-3 gap-3 pt-2">
                    <div class="form-control"><label class="label text-xs">ទីតាំង X</label><input type="number" bind:value={editingCourse.cert_config.qr.x} class="input input-sm input-bordered bg-gray-50 rounded-lg" /></div>
                    <div class="form-control"><label class="label text-xs">ទីតាំង Y</label><input type="number" bind:value={editingCourse.cert_config.qr.y} class="input input-sm input-bordered bg-gray-50 rounded-lg" /></div>
                    <div class="form-control"><label class="label text-xs">ទំហំ (Size)</label><input type="number" bind:value={editingCourse.cert_config.qr.size} class="input input-sm input-bordered bg-gray-50 rounded-lg" /></div>
                </div>
            </div>
        </div>

        <!-- Certificate ID -->
        <div class="collapse collapse-arrow bg-white border border-gray-200 rounded-xl shadow-sm">
            <input type="checkbox" /> 
            <div class="collapse-title text-md font-bold text-gray-700 !flex justify-between items-center pr-10">
                <span>🆔 លេខសម្គាល់ (Certificate ID)</span>
                <div class="flex items-center gap-2 relative z-[2]" on:click|stopPropagation>
                    <span class="text-xs font-normal text-gray-500">បង្ហាញ</span>
                    <input type="checkbox" class="toggle toggle-sm toggle-primary" checked={editingCourse.cert_config.id.visible !== false} on:change={(e) => { editingCourse.cert_config.id.visible = e.target.checked; saveCertHistory(); }} />
                </div>
            </div>
            <div class="collapse-content"> 
                <div class="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2">
                    <div class="form-control"><label class="label text-xs">ទីតាំង X</label><input type="number" bind:value={editingCourse.cert_config.id.x} class="input input-sm input-bordered bg-gray-50 rounded-lg" /></div>
                    <div class="form-control"><label class="label text-xs">ទីតាំង Y</label><input type="number" bind:value={editingCourse.cert_config.id.y} class="input input-sm input-bordered bg-gray-50 rounded-lg" /></div>
                    <div class="form-control"><label class="label text-xs">ទំហំ (Size)</label><input type="number" bind:value={editingCourse.cert_config.id.fontSize} class="input input-sm input-bordered bg-gray-50 rounded-lg" /></div>
                    <div class="form-control"><label class="label text-xs">ពណ៌</label><input type="color" bind:value={editingCourse.cert_config.id.color} class="h-8 w-full rounded-lg cursor-pointer" /></div>
                    <div class="form-control">
                        <label class="label text-xs">កម្រាស់ (Weight)</label>
                        <select bind:value={editingCourse.cert_config.id.fontWeight} class="select select-sm select-bordered w-full bg-gray-50 text-gray-900 rounded-lg">
                            <option value="normal">ធម្មតា</option>
                            <option value="bold">ដិត</option>
                        </select>
                    </div>
                    <div class="form-control">
                        <label class="label text-xs">តម្រឹម (Align)</label>
                        <select bind:value={editingCourse.cert_config.id.align} class="select select-sm select-bordered w-full bg-gray-50 text-gray-900 rounded-lg">
                            <option value="left">ឆ្វេង</option>
                            <option value="center">កណ្តាល</option>
                            <option value="right">ស្តាំ</option>
                        </select>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>