<script>
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';

    export let show = false;
    export let assistantTelegram = '';

    const dispatch = createEventDispatcher();
</script>

{#if show}
    <div class="modal modal-open bg-black/60" transition:fade={{ duration: 200 }}>
        <div class="modal-box bg-white text-center">
            <div class="mx-auto mb-4 w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="32" height="32" class="text-primary">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.662-.629.548-1.143.872-1.143 1.463 0 .48.03.904.06 1.285M12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008z" />
                </svg>
            </div>
            <h3 class="font-bold text-lg mb-2 text-gray-900">ភ្លេចលេខកូដ?</h3>
            <p class="text-gray-600 mb-6 text-sm">តើអ្នកចង់ទាក់ទងជំនួយការដើម្បីស្នើសុំលេខកូដថ្មីមែនទេ?</p>
            <div class="modal-action justify-center">
                <button class="btn" on:click={() => { show = false; dispatch('close'); }}>បោះបង់</button>
                <button class="btn btn-primary" on:click={() => { window.open(assistantTelegram, '_blank'); show = false; }}>
                    យល់ព្រម
                </button>
            </div>
        </div>
    </div>
{/if}