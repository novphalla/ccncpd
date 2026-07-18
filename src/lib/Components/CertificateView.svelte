<script>
    import { createEventDispatcher, onMount, tick } from 'svelte';
    import { PUBLIC_R2_PUBLIC_URL } from '$env/static/public';
    import { normalizeAssetProxyUrl } from '$lib/utils.js';
    export let course;
    export let currentUser;
    export let t;

    const dispatch = createEventDispatcher();
    let canvasElement;
    let isGeneratingCert = true;

    onMount(() => {
        generateCertificate();
    });

    async function generateCertificate() {
        if (!course) return;
        isGeneratingCert = true;
        await tick();
        const ctx = canvasElement.getContext('2d');
        const BASE_WIDTH = 800;
        const scale = canvasElement.width / BASE_WIDTH;
        
        const config = course.cert_config || { name: { x: 400, y: 320, color: '#1e3a8a', font: 'Nokora', fontSize: 40 }, date: { x: 400, y: 440, color: '#555555', font: 'Nokora', fontSize: 20 } };
        
        if (config.customFontUrl) {
            try {
                const fontName = `CourseFont_${course.id}`;
                const customFontUrl = normalizeAssetProxyUrl(config.customFontUrl, PUBLIC_R2_PUBLIC_URL);
                const fontFace = new FontFace(fontName, `url(${customFontUrl})`);
                await fontFace.load();
                document.fonts.add(fontFace);
            } catch(e) { console.error("Font load error", e); }
        }

        const getNameFont = () => config.name.font === 'Custom' && config.customFontUrl ? `CourseFont_${course.id}` : (config.name.font || 'Nokora');

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = course.cert_template_url
            ? normalizeAssetProxyUrl(course.cert_template_url, PUBLIC_R2_PUBLIC_URL)
            : "https://img.freepik.com/free-vector/elegant-certificate-template_23-2147940545.jpg";
        
        img.onload = async () => {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvasElement.width, canvasElement.height);
            ctx.drawImage(img, 0, 0, canvasElement.width, canvasElement.height);
            
            ctx.font = `bold ${(config.name.fontSize || 40) * scale}px '${getNameFont()}'`; ctx.fillStyle = config.name.color || "#1e3a8a"; ctx.textAlign = "center";
            ctx.fillText(currentUser.full_name, config.name.x * scale, config.name.y * scale);
            
            try {
                const QRCode = await import('qrcode');
                const qrUrl = await QRCode.toDataURL(`Verify: ${currentUser.phone_number} - ${course.title}`);
                const qrImg = new Image();
                qrImg.src = qrUrl;
                qrImg.onload = () => ctx.drawImage(qrImg, 650 * scale, 450 * scale, 100 * scale, 100 * scale);
            } catch(e) { console.error(e); }
            isGeneratingCert = false;
        };
        img.onerror = () => {
            alert("មានបញ្ហាក្នុងការផ្ទុកគំរូវិញ្ញាបនបត្រ");
            isGeneratingCert = false;
        };
    }

    function downloadCert() {
        const link = document.createElement('a');
        link.download = `Cert-${currentUser.full_name}.png`;
        link.href = canvasElement.toDataURL();
        link.click();
    }

    async function downloadCertPDF() {
        const { jsPDF } = await import('jspdf');
        const imgData = canvasElement.toDataURL('image/png');
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        pdf.addImage(imgData, 'PNG', 0, 0, 297, 210);
        pdf.save(`Cert-${currentUser.full_name}.pdf`);
    }

    async function sendToTelegram() {
        isGeneratingCert = true;
        try {
            const canvas = canvasElement;
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            const file = new File([blob], `Certificate-${currentUser.full_name}.png`, { type: 'image/png' });

            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: 'Certificate',
                    text: `វិញ្ញាបនបត្របញ្ជាក់ការសិក្សារបស់ ${currentUser.full_name}`
                });
            } else {
                const link = document.createElement('a');
                link.download = `Certificate-${currentUser.full_name}.png`;
                link.href = URL.createObjectURL(blob);
                link.click();
                alert("ឧបករណ៍របស់អ្នកមិនគាំទ្រការចែករំលែកដោយផ្ទាល់ទេ។ រូបភាពត្រូវបានទាញយក។");
            }
        } catch (e) {
            if (e.name !== 'AbortError') alert("មានបញ្ហាក្នុងការចែករំលែក: " + e.message);
        } finally {
            isGeneratingCert = false;
        }
    }
</script>

<div class="screen p-4 min-h-screen bg-white flex flex-col items-center justify-center">
    {#if isGeneratingCert}
        <div class="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-50"><span class="loading loading-spinner loading-lg text-primary"></span></div>
    {/if}
    <h2 class="text-xl font-bold mb-4 text-primary">វិញ្ញាបនបត្រ</h2>
    <canvas bind:this={canvasElement} width="3508" height="2480" class="w-full max-w-lg rounded shadow-lg mb-6"></canvas>
    <div class="flex gap-2 w-full max-w-xs">
        <button on:click={downloadCert} class="btn btn-success flex-1 text-black">{t('download_png')}</button>
        <button on:click={downloadCertPDF} class="btn btn-error flex-1 text-black">PDF</button>
        <button on:click={sendToTelegram} class="btn btn-info flex-1 text-black">{t('send_telegram')}</button>
    </div>
    <button on:click={() => dispatch('close')} class="btn btn-ghost mt-4">ត្រឡប់ទៅដើម</button>
</div>
