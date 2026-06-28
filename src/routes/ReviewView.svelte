<script>
    import { createEventDispatcher } from 'svelte';
    export let questions = [];
    export let userAnswers = [];

    const dispatch = createEventDispatcher();
</script>

<div class="screen p-6 min-h-screen bg-white flex flex-col">
    <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-bold">មើលចម្លើយឡើងវិញ</h2>
        <button on:click={() => dispatch('close')} class="btn btn-sm">បិទ</button>
    </div>
    <div class="flex-1 overflow-y-auto pb-20">
        {#each questions as q, qIdx}
            <div class="card bg-white shadow-sm border p-4 mb-4">
                <h3 class="font-bold mb-2">{qIdx + 1}. {q.question}</h3>
                <div class="flex flex-col gap-2">
                    {#each q.options as opt, oIdx}
                        <div class="p-3 rounded border {oIdx === q.answer ? 'bg-green-100 border-green-500' : ''} {userAnswers[qIdx] === oIdx && oIdx !== q.answer ? 'bg-red-100 border-red-500' : ''}">
                            {opt}
                            {#if oIdx === q.answer} ✅ {/if}
                            {#if userAnswers[qIdx] === oIdx && oIdx !== q.answer} ❌ {/if}
                        </div>
                    {/each}
                </div>
            </div>
        {/each}
    </div>
    <div class="pt-4 border-t mt-2 flex flex-col gap-2">
        <button on:click={() => dispatch('share')} class="btn btn-outline btn-info w-full">📢 ចែករំលែកលទ្ធផល</button>
        <button on:click={() => dispatch('retry')} class="btn btn-primary w-full">ធ្វើតេស្តម្តងទៀត</button>
    </div>
</div>