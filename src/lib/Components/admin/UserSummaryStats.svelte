<script>
    export let stats = { gender: {}, position: {}, workplace: {}, licenseStatus: {}, province: {} };
    export let totalUsers = 0;

    function printUserSummaryStats() {
        if (totalUsers === 0) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");

        const printWindow = window.open('', '_blank');
        
        let html = `
            <html>
            <head>
                <title>របាយការណ៍សង្ខេបអ្នកប្រើប្រាស់</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Nokora:wght@400;700&display=swap');
                    body { font-family: 'Nokora', sans-serif; padding: 20px; color: #1f2937; }
                    h1 { text-align: center; color: #0d9488; margin-bottom: 10px; }
                    h2 { font-size: 16px; margin-top: 20px; border-bottom: 2px solid #0d9488; padding-bottom: 5px; color: #0f766e; }
                    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 30px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
                    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
                    th { background-color: #f3f4f6; font-weight: bold; }
                    .total-row { font-weight: bold; background-color: #e5e7eb; }
                    .header-info { text-align: center; margin-bottom: 30px; font-size: 14px; background: #f0fdfa; padding: 15px; border-radius: 10px; border: 1px solid #ccfbf1; }
                    @media print {
                        body { padding: 0; }
                        .header-info { border: 1px solid #ddd; }
                    }
                </style>
            </head>
            <body>
                <h1>របាយការណ៍សង្ខេបអ្នកប្រើប្រាស់</h1>
                <div class="header-info">
                    <p style="margin:0 0 5px 0;">កាលបរិច្ឆេទ Export: ${new Date().toLocaleString('km-KH')}</p>
                    <p style="margin:0;">អ្នកប្រើប្រាស់សរុប: <strong>${totalUsers}</strong> នាក់</p>
                </div>
                <div class="grid">
        `;

        const makeTable = (title, dataObj) => {
            let t = "<div><h2>" + title + "</h2><table><thead><tr><th>ឈ្មោះ</th><th>ចំនួន</th><th>ភាគរយ</th></tr></thead><tbody>";
            const entries = Object.entries(dataObj).sort((a,b) => b-a);
            entries.forEach(([label, count]) => {
                t += "<tr><td>" + label + "</td><td>" + count + "</td><td>" + Math.round((count / totalUsers) * 100) + "%</td></tr>";
            });
            t += "<tr class='total-row'><td>សរុប</td><td>" + totalUsers + "</td><td>100%</td></tr>";
            t += "</tbody></table></div>";
            return t;
        };

        html += makeTable('ភេទ', stats.gender);
        html += makeTable('មុខតំណែង / កម្រិតជំនាញ', stats.position);
        html += makeTable('កន្លែងធ្វើការ', stats.workplace);
        html += makeTable('រាជធានី/ខេត្ត', stats.province);
        html += makeTable('ស្ថានភាពអាជ្ញាប័ណ្ណ', stats.licenseStatus);

        html += `</div><script>window.onload = () => { window.print(); }<\/script></body></html>`;

        printWindow.document.write(html);
        printWindow.document.close();
    }

    function exportUserSummaryStatsToExcel() {
        if (totalUsers === 0) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");

        const BOM = "\uFEFF";
        let csvContent = `របាយការណ៍សង្ខេបអ្នកប្រើប្រាស់\nកាលបរិច្ឆេទ Export:,${new Date().toLocaleString('km-KH')}\nអ្នកប្រើប្រាស់សរុប:,${totalUsers}\n\n`;

        const appendTable = (title, dataObj, total) => {
            csvContent += `${title},ចំនួន,ភាគរយ\n`;
            const entries = Object.entries(dataObj).sort((a,b) => b-a);
            entries.forEach(([label, count]) => {
                const pct = Math.round((count / total) * 100);
                csvContent += `"${String(label).replace(/"/g, '""')}",${count},${pct}%\n`;
            });
            csvContent += `សរុប,${total},100%\n\n`;
        };

        appendTable('ភេទ', stats.gender, totalUsers);
        appendTable('មុខតំណែង / កម្រិតជំនាញ', stats.position, totalUsers);
        appendTable('កន្លែងធ្វើការ', stats.workplace, totalUsers);
        appendTable('រាជធានី/ខេត្ត', stats.province, totalUsers);
        appendTable('ស្ថានភាពអាជ្ញាប័ណ្ណ', stats.licenseStatus, totalUsers);

        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `user_stats_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
</script>

<div class="mb-4 p-3 bg-base-200/50 border border-base-300 rounded-xl">
    <div class="flex items-center justify-between mb-3 px-1">
        <h4 class="text-sm font-bold text-gray-700 flex items-center gap-2">
            📊 សង្ខេបទិន្នន័យ ({totalUsers} នាក់)
        </h4>
        <div class="flex gap-2">
            <button on:click={printUserSummaryStats} class="btn btn-xs btn-square btn-warning text-white shadow-sm text-base" title="ព្រីនតារាងសង្ខេប (Print/PDF)">🖨️</button>
            <button on:click={exportUserSummaryStatsToExcel} class="btn btn-xs btn-square btn-success text-white shadow-sm text-base" title="ទាញយកតារាងសង្ខេបជា Excel">📊</button>
        </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
        <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-center">
            <div class="text-2xl font-black text-indigo-700">{totalUsers}</div>
            <div class="text-xs text-indigo-500 font-medium">សរុប</div>
        </div>
        {#each Object.entries(stats.gender).sort((a,b) => b-a) as [g, n]}
        <div class="rounded-xl p-3 text-center {g === 'ប្រុស' ? 'bg-blue-50 border border-blue-100' : 'bg-pink-50 border border-pink-100'}">
            <div class="text-2xl font-black {g === 'ប្រុស' ? 'text-blue-700' : 'text-pink-700'}">{n}</div>
            <div class="text-xs font-medium {g === 'ប្រុស' ? 'text-blue-500' : 'text-pink-500'}">{g}</div>
        </div>
        {/each}
    </div>
    
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {#each [
            { title: 'មុខតំណែង / កម្រិតជំនាញ', data: stats.position, color: 'violet' },
            { title: 'កន្លែងធ្វើការ', data: stats.workplace, color: 'teal' },
            { title: 'ស្ថានភាពអាជ្ញាប័ណ្ណ', data: stats.licenseStatus, color: 'rose' },
            { title: 'រាជធានី/ខេត្ត', data: stats.province, color: 'amber' }
        ] as block}
        <div class="bg-{block.color}-50 border border-{block.color}-100 rounded-xl p-3">
            <div class="text-xs font-bold text-{block.color}-700 mb-2">{block.title}</div>
            <div class="space-y-1 max-h-48 overflow-y-auto pr-1">
                {#each Object.entries(block.data).sort((a,b) => b-a) as [label, count]}
                <div class="flex justify-between items-center gap-2">
                    <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                    <span class="text-xs font-bold text-{block.color}-700 shrink-0">{count}</span>
                    <div class="w-16 bg-{block.color}-100 rounded-full h-1.5 shrink-0"><div class="bg-{block.color}-400 h-1.5 rounded-full" style="width:{Math.round(count/totalUsers*100)}%"></div></div>
                </div>
                {/each}
            </div>
        </div>
        {/each}
    </div>
</div>