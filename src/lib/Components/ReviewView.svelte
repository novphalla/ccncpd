<script>
    import { createEventDispatcher } from 'svelte';
    export let questions = [];
    export let userAnswers = [];

    const dispatch = createEventDispatcher();

    function getCorrectIndex(q) {
        if (q.answer !== undefined) return q.answer;
        if (q.correct_answer !== undefined) return Number(q.correct_answer);
        if (q.answers && q.answers.length > 0) return Number(q.answers[0]);
        return -1;
    }
</script>

<div class="screen p-6 h-full bg-white flex flex-col">
    <div class="flex justify-between items-center mb-6">
        <h2 class="text-xl font-bold">មើលចម្លើយឡើងវិញ</h2>
        <button on:click={() => dispatch('close')} class="btn btn-sm border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none">បិទ</button>
    </div>
    <div class="flex-1 overflow-y-auto pb-20">
        {#each questions as q, qIdx}
            {@const correctIdx = getCorrectIndex(q)}
            {@const userAns = userAnswers[qIdx]}
            {@const isCorrect = userAns === correctIdx}
            
            <div class="bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4 mb-4">
                <div class="flex justify-between items-start mb-3">
                    <h3 class="font-bold text-lg flex-1">{qIdx + 1}. {q.question}</h3>
                    <span class="badge {isCorrect ? 'badge-success text-white' : 'badge-error text-white'} ml-2 shrink-0 border-2 border-black rounded-none">
                        {isCorrect ? 'ត្រឹមត្រូវ' : 'ខុស'}
                    </span>
                </div>

                <div class="flex flex-col gap-2">
                    {#each q.options as opt, oIdx}
                        {@const isThisCorrect = oIdx === correctIdx}
                        {@const isThisSelected = userAns === oIdx}
                        
                        <div class="p-3 border-2 border-black flex justify-between items-center transition-all
                            {isThisCorrect ? 'bg-green-100 text-green-900' : ''} 
                            {isThisSelected && !isThisCorrect ? 'bg-red-100 text-red-900' : 'bg-white text-gray-600'}">
                            <span class="font-medium">{opt}</span>
                            {#if isThisCorrect} <span class="text-xl">✅</span> {/if}
                            {#if isThisSelected && !isThisCorrect} <span class="text-xl">❌</span> {/if}
                        </div>
                    {/each}
                </div>
                
                {#if !isCorrect}
                    <div class="mt-3 text-sm text-gray-600 bg-gray-50 p-3 border-2 border-black">
                        💡 ចម្លើយត្រឹមត្រូវគឺ៖ <span class="font-bold text-green-700">{q.options[correctIdx]}</span>
                    </div>
                {/if}
            </div>
        {/each}
    </div>
    <div class="pt-4 border-t mt-2 flex flex-col gap-2">
        <button on:click={() => dispatch('share')} class="btn btn-outline btn-info w-full border-2 border-black rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none">📢 ចែករំលែកលទ្ធផល</button>
        <button on:click={() => dispatch('retry')} class="btn btn-primary w-full border-2 border-black rounded-none shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:shadow-none">ធ្វើតេស្តម្តងទៀត</button>
    </div>
</div>