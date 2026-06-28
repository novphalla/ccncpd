<script>
    import { onMount, tick } from 'svelte';

    export let form;
    export let submissions = [];

    let chartInstances = [];
    let Chart;

    // ពណ៌សម្រាប់ Chart (Palette)
    const colors = ['#0d9488', '#f59e0b', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899', '#10b981', '#6366f1'];

    onMount(async () => {
        // Import Chart.js dynamically
        const module = await import('chart.js/auto');
        Chart = module.default;
    });

    async function renderCharts() {
        if (!Chart || !form) return;

        // លុប Chart ចាស់ៗចោលមុននឹងគូរថ្មី
        chartInstances.forEach(c => c.destroy());
        chartInstances = [];

        await tick();

        const chartableFields = form.fields.filter(f => ['radio', 'select', 'checkbox', 'scale', 'rating', 'grid_radio', 'grid_checkbox'].includes(f.type));

        chartableFields.forEach((field, index) => {
            const canvas = document.getElementById(`chart-canvas-${index}`);
            if (!canvas) return;

            if (['grid_radio', 'grid_checkbox'].includes(field.type)) {
                createGridChart(canvas, field);
                return;
            }

            const counts = {};
            // កំណត់តម្លៃដើម (Init options)
            if (field.options) field.options.split(',').forEach(opt => counts[opt.trim()] = 0);
            if (field.type === 'scale' || field.type === 'rating') [1, 2, 3, 4, 5].forEach(n => counts[n] = 0);

            // រាប់ចំនួនចម្លើយ (Count Data)
            submissions.forEach(sub => {
                const val = sub.data?.[field.label];
                if (Array.isArray(val)) {
                    val.forEach(v => counts[String(v).trim()] = (counts[String(v).trim()] || 0) + 1);
                } else if (val != null && val !== '') {
                    counts[String(val).trim()] = (counts[String(val).trim()] || 0) + 1;
                }
            });

            // ប្រើ Doughnut Chart សម្រាប់សំណួរប្រភេទ Radio/Select, ក្រៅពីនោះប្រើ Bar Chart
            const isPie = ['radio', 'select'].includes(field.type);

            chartInstances.push(new Chart(canvas, {
                type: isPie ? 'doughnut' : 'bar',
                data: {
                    labels: Object.keys(counts),
                    datasets: [{
                        label: 'ចំនួន',
                        data: Object.values(counts),
                        backgroundColor: isPie ? colors : colors[0], // ពណ៌ចម្រុះបើជា Pie
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: isPie, position: 'right' },
                        title: { display: false }
                    },
                    scales: isPie ? {} : { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
                }
            }));
        });
    }

    function createGridChart(canvas, field) {
        const rows = (field.rows || '').split(',').map(r => r.trim()).filter(Boolean);
        const columns = (field.options || '').split(',').map(c => c.trim()).filter(Boolean);

        // Initialize counts: { 'Column A': { 'Row 1': 0, 'Row 2': 0 }, 'Column B': ... }
        const countsByColumn = {};
        columns.forEach(col => {
            countsByColumn[col] = {};
            rows.forEach(row => {
                countsByColumn[col][row] = 0;
            });
        });

        // Aggregate data
        submissions.forEach(sub => {
            const answer = sub.data?.[field.label];
            if (typeof answer === 'object' && answer !== null) {
                Object.entries(answer).forEach(([row, value]) => {
                    if (rows.includes(row)) {
                        if (Array.isArray(value)) { // grid_checkbox
                            value.forEach(col => {
                                if (columns.includes(col)) {
                                    countsByColumn[col][row]++;
                                }
                            });
                        } else { // grid_radio
                            if (columns.includes(String(value))) {
                                countsByColumn[String(value)][row]++;
                            }
                        }
                    }
                });
            }
        });

        const datasets = Object.entries(countsByColumn).map(([columnLabel, rowCounts], index) => ({
            label: columnLabel,
            data: rows.map(row => rowCounts[row]),
            backgroundColor: colors[index % colors.length],
        }));

        chartInstances.push(new Chart(canvas, {
            type: 'bar',
            data: {
                labels: rows,
                datasets: datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    title: { display: false },
                },
                scales: {
                    x: {
                        stacked: true,
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        ticks: {
                            stepSize: 1
                        }
                    }
                }
            }
        }));
    }

    $: if (Chart && form && submissions) {
        renderCharts();
    }

    function exportChart(index, label) {
        const canvas = document.getElementById(`chart-canvas-${index}`);
        if (!canvas) return;

        const link = document.createElement('a');
        link.download = `${label.replace(/\s+/g, '_')}_chart.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }
</script>

<div class="grid grid-cols-1 md:grid-cols-2 gap-6 p-2">
    {#each form.fields.filter(f => ['radio', 'select', 'checkbox', 'scale', 'rating', 'grid_radio', 'grid_checkbox'].includes(f.type)) as field, i}
        <div class="bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] p-4">
            <div class="flex justify-between items-center border-b-2 border-black pb-2 mb-4">
                <h3 class="font-bold text-lg text-gray-800">{field.label}</h3>
                <button class="btn btn-xs btn-ghost border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none" on:click={() => exportChart(i, field.label)} title="Export PNG">📥 PNG</button>
            </div>
            <div class="h-64 w-full relative flex justify-center">
                <canvas id="chart-canvas-{i}"></canvas>
            </div>
            <div class="flex justify-end mt-4">
                <div class="badge badge-ghost badge-xs font-mono border border-black rounded-none">{field.type}</div>
            </div>
        </div>
    {/each}
</div>