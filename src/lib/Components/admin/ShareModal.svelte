<script>
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';

    export let show = false;
    export let loginLogoUrl = '';
    export let shareUrl = '';
    export let shareTitle = 'ស្កេនដើម្បីចូល';
    export let shareText = 'ចូលរៀនវគ្គបណ្តុះបណ្តាលតាមរយៈកម្មវិធីនេះ!';

    const dispatch = createEventDispatcher();
    let shareQrCodeUrl = '';
    let isGenerating = false;
    let lastUrl = null;

    $: targetUrl = shareUrl || (typeof window !== 'undefined' ? window.location.origin : '');

    $: if (show && targetUrl !== lastUrl && !isGenerating) {
        lastUrl = targetUrl;
        generateQrCode();
    }

    async function generateQrCode() {
        if (typeof window === 'undefined') return;
        isGenerating = true;
        try {
            const QRCode = await import('qrcode');
            const qrUrl = await QRCode.toDataURL(targetUrl, { width: 300, margin: 2, errorCorrectionLevel: 'H' });
            
            const effectiveLogoUrl = loginLogoUrl || '/logo.png';
            if (effectiveLogoUrl) {
                const canvas = document.createElement('canvas');
                canvas.width = 300;
                canvas.height = 300;
                const ctx = canvas.getContext('2d');

                const qrImg = new Image();
                qrImg.src = qrUrl;
                await new Promise(r => qrImg.onload = r);
                ctx.drawImage(qrImg, 0, 0);

                const logoImg = new Image();
                logoImg.crossOrigin = "anonymous";
                logoImg.src = effectiveLogoUrl;
                
                await new Promise(resolve => {
                    logoImg.onload = resolve;
                    logoImg.onerror = resolve; 
                });

                if (logoImg.complete && logoImg.naturalWidth > 0) {
                    const logoSize = 60;
                    const x = (300 - logoSize) / 2;
                    const y = (300 - logoSize) / 2;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(x - 3, y - 3, logoSize + 6, logoSize + 6);
                    ctx.drawImage(logoImg, x, y, logoSize, logoSize);
                }
                
                shareQrCodeUrl = canvas.toDataURL();
            } else {
                shareQrCodeUrl = qrUrl;
            }
        } catch (e) {
            console.error(e);
            triggerNativeShare();
        } finally {
            isGenerating = false;
        }
    }

    function close() {
        show = false;
        dispatch('close');
    }

    function copyToClipboard(text, msg) {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => alert(msg || "បានចម្លងតំណភ្ជាប់ទៅក្ដារតម្បៀតខ្ទាស់!"));
    }

    async function triggerNativeShare() {
        const shareData = { title: 'CCN-CPD', text: shareText, url: targetUrl };
        if (navigator.share) {
            try { await navigator.share(shareData); } catch (e) {}
        } else {
            copyToClipboard(targetUrl, "បានចម្លងតំណភ្ជាប់ទៅក្ដារតម្បៀតខ្ទាស់!");
        }
    }

    function downloadQrCode() {
        if (!shareQrCodeUrl) return;
        const link = document.createElement('a');
        link.href = shareQrCodeUrl;
        link.download = 'ccn-cpd-qr.png';
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    }
</script>

{#if show}
    <div class="modal modal-open bg-black/60" transition:fade={{ duration: 200 }}>
        <div class="modal-box text-center max-w-sm bg-white">
            <h3 class="font-bold text-lg mb-4 text-gray-900">{shareTitle}</h3>
            <div class="flex justify-center mb-4">
                {#if isGenerating}
                    <div class="w-64 h-64 flex items-center justify-center border rounded-lg bg-base-200">
                        <span class="loading loading-spinner loading-lg text-primary"></span>
                    </div>
                {:else if shareQrCodeUrl}
                    <img src={shareQrCodeUrl} alt="កូដ QR កម្មវិធី" class="rounded-lg border shadow-sm w-64 h-64" />
                {/if}
            </div>
            <p class="text-sm text-gray-500 mb-4 break-all px-2">{targetUrl}</p>
            <div class="flex flex-col gap-2">
                <button on:click={triggerNativeShare} class="btn btn-primary w-full text-black">📢 ចែករំលែកតាម...</button>
                <button on:click={() => copyToClipboard(targetUrl, "បានចម្លងតំណភ្ជាប់ទៅក្ដារតម្បៀតខ្ទាស់!")} class="btn btn-outline w-full">📋 ចម្លងតំណភ្ជាប់</button>
                <button on:click={downloadQrCode} class="btn btn-outline btn-info w-full">⬇️ ទាញយក QR</button>
            </div>
            <div class="modal-action justify-center">
                <button class="btn btn-ghost" on:click={close}>បិទ</button>
            </div>
        </div>
    </div>
{/if}