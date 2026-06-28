<script>
    import { createEventDispatcher, onMount, tick } from 'svelte';
    import { fade } from 'svelte/transition';
    import { drawCertificate } from '$lib/certificate.js';
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
        
        try {
            const certId = `ID: ${Date.now().toString().slice(-9)}`; // ឬទាញយក ID ពិតបើមាន
            const dateStr = new Date().toLocaleDateString('km-KH');
            const qrData = `${window.location.origin}/verify?u=${currentUser.id}&c=${course.id}`;
            const logoUrl = '/ccn-logo.png'; // អាចប្តូរតាម Logo របស់អ្នក

            await drawCertificate(canvasElement, course, currentUser, certId, dateStr, qrData, logoUrl);
            isGeneratingCert = false;
        } catch (e) {
            console.error(e);
            alert("មានបញ្ហាក្នុងការបង្កើតសញ្ញាបត្រ: " + e.message);
            isGeneratingCert = false;
        }
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
        <div transition:fade={{ duration: 300 }} class="fixed inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center z-50">
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <span class="mt-4 text-primary font-bold">កំពុងបង្កើតសញ្ញាបត្រ...</span>
        </div>
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