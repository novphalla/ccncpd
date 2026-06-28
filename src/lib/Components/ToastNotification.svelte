<script>
    import { toasts, dismissToast } from '$lib/toast.js';
    import { flip } from 'svelte/animate';
    import { fade, fly } from 'svelte/transition';
</script>

<div class="toast toast-end toast-bottom z-50 flex flex-col gap-2">
    {#each $toasts as toast (toast.id)}
        <div 
            animate:flip 
            in:fly={{ y: 20 }} 
            out:fade 
            class="alert shadow-lg min-w-[250px] flex justify-between {toast.type === 'success' ? 'alert-success text-white' : toast.type === 'error' ? 'alert-error text-white' : 'alert-info text-white'}"
        >
            <span>{toast.message}</span>
            <button class="btn btn-xs btn-ghost btn-circle" on:click={() => dismissToast(toast.id)}>✕</button>
        </div>
    {/each}
</div>