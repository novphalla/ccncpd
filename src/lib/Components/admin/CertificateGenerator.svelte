<script>
    import { onMount } from 'svelte';
    
    export let onClose;

    let excelData = [];
    let columns = [];
    let mapping = { name: '', name_latin: '', course: '', date: '' };
    let templateImage = null;
    let canvas;
    let ctx;
    let previewIndex = 0;
    let processing = false;
    let progress = 0;
    
    // Config for text positioning
    let config = {
        name: { x: 500, y: 300, size: 40, color: '#000000', font: 'Moul', align: 'center' },
        name_latin: { x: 500, y: 350, size: 30, color: '#000000', font: 'Arial', align: 'center' },
        course: { x: 500, y: 400, size: 30, color: '#000000', align: 'center' },
        date: { x: 500, y: 500, size: 20, color: '#000000', align: 'center' },
        qr: { x: 100, y: 100, size: 100, show: false }
    };
    let qrPreviewImg = null;

    // Drag & Drop State
    let isDragging = false;
    let dragTarget = null;
    let dragStart = { x: 0, y: 0 };

    const availableFonts = ['Arial', 'Times New Roman', 'Courier New', 'Siemreap', 'Nokora', 'Moul', 'Battambang', 'Dangrek'];

    onMount(async () => {
        // Load XLSX library from CDN
        if (typeof window !== 'undefined' && !window.XLSX) {
            const script = document.createElement('script');
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
            document.head.appendChild(script);
        }
        // Load JSZip from CDN
        if (typeof window !== 'undefined' && !window.JSZip) {
            const script = document.createElement('script');
            script.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
            document.head.appendChild(script);
        }
        try {
            const QRCode = await import('qrcode');
            const qrUrl = await QRCode.toDataURL("https://ccn-cpd.pages.dev", { width: 300, margin: 1 });
            const img = new Image();
            img.onload = () => qrPreviewImg = img;
            img.src = qrUrl;
        } catch(e) { console.error("Error loading qrcode", e); }
    });

    function downloadTemplate() {
        const data = [
            { "Name (Khmer)": "សុខ សាន្ត", "Name (Latin)": "Sok San", "Course": "General English", "Date": "2023-12-31" },
            { "Name (Khmer)": "ចាន់ ធារ៉ា", "Name (Latin)": "Chan Thary", "Course": "Computer Science", "Date": "2023-12-31" }
        ];
        const ws = window.XLSX.utils.json_to_sheet(data);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, "Template");
        window.XLSX.writeFile(wb, "Certificate_Template.xlsx");
    }

    function handleFile(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (evt) => {
            const bstr = evt.target.result;
            const wb = window.XLSX.read(bstr, { type: 'binary' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = window.XLSX.utils.sheet_to_json(ws, { header: 1 });
            
            if (data.length > 0) {
                columns = data[0];
                excelData = data.slice(1).map(row => {
                    let obj = {};
                    columns.forEach((col, i) => obj[col] = row[i]);
                    return obj;
                });
                // Auto-guess mapping
                mapping.name = columns.find(c => c.toLowerCase().includes('name') || c.includes('ឈ្មោះ')) || '';
                mapping.name_latin = columns.find(c => c.toLowerCase().includes('latin') || c.includes('ឡាតាំង')) || '';
                mapping.course = columns.find(c => c.toLowerCase().includes('course') || c.includes('វគ្គ')) || '';
                mapping.date = columns.find(c => c.toLowerCase().includes('date') || c.includes('កាលបរិច្ឆេទ')) || '';
            }
        };
        reader.readAsBinaryString(file);
    }

    function handleTemplate(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            const img = new Image();
            img.onload = () => {
                templateImage = img;
                // Set default center
                config.name.x = img.width / 2;
                config.name.y = img.height / 2;
                config.name_latin.x = img.width / 2;
                config.name_latin.y = (img.height / 2) + 50;
                config.course.x = img.width / 2;
                config.course.y = (img.height / 2) + 150;
                config.date.x = img.width / 2;
                config.date.y = (img.height / 2) + 250;
                drawPreview();
            };
            img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
    }

    function drawPreview() {
        if (!canvas || !templateImage) return;
        canvas.width = templateImage.width;
        canvas.height = templateImage.height;
        ctx = canvas.getContext('2d');
        
        const data = excelData[previewIndex] || {};
        
        ctx.drawImage(templateImage, 0, 0);
        
        // Draw Name
        if (mapping.name) {
            ctx.font = `bold ${config.name.size}px "${config.name.font}"`;
            ctx.fillStyle = config.name.color;
            ctx.textAlign = config.name.align || 'center';
            ctx.fillText(data[mapping.name] || 'ឈ្មោះសិស្ស', config.name.x, config.name.y);
        }

        // Draw Name Latin
        if (mapping.name_latin) {
            ctx.font = `bold ${config.name_latin.size}px "${config.name_latin.font}"`;
            ctx.fillStyle = config.name_latin.color;
            ctx.textAlign = config.name_latin.align || 'center';
            ctx.fillText(data[mapping.name_latin] || 'Latin Name', config.name_latin.x, config.name_latin.y);
        }

        // Draw Course
        if (mapping.course) {
            ctx.font = `bold ${config.course.size}px Arial`;
            ctx.fillStyle = config.course.color;
            ctx.textAlign = config.course.align || 'center';
            ctx.fillText(data[mapping.course] || 'វគ្គសិក្សា', config.course.x, config.course.y);
        }
        
        // Draw Date
        if (mapping.date) {
            ctx.font = `${config.date.size}px Arial`;
            ctx.fillStyle = config.date.color;
            ctx.textAlign = config.date.align || 'center';
            ctx.fillText(data[mapping.date] || 'DD/MM/YYYY', config.date.x, config.date.y);
        }

        // Draw QR Code
        if (config.qr.show && qrPreviewImg) {
            ctx.drawImage(qrPreviewImg, config.qr.x, config.qr.y, config.qr.size, config.qr.size);
        }
    }

    function getCanvasCoordinates(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    function getPlaceholder(key) {
        if (key === 'name') return 'ឈ្មោះសិស្ស';
        if (key === 'name_latin') return 'Latin Name';
        if (key === 'course') return 'វគ្គសិក្សា';
        if (key === 'date') return 'DD/MM/YYYY';
        return '';
    }

    function isHit(key, mouseX, mouseY) {
        const conf = config[key];
        
        if (key === 'qr') {
            if (!conf.show) return false;
            return mouseX >= conf.x && mouseX <= conf.x + conf.size &&
                   mouseY >= conf.y && mouseY <= conf.y + conf.size;
        }

        if (!mapping[key]) return false;
        const text = (excelData[previewIndex] && excelData[previewIndex][mapping[key]]) || getPlaceholder(key);
        
        if (key === 'date') ctx.font = `${conf.size}px Arial`;
        else if (key === 'course') ctx.font = `bold ${conf.size}px Arial`;
        else ctx.font = `bold ${conf.size}px "${conf.font || 'Arial'}"`;

        const metrics = ctx.measureText(text);
        const width = metrics.width;
        const height = conf.size;
        const align = conf.align || 'center';

        let left = conf.x;
        if (align === 'center') left = conf.x - width / 2;
        else if (align === 'right') left = conf.x - width;
        
        return mouseX >= left && mouseX <= left + width &&
               mouseY >= conf.y - height && mouseY <= conf.y + height * 0.3;
    }

    function handleMouseDown(e) {
        if (!templateImage) return;
        const { x, y } = getCanvasCoordinates(e);
        const keys = ['qr', 'date', 'course', 'name_latin', 'name'];
        for (const key of keys) {
            if (isHit(key, x, y)) {
                isDragging = true;
                dragTarget = key;
                dragStart = { x, y };
                return;
            }
        }
    }

    function handleMouseMove(e) {
        if (!templateImage) return;
        const { x, y } = getCanvasCoordinates(e);

        if (isDragging && dragTarget) {
            const dx = x - dragStart.x;
            const dy = y - dragStart.y;
            config[dragTarget].x += dx;
            config[dragTarget].y += dy;
            config = config; // Trigger reactivity
            dragStart = { x, y };
            drawPreview();
            return;
        }

        let cursor = 'default';
        const keys = ['qr', 'date', 'course', 'name_latin', 'name'];
        for (const key of keys) {
            if (isHit(key, x, y)) {
                cursor = 'move';
                break;
            }
        }
        canvas.style.cursor = cursor;
    }

    function handleMouseUp() {
        isDragging = false;
        dragTarget = null;
    }

    async function generateSingleCertificateCanvas(studentData, qrCodeInstance) {
        // Create a new canvas in memory, don't use the one in the DOM
        const offscreenCanvas = document.createElement('canvas');
        const offscreenCtx = offscreenCanvas.getContext('2d');
        
        offscreenCanvas.width = templateImage.width;
        offscreenCanvas.height = templateImage.height;
        
        offscreenCtx.drawImage(templateImage, 0, 0);

        // Draw Name
        if (mapping.name) {
            offscreenCtx.font = `bold ${config.name.size}px "${config.name.font}"`;
            offscreenCtx.fillStyle = config.name.color;
            offscreenCtx.textAlign = config.name.align || 'center';
            offscreenCtx.fillText(studentData[mapping.name] || 'ឈ្មោះសិស្ស', config.name.x, config.name.y);
        }

        // Draw Name Latin
        if (mapping.name_latin) {
            offscreenCtx.font = `bold ${config.name_latin.size}px "${config.name_latin.font}"`;
            offscreenCtx.fillStyle = config.name_latin.color;
            offscreenCtx.textAlign = config.name_latin.align || 'center';
            offscreenCtx.fillText(studentData[mapping.name_latin] || 'Latin Name', config.name_latin.x, config.name_latin.y);
        }

        // Draw Course
        if (mapping.course) {
            offscreenCtx.font = `bold ${config.course.size}px Arial`;
            offscreenCtx.fillStyle = config.course.color;
            offscreenCtx.textAlign = config.course.align || 'center';
            offscreenCtx.fillText(studentData[mapping.course] || 'វគ្គសិក្សា', config.course.x, config.course.y);
        }
        
        // Draw Date
        if (mapping.date) {
            offscreenCtx.font = `${config.date.size}px Arial`;
            offscreenCtx.fillStyle = config.date.color;
            offscreenCtx.textAlign = config.date.align || 'center';
            offscreenCtx.fillText(studentData[mapping.date] || 'DD/MM/YYYY', config.date.x, config.date.y);
        }

        // Draw QR Code
        if (config.qr.show && qrCodeInstance) {
            const studentName = studentData[mapping.name] || studentData[mapping.name_latin] || `Student`;
            const courseName = studentData[mapping.course] || `Course`;
            const qrText = `Verify:\nName: ${studentName}\nCourse: ${courseName}`;
            const qrUrl = await qrCodeInstance.toDataURL(qrText, { width: 300, margin: 1 });
            const img = new Image();
            await new Promise(r => { img.onload = r; img.src = qrUrl; });
            offscreenCtx.drawImage(img, config.qr.x, config.qr.y, config.qr.size, config.qr.size);
        }

        return offscreenCanvas;
    }

    async function generateAll() {
        if (!excelData.length || !templateImage) return;
        processing = true;
        progress = 0;
        
        // Use dynamic import for jsPDF
        const { jsPDF } = await import('jspdf');
        const BATCH_SIZE = 100; // បែងចែកជាកញ្ចប់ ម្ដង ១០០ នាក់
        const totalBatches = Math.ceil(excelData.length / BATCH_SIZE);

        let QRCode;
        if (config.qr.show) {
            QRCode = await import('qrcode');
        }
        
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const batchZip = new window.JSZip();
            const start = batchIndex * BATCH_SIZE;
            const end = Math.min(start + BATCH_SIZE, excelData.length);
            const currentBatchData = excelData.slice(start, end);

            if (totalBatches > 1) {
                alert(`កំពុងចាប់ផ្តើមកញ្ចប់ទី ${batchIndex + 1} នៃ ${totalBatches}។ សូមរង់ចាំរហូតដល់ការទាញយកចាប់ផ្តើម។`);
            }

            for (let i = 0; i < currentBatchData.length; i++) {
                const studentData = currentBatchData[i];
                const overallIndex = start + i;
                
                progress = Math.round(((overallIndex + 1) / excelData.length) * 100);

                // Generate certificate on an offscreen canvas
                const certCanvas = await generateSingleCertificateCanvas(studentData, QRCode);
                
                const imgData = certCanvas.toDataURL('image/jpeg', 0.8);
                const pdf = new jsPDF(templateImage.width > templateImage.height ? 'l' : 'p', 'px', [templateImage.width, templateImage.height]);
                pdf.addImage(imgData, 'JPEG', 0, 0, templateImage.width, templateImage.height);
                
                const name = studentData[mapping.name] || `Certificate_${overallIndex}`;
                batchZip.file(`${name}.pdf`, pdf.output('blob'));
                
                // Yield to UI to prevent freezing
                await new Promise(r => setTimeout(r, 50)); 
            }
            
            // Generate and download the zip for the current batch
            const content = await batchZip.generateAsync({ type: "blob" });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `Certificates_Batch_${batchIndex + 1}_of_${totalBatches}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            // Wait a bit before starting the next batch to allow download to start
            if (batchIndex < totalBatches - 1) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        
        processing = false;
        alert('បានបង្កើត និងទាញយកសញ្ញាបត្រទាំងអស់ជាកញ្ចប់ដោយជោគជ័យ!');
    }
</script>

<div class="card bg-base-100 p-5 shadow-md border border-base-300">
    <!-- Header -->
    <div class="flex justify-between items-center mb-4 pb-2 border-b border-base-200">
        <h3 class="font-bold text-xl text-gray-800">🎓 បង្កើតសញ្ញាបត្រជាក្រុម (Excel Import)</h3>
        <button class="btn btn-sm btn-ghost btn-circle" on:click={onClose} title="បិទ">✕</button>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Left Panel: Controls -->
        <div class="space-y-4 max-h-[calc(100vh-12rem)] overflow-y-auto pr-2 pb-2">
            
            <!-- Step 1 -->
            <div class="bg-base-200/50 p-3 border border-base-300 rounded-xl">
                <div class="flex justify-between items-center mb-3">
                    <h4 class="font-bold text-sm text-gray-700">1. ឯកសារ Excel</h4>
                    <button class="btn btn-xs btn-outline btn-success bg-white shadow-sm" on:click={downloadTemplate}>⬇️ ទាញយកគំរូ</button>
                </div>
                <input type="file" accept=".xlsx, .xls, .csv" on:change={handleFile} class="file-input file-input-sm file-input-bordered w-full bg-white text-gray-800" />
                {#if excelData.length}
                    <div class="text-xs text-success font-bold mt-2">✅ រកឃើញទិន្នន័យ {excelData.length} នាក់</div>
                {/if}
            </div>

            <!-- Step 2 -->
            <div class="bg-base-200/50 p-3 border border-base-300 rounded-xl">
                <h4 class="font-bold text-sm text-gray-700 mb-3">2. ជ្រើសរើស Template (រូបភាព)</h4>
                <input type="file" accept="image/*" on:change={handleTemplate} class="file-input file-input-sm file-input-bordered w-full bg-white text-gray-800" />
            </div>

            <!-- Step 3 -->
            {#if columns.length}
                <div class="bg-base-200/50 p-3 border border-base-300 rounded-xl">
                    <h4 class="font-bold text-sm text-gray-700 mb-3">3. ភ្ជាប់ទិន្នន័យ (Mapping)</h4>
                    <div class="grid grid-cols-2 gap-2">
                        <div class="form-control">
                            <label class="label py-1" for="mapping-name"><span class="label-text text-xs font-bold text-gray-600">ឈ្មោះ (ខ្មែរ)</span></label>
                            <select id="mapping-name" bind:value={mapping.name} class="select select-sm select-bordered bg-white" on:change={drawPreview}>
                                <option value="">ជ្រើសរើស...</option>
                                {#each columns as col}<option value={col}>{col}</option>{/each}
                            </select>
                        </div>
                        <div class="form-control">
                            <label class="label py-1" for="mapping-name-latin"><span class="label-text text-xs font-bold text-gray-600">ឈ្មោះ (ឡាតាំង)</span></label>
                            <select id="mapping-name-latin" bind:value={mapping.name_latin} class="select select-sm select-bordered bg-white" on:change={drawPreview}>
                                <option value="">ជ្រើសរើស...</option>
                                {#each columns as col}<option value={col}>{col}</option>{/each}
                            </select>
                        </div>
                        <div class="form-control">
                            <label class="label py-1" for="mapping-course"><span class="label-text text-xs font-bold text-gray-600">វគ្គសិក្សា</span></label>
                            <select id="mapping-course" bind:value={mapping.course} class="select select-sm select-bordered bg-white" on:change={drawPreview}>
                                <option value="">ជ្រើសរើស...</option>
                                {#each columns as col}<option value={col}>{col}</option>{/each}
                            </select>
                        </div>
                        <div class="form-control">
                            <label class="label py-1" for="mapping-date"><span class="label-text text-xs font-bold text-gray-600">កាលបរិច្ឆេទ</span></label>
                            <select id="mapping-date" bind:value={mapping.date} class="select select-sm select-bordered bg-white" on:change={drawPreview}>
                            <option value="">ជ្រើសរើស...</option>
                            {#each columns as col}<option value={col}>{col}</option>{/each}
                        </select>
                    </div>
                    </div>
                </div>
            {/if}
            
            <!-- Step 4 -->
            {#if templateImage}
                <div class="bg-base-200/50 p-3 border border-base-300 rounded-xl">
                    <h4 class="font-bold text-sm text-gray-700 mb-2">4. កំណត់ទីតាំង <span class="text-xs font-normal text-gray-500">(អូសលើរូបបាន)</span></h4>
                    <div class="space-y-3">
                        
                        {#each [
                            {key: 'name', label: 'ឈ្មោះ (ខ្មែរ)', hasFont: true}, 
                            {key: 'name_latin', label: 'ឈ្មោះ (ឡាតាំង)', hasFont: true}, 
                            {key: 'course', label: 'វគ្គសិក្សា', hasFont: false}, 
                            {key: 'date', label: 'កាលបរិច្ឆេទ', hasFont: false}
                        ] as field}
                            <div class="bg-white p-2 rounded-lg border border-gray-200 shadow-sm">
                                <div class="text-xs font-bold text-gray-700 mb-1">{field.label}</div>
                                <div class="grid grid-cols-4 gap-1 mb-1">
                                    <input type="number" bind:value={config[field.key].x} class="input input-xs input-bordered" placeholder="X" on:input={drawPreview} title="ទីតាំង X">
                                    <input type="number" bind:value={config[field.key].y} class="input input-xs input-bordered" placeholder="Y" on:input={drawPreview} title="ទីតាំង Y">
                                    <input type="number" bind:value={config[field.key].size} class="input input-xs input-bordered" placeholder="Size" on:input={drawPreview} title="ទំហំអក្សរ">
                                    <input type="color" bind:value={config[field.key].color} class="input input-xs border-0 p-0 w-full h-full cursor-pointer rounded bg-transparent" on:input={drawPreview} title="ពណ៌">
                                </div>
                                <div class="grid {field.hasFont ? 'grid-cols-2' : 'grid-cols-1'} gap-1">
                                    {#if field.hasFont}
                                        <select bind:value={config[field.key].font} class="select select-xs select-bordered bg-white" on:change={drawPreview}>
                                            {#each availableFonts as font}<option value={font}>{font}</option>{/each}
                                        </select>
                                    {/if}
                                    <select bind:value={config[field.key].align} class="select select-xs select-bordered bg-white" on:change={drawPreview}>
                                        <option value="left">តម្រឹមឆ្វេង</option>
                                        <option value="center">តម្រឹមកណ្តាល</option>
                                        <option value="right">តម្រឹមស្តាំ</option>
                                    </select>
                                </div>
                            </div>
                        {/each}
                        
                        <div class="bg-white p-2 rounded-lg border border-gray-200 shadow-sm mt-2">
                            <div class="flex justify-between items-center mb-1">
                                <div class="text-xs font-bold text-gray-700">QR Code (ផ្ទៀងផ្ទាត់)</div>
                                <input type="checkbox" class="toggle toggle-xs toggle-primary" bind:checked={config.qr.show} on:change={drawPreview}>
                            </div>
                            {#if config.qr.show}
                            <div class="grid grid-cols-3 gap-1 mt-2">
                                <input type="number" bind:value={config.qr.x} class="input input-xs input-bordered" placeholder="X" on:input={drawPreview} title="ទីតាំង X">
                                <input type="number" bind:value={config.qr.y} class="input input-xs input-bordered" placeholder="Y" on:input={drawPreview} title="ទីតាំង Y">
                                <input type="number" bind:value={config.qr.size} class="input input-xs input-bordered" placeholder="Size" on:input={drawPreview} title="ទំហំ">
                            </div>
                            {/if}
                        </div>

                    </div>
                </div>
            {/if}
            
            <button class="btn btn-primary w-full shadow-md" disabled={!excelData.length || !templateImage || processing} on:click={generateAll}>
                {#if processing}
                    <span class="loading loading-spinner"></span> កំពុងបង្កើត {progress}%
                {:else}
                    📦 ទាញយកទាំងអស់ (ZIP)
                {/if}
            </button>
        </div>

        <!-- Right Panel: Preview -->
        <div class="col-span-1 lg:col-span-2 bg-base-200/50 rounded-xl p-4 flex items-center justify-center overflow-auto border border-base-300 relative shadow-inner min-h-[400px]">
            {#if !templateImage}
                <div class="text-center text-gray-400">
                    <div class="text-5xl mb-2 opacity-50">🖼️</div>
                    <p>សូមជ្រើសរើស Template ជាមុនសិន</p>
                </div>
            {/if}
            <canvas bind:this={canvas} class="max-w-full shadow-lg"
                on:mousedown={handleMouseDown}
                on:mousemove={handleMouseMove}
                on:mouseup={handleMouseUp}
                on:mouseleave={handleMouseUp}
            ></canvas>
        </div>
    </div>
</div>