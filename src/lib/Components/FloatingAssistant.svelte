<script>
    import { fade } from 'svelte/transition';
    export let assistantTelegram = '';

    let isVisible = true;
    let lastScrollY = 0;

    function handleScroll() {
        if (typeof window === 'undefined') return;
        const currentScrollY = window.scrollY;
        
        // លាក់ពេលអូសចុះក្រោម (លើសពី 50px), បង្ហាញមកវិញពេលអូសឡើងលើ
        if (currentScrollY > lastScrollY && currentScrollY > 50) {
            isVisible = false;
        } else {
            isVisible = true;
        }
        lastScrollY = currentScrollY;
    }
</script>

<svelte:window on:scroll={handleScroll} />

{#if assistantTelegram && isVisible}
    <a 
        href={assistantTelegram} 
        target="_blank" 
        rel="noopener noreferrer" 
        class="fixed bottom-16 right-4 z-50 flex items-center gap-2 bg-[#2AABEE] hover:bg-[#229ED9] text-white px-4 py-3 rounded-full shadow-lg hover:-translate-y-1 hover:scale-105 transition-all duration-300 group"
        title="ទាក់ទងជំនួយការ"
        transition:fade
    >
        <!-- Telegram Icon -->
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-6 h-6 animate-pulse group-hover:animate-none"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49 1.14-4.22 2.98-.4.27-.76.41-1.08.4-.35-.01-.98-.18-1.46-.34-.58-.19-1.04-.29-1-.61.02-.17.26-.35.73-.55 2.87-1.25 4.79-2.08 5.76-2.48 2.74-1.14 3.31-1.34 3.69-1.34.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06-.01.13-.02.2z"/></svg>
        <span class="font-bold text-sm tracking-wide">ត្រូវការជំនួយ?</span>
    </a>
{/if}