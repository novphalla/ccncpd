<script>
    import { onMount } from 'svelte';
    import { fly } from 'svelte/transition';

    export let t;

    let deferredPrompt;
    let showInstallButton = false;
    let showIosGuide = false;
    let dismissed = false;

    function isIos() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent);
    }

    function isInStandaloneMode() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function handleBeforeInstallPrompt(e) {
        e.preventDefault();
        deferredPrompt = e;
        showInstallButton = true;
    }

    onMount(() => {
        if (typeof window === 'undefined') return;
        if (isInStandaloneMode()) return; // already installed

        if (isIos()) {
            const dismissed_ios = sessionStorage.getItem('pwa_ios_dismissed');
            if (!dismissed_ios) showIosGuide = true;
        } else {
            window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        }
    });

    async function installApp() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            deferredPrompt = null;
            showInstallButton = false;
        }
    }

    function dismissIos() {
        sessionStorage.setItem('pwa_ios_dismissed', '1');
        showIosGuide = false;
    }
</script>

{#if showInstallButton}
    <div class="alert bg-gradient-to-r from-[#0056b3] to-[#0099ff] text-white shadow-lg rounded-xl border-none" transition:fly={{ y: -30, duration: 400 }}>
        <div><h3 class="font-bold">{t('install_app')}</h3><div class="text-xs opacity-90">{t('easier_to_use')}</div></div>
        <button class="btn btn-sm btn-white text-primary border-none shadow-sm" on:click={installApp}>{t('install')}</button>
    </div>
{/if}

{#if showIosGuide}
    <div class="alert bg-gradient-to-r from-[#0056b3] to-[#0099ff] text-white shadow-lg rounded-xl border-none" transition:fly={{ y: -30, duration: 400 }}>
        <div>
            <h3 class="font-bold">{t('install_app')}</h3>
            <div class="text-xs opacity-90 mt-1">
                ចុច <span class="font-bold">Share</span> 
                <svg class="inline w-4 h-4 mx-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>
                </svg>
                រួចចុច <span class="font-bold">Add to Home Screen</span>
            </div>
        </div>
        <button class="btn btn-sm btn-ghost text-white border-white border-opacity-50" on:click={dismissIos}>✕</button>
    </div>
{/if}