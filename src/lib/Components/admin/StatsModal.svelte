<script>
    import { createEventDispatcher, tick } from 'svelte';
    import { fade } from 'svelte/transition';

    export let show = false;
    export let supabase;
    export let currentUser;
    export let courses = [];
    export let primaryColor = '#0d9488';

    const dispatch = createEventDispatcher();
    let loading = false;
    let statsCanvas;
    let statsChart = null;

    $: if (show && currentUser) {
        loadStats();
    }

    async function loadStats() {
        loading = true;
        try {
            const [attemptsRes, chartModule] = await Promise.all([
                supabase.from('student_quiz_results')
                    .select('score, created_at, course_id')
                    .eq('user_id', currentUser.id)
                    .order('created_at', { ascending: true })
                    .limit(500),
                import('chart.js/auto')
            ]);

            const attempts = attemptsRes.data;
            const Chart = chartModule.default;
                
            loading = false;
            await tick();
            
            if (statsCanvas && attempts && attempts.length > 0) {
                if (statsChart) statsChart.destroy();
                
                const labels = attempts.map(a => new Date(a.created_at).toLocaleDateString('km-KH'));
                const scores = attempts.map(a => a.score);
                const titles = attempts.map(a => courses.find(c => c.id === a.course_id)?.title || 'Unknown Course');

                statsChart = new Chart(statsCanvas, {
                    type: 'line',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'ពិន្ទុ (Score)',
                            data: scores,
                            borderColor: primaryColor || '#0d9488',
                            backgroundColor: 'rgba(13, 148, 136, 0.2)',
                            borderWidth: 2,
                            tension: 0.4,
                            fill: true,
                            pointBackgroundColor: '#fff',
                            pointBorderColor: primaryColor || '#0d9488',
                            pointRadius: 4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: { y: { beginAtZero: true, max: 100, grid: { color: '#f3f4f6' } }, x: { grid: { display: false } } },
                        plugins: { tooltip: { callbacks: { title: (items) => titles[items[0].dataIndex], label: (item) => `Score: ${item.raw}%` } }, legend: { display: false } }
                    }
                });
            }
        } catch (e) {
            console.error("Error loading stats:", e);
            loading = false; show = false;
            alert("មិនអាចបើកមើលស្ថិតិបានទេ (សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត)");
        }
    }
</script>

{#if show}
    <div class="modal modal-open bg-black/60" transition:fade={{ duration: 200 }}>
        <div class="modal-box w-11/12 max-w-3xl bg-white">
            <div class="flex justify-between items-center mb-4">
                <h3 class="font-bold text-lg text-gray-900">ស្ថិតិការសិក្សា</h3>
                <button on:click={() => { show = false; dispatch('close'); }} class="btn btn-sm btn-circle btn-ghost">✕</button>
            </div>
            <div class="h-64 w-full">
                {#if loading}
                    <div class="flex h-full items-center justify-center"><span class="loading loading-spinner"></span></div>
                {:else}
                    <canvas bind:this={statsCanvas}></canvas>
                    {#if !statsChart && !loading}
                        <p class="text-center text-gray-500 mt-10">មិនទាន់មានទិន្នន័យទេ</p>
                    {/if}
                {/if}
            </div>
        </div>
    </div>
{/if}