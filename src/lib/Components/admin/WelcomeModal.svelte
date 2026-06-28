<script>
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';

    export let show = false;
    export let pendingQuizCourse = null;

    const dispatch = createEventDispatcher();
</script>

{#if show}
    <div class="modal modal-open bg-black/60" transition:fade={{ duration: 200 }}>
        <div class="modal-box bg-white text-center">
            <h3 class="font-bold text-2xl text-primary mb-4">🎉 ស្វាគមន៍សមាជិកថ្មី!</h3>
            <p class="py-4 text-gray-600">
                សូមស្វាគមន៍មកកាន់ CCN-CPD! <br>
                អ្នកបានចុះឈ្មោះជោគជ័យហើយ។ សូមចាប់ផ្តើមធ្វើតេស្តវគ្គ <b>"{pendingQuizCourse?.title}"</b> ឥឡូវនេះ!
            </p>
            <div class="modal-action justify-center">
                <button class="btn btn-primary text-white px-8" on:click={() => { 
                    show = false; 
                    dispatch('startQuiz'); 
                }}>
                    🚀 សូមចាប់ផ្តើមធ្វើតេស្ត
                </button>
            </div>
        </div>
    </div>
{/if}