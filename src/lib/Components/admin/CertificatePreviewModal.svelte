<script>
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';

    export let show = false;
    export let previewCertificateUrl = '';
    export let activeCertificateCourse = null;

    const dispatch = createEventDispatcher();

    function close() { show = false; dispatch('close'); }

    async function downloadCertificate() {
        if (!previewCertificateUrl || !activeCertificateCourse) return;
        try {
            const { jsPDF } = await import('jspdf');
            const img = new Image();
            img.src = previewCertificateUrl;
            await new Promise(r => img.onload = r);
            
            const orientation = img.width > img.height ? 'l' : 'p';
            const pdf = new jsPDF(orientation, 'mm', 'a4');
            const width = pdf.internal.pageSize.getWidth();
            const height = pdf.internal.pageSize.getHeight();
            const imgRatio = img.width / img.height;
            const pageRatio = width / height;
            let finalWidth = width;
            let finalHeight = height;

            if (imgRatio > pageRatio) finalHeight = width / imgRatio;
            else finalWidth = height * imgRatio;
            const x = (width - finalWidth) / 2;
            const y = (height - finalHeight) / 2;
            
            pdf.addImage(previewCertificateUrl, 'JPEG', x, y, finalWidth, finalHeight);
            pdf.save(`Certificate-${activeCertificateCourse.title}.pdf`);
        } catch (e) {
            console.error("PDF generation failed, falling back to JPG", e);
            downloadCertificateImage();
        }
    }

    function downloadCertificateImage() {
        if (!previewCertificateUrl || !activeCertificateCourse) return;
        const link = document.createElement('a');
        link.download = `Certificate-${activeCertificateCourse.title}.jpg`;
        link.href = previewCertificateUrl;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    }

    async function shareCertificateImage() {
        if (!previewCertificateUrl || !activeCertificateCourse) return;
        try {
            const blob = await (await fetch(previewCertificateUrl)).blob();
            const file = new File([blob], `Certificate-${activeCertificateCourse.title}.jpg`, { type: 'image/jpeg' });
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: 'លិខិតបញ្ជាក់ការសិក្សារបស់ខ្ញុំ', text: `ខ្ញុំបានបញ្ចប់វគ្គសិក្សា "${activeCertificateCourse.title}" ជោគជ័យ!` });
            } else {
                alert("ឧបករណ៍របស់អ្នកមិនគាំទ្រការចែករំលែករូបភាពផ្ទាល់ទេ។ សូមទាញយកជាមុនសិន។");
            }
        } catch (e) { console.error(e); alert("Error sharing: " + e.message); }
    }
</script>

{#if show}
    <div class="modal modal-open bg-black/60" transition:fade={{ duration: 200 }}>
        <div class="modal-box bg-white w-11/12 max-w-4xl text-center">
            <h3 class="font-bold text-lg mb-4 text-gray-900">ពិនិត្យលិខិតបញ្ជាក់ការសិក្សា (Preview)</h3>
            <div class="flex justify-center mb-6 bg-base-200 rounded-lg p-2 border">
                <img src={previewCertificateUrl} alt="Certificate Preview" class="max-w-full h-auto shadow-lg" />
            </div>
            <div class="flex flex-col sm:flex-row gap-3 justify-center">
                <button class="btn btn-primary flex-1 text-white" on:click={downloadCertificate}>⬇️ ទាញយកជា(PDF)</button>
                <button class="btn btn-secondary flex-1 text-white" on:click={downloadCertificateImage}>⬇️ ទាញយកជារូបភាព</button>
                <button class="btn btn-info text-white flex-1" on:click={shareCertificateImage}>📢 ចែករំលែក</button>
                <button class="btn btn-ghost" on:click={close}>បិទ</button>
            </div>
        </div>
    </div>
{/if}