<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fade, slide } from 'svelte/transition';

    export let supabase;

    const dispatch = createEventDispatcher();

    let paginatedRegistrations = [];
    let totalRegistrations = 0;
    let isExporting = false;
    let loadingRegs = false;
    let registrationSearch = '';
    let debouncedRegSearch = '';
    let regSearchTimeout;
    let isRegSearching = false;

    $: {
        clearTimeout(regSearchTimeout);
        regSearchTimeout = setTimeout(() => {
            if (debouncedRegSearch !== registrationSearch) {
                debouncedRegSearch = registrationSearch;
                isRegSearching = false;
                currentPage = 1;
                loadRegistrations();
            } else {
                isRegSearching = false;
            }
        }, 300);
    }
    let meetingFilter = '';
    let currentPage = 1;
    let itemsPerPage = 10;
    let regSortColumn = 'created_at';
    let regSortDirection = 'desc';

    let showSummary = true;
    let regStats = { total: 0, gender: {}, position: {}, workplace: {}, province: {}, licenseStatus: {} };
    let formAnswerStats = [];
    let loadingFormStats = false;
    let uniqueMeetings = [];

    // Helper function ដើម្បីការពារ Cross-Site Scripting (XSS) ពេលប្រើ document.write
    function escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    onMount(() => {
        loadUniqueMeetings();
        loadRegistrations();
    });

    async function loadUniqueMeetings() {
        const { data } = await supabase.from('live_meetings').select('id, title, registration_form_id').order('created_at', { ascending: false }).limit(200);
        uniqueMeetings = data || [];
    }

    function toggleRegSort(column) {
        if (regSortColumn === column) {
            regSortDirection = regSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            regSortColumn = column;
            regSortDirection = 'asc';
        }
        currentPage = 1;
        loadRegistrations();
    }

    async function loadRegistrations() {
        loadingRegs = true;
        
        let query = supabase
            .from('meeting_registrations')
            .select(`*, live_meetings!inner(title, scheduled_at, registration_form_id), users!inner(full_name, name_latin, phone_number, gender, profile_data, avatar_url)`, { count: 'exact' });

        if (debouncedRegSearch) {
            const safeSearch = debouncedRegSearch.replace(/,/g, ' ').trim(); // ការពារ Error ពេលមានសញ្ញាក្បៀស
            query = query.or(`name_khmer.ilike.%${safeSearch}%,name_latin.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`);
        }
        if (meetingFilter) query = query.eq('meeting_id', meetingFilter);

        let dbCol = regSortColumn;
        if (dbCol === 'name') dbCol = 'name_khmer';
        if (dbCol === 'meeting') dbCol = 'meeting_id';

        const from = (currentPage - 1) * itemsPerPage;
        const { data, count, error } = await query.order(dbCol, { ascending: regSortDirection === 'asc' }).range(from, from + itemsPerPage - 1);

        if (error) {
            console.error("Error loading registrations:", error);
            alert("មានបញ្ហាក្នុងការទាញយកទិន្នន័យ: " + error.message);
        } else {
            paginatedRegistrations = data || [];
            totalRegistrations = count || 0;
        }

        loadingRegs = false;
        loadRegStats();
        loadFormAnswerStats();
    }

    function downloadCSV(filename, headers, rows) {
        const BOM = "\uFEFF"; 
        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function fetchAllForExport() {
        isExporting = true;
        let allData = [];
        let hasMore = true; let from = 0; const step = 1000;
        while(hasMore) {
            let query = supabase.from('meeting_registrations').select('*, live_meetings!inner(title, scheduled_at, registration_form_id), users!inner(full_name, name_latin, phone_number, gender, profile_data, avatar_url)');
            if (debouncedRegSearch) {
                const safeSearch = debouncedRegSearch.replace(/,/g, ' ').trim();
                query = query.or(`name_khmer.ilike.%${safeSearch}%,name_latin.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`);
            }
            if (meetingFilter) query = query.eq('meeting_id', meetingFilter);
            
            let dbCol = regSortColumn === 'name' ? 'name_khmer' : regSortColumn === 'meeting' ? 'meeting_id' : regSortColumn;
            const { data, error } = await query.order(dbCol, { ascending: regSortDirection === 'asc' }).range(from, from + step - 1);
            
            if (error || !data || data.length === 0) break;
            allData.push(...data);
            from += step;
            if (data.length < step) hasMore = false;
        }
        isExporting = false;
        return allData;
    }

    async function exportToExcel() {
        if (regStats.total === 0) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");
        
        const allFilteredData = await fetchAllForExport();

        const formIds = [...new Set(allFilteredData.map(r => r.live_meetings?.registration_form_id).filter(Boolean))];
        let formFieldsMap = {};
        
        if (formIds.length) {
            const { data: formsData } = await supabase.from('custom_forms').select('id, fields').in('id', formIds);
            if (formsData) {
                formsData.forEach(f => {
                    formFieldsMap[f.id] = (f.fields || []).filter(field => field.type !== 'section').map(field => field.label);
                });
            }
        }

        const userIds = [...new Set(allFilteredData.map(r => r.user_id).filter(Boolean))];
        let submissionsMap = {};
        if (userIds.length && formIds.length) {
            let allSubs = [];
            for (let i = 0; i < userIds.length; i += 200) {
                const chunk = userIds.slice(i, i + 200);
                const { data: subsData } = await supabase.from('custom_form_submissions').select('user_id, form_id, data').in('user_id', chunk).in('form_id', formIds);
                if (subsData) allSubs = [...allSubs, ...subsData];
            }
            allSubs.forEach(s => { submissionsMap[`${s.user_id}_${s.form_id}`] = s.data; });
        }

        const seenKeys = new Set();
        const formColumns = [];
        allFilteredData.forEach(reg => {
            const fid = reg.live_meetings?.registration_form_id;
            if (fid && formFieldsMap[fid]) {
                formFieldsMap[fid].forEach(k => { if (!seenKeys.has(k)) { seenKeys.add(k); formColumns.push(k); } });
            }
        });

        const meetingLabel = meetingFilter ? (uniqueMeetings.find(m => m.id === meetingFilter)?.title || 'meeting') : 'all_meetings';
        const headers = ['ល.រ', 'កាលបរិច្ឆេទ', 'ឈ្មោះខ្មែរ', 'ឈ្មោះឡាតាំង', 'ភេទ', 'មុខតំណែង / កម្រិតជំនាញ', 'ទីកន្លែងធ្វើការ', 'រាជធានី/ខេត្ត', 'ស្ថានភាពអាជ្ញាប័ណ្ណ', 'លេខទូរស័ព្ទ', ...formColumns, 'ប្រធានបទការប្រជុំ'];

        const rows = allFilteredData.map((reg, i) => {
            const meetingTitle = reg.live_meetings ? reg.live_meetings.title : 'Deleted';
            const licenseStatus = reg.users?.profile_data?.license_status || '';
            const licenseNumber = reg.users?.profile_data?.license_number || '';
            const licenseCell = licenseStatus === 'មាន' && licenseNumber ? `${licenseStatus} (${licenseNumber})` : licenseStatus;
            const gender = reg.gender === 'Male' ? 'ប្រុស' : reg.gender === 'Female' ? 'ស្រី' : (reg.gender || '');
            const position = (reg.position && reg.position !== 'N/A') ? reg.position : (reg.users?.profile_data?.position || '');
            const workplace = (reg.workplace && reg.workplace !== 'N/A') ? reg.workplace : (reg.users?.profile_data?.workplace || '');
            const province = reg.users?.profile_data?.province || '';
            const nameKhmer = reg.name_khmer || reg.users?.full_name || '';
            const nameLatin = reg.users?.name_latin || reg.name_latin || '';
            const fid = reg.live_meetings?.registration_form_id;
            const formData = fid ? (submissionsMap[`${reg.user_id}_${fid}`] || {}) : {};

            const rowData = [
                i + 1,
                new Date(reg.created_at).toLocaleDateString('km-KH'),
                `"${nameKhmer.replace(/"/g, '""')}"`,
                `"${nameLatin.replace(/"/g, '""')}"`,
                `"${gender}"`,
                `"${position.replace(/"/g, '""')}"`,
                `"${workplace.replace(/"/g, '""')}"`,
                `"${province.replace(/"/g, '""')}"`,
                `"${licenseCell.replace(/"/g, '""')}"`,
                `="${(reg.phone || '').replace(/"/g, '""')}"`
            ];

            formColumns.forEach(key => {
                const val = formData[key];
                const strVal = Array.isArray(val) ? val.join(', ') : String(val ?? '');
                rowData.push(`"${strVal.replace(/"/g, '""')}"`);
            });

            rowData.push(`"${meetingTitle.replace(/"/g, '""')}"`);
            return rowData.join(',');
        });

        downloadCSV(`registrations_${meetingLabel}_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    }

    async function printRegistrations() {
        if (regStats.total === 0) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");
        const allFilteredData = await fetchAllForExport();
        const printWindow = window.open('', '_blank');
        let html = `<html><head><title>បញ្ជីអ្នកចុះឈ្មោះប្រជុំ</title><style>@import url('https://fonts.googleapis.com/css2?family=Nokora:wght@400;700&display=swap');body{font-family:'Nokora',sans-serif;padding:20px;}h1{text-align:center;color:#0d9488;margin-bottom:20px;}table{width:100%;border-collapse:collapse;margin-top:20px;font-size:11px;}th,td{border:1px solid #9ca3af;padding:6px;text-align:left;vertical-align:top;}th{background-color:#f3f4f6;font-weight:bold;color:#1f2937;}tr:nth-child(even){background-color:#f9fafb;}@media print{@page{size:landscape;margin:10mm;}body{padding:0;}table{width:100%;}}</style></head><body><h1>បញ្ជីអ្នកចុះឈ្មោះប្រជុំ</h1><p style="text-align:right;font-size:10px;color:#666;">កាលបរិច្ឆេទ Export: ${new Date().toLocaleString('km-KH')}</p><table><thead><tr><th style="width:40px;">ល.រ</th><th>កាលបរិច្ឆេទ</th><th>ឈ្មោះ (ខ្មែរ)</th><th>ឈ្មោះ (ឡាតាំង)</th><th>ភេទ</th><th>មុខតំណែង / កម្រិតជំនាញ</th><th>កន្លែងធ្វើការ</th><th>ខេត្ត</th><th>លេខទូរស័ព្ទ</th><th>ការប្រជុំ</th></tr></thead><tbody>`;
        allFilteredData.forEach((reg, i) => {
            const meetingTitle = reg.live_meetings ? reg.live_meetings.title : 'Deleted';
            
            const position = (reg.position && reg.position !== 'N/A') ? reg.position : (reg.users?.profile_data?.position || '');
            const workplace = (reg.workplace && reg.workplace !== 'N/A') ? reg.workplace : (reg.users?.profile_data?.workplace || '');
            const province = reg.users?.profile_data?.province || '';
            const nameKhmer = reg.name_khmer || reg.users?.full_name || '';
            const nameLatin = reg.users?.name_latin || reg.name_latin || '';
            const gender = reg.gender === 'Male' ? 'ប្រុស' : reg.gender === 'Female' ? 'ស្រី' : (reg.gender || '');
            
            html += `<tr><td style="text-align:center;">${i + 1}</td><td>${new Date(reg.created_at).toLocaleDateString('km-KH')}</td><td>${escapeHTML(nameKhmer)}</td><td>${escapeHTML(nameLatin)}</td><td>${escapeHTML(gender)}</td><td>${escapeHTML(position)}</td><td>${escapeHTML(workplace)}</td><td>${escapeHTML(province)}</td><td>${escapeHTML(reg.phone || '')}</td><td>${escapeHTML(meetingTitle)}</td></tr>`;
        });
        html += `</tbody></table><script>window.onload=()=>{window.print();}<\/script></body></html>`;
        printWindow.document.write(html);
        printWindow.document.close();
    }

    $: totalPages = Math.ceil(totalRegistrations / itemsPerPage);

    async function loadRegStats() {
        let hasMore = true; let from = 0; const step = 1000;
        let total = 0;
        const gender = {}, position = {}, workplace = {}, province = {}, licenseStatus = {};
        
        while(hasMore) {
            let query = supabase.from('meeting_registrations').select('gender, position, workplace, province, users!inner(profile_data)');
            if (debouncedRegSearch) {
                const safeSearch = debouncedRegSearch.replace(/,/g, ' ').trim();
                query = query.or(`name_khmer.ilike.%${safeSearch}%,name_latin.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`);
            }
            if (meetingFilter) query = query.eq('meeting_id', meetingFilter);
            
            const { data, error } = await query.range(from, from + step - 1);
            if (error || !data || data.length === 0) break;
            
            data.forEach(reg => {
                total++;
                const g = reg.gender === 'Male' ? 'ប្រុស' : reg.gender === 'Female' ? 'ស្រី' : (reg.gender || 'មិនបញ្ជាក់');
                gender[g] = (gender[g] || 0) + 1;
                const pos = (reg.position && reg.position !== 'N/A') ? reg.position : (reg.users?.profile_data?.position || 'មិនបញ្ជាក់');
                position[pos] = (position[pos] || 0) + 1;
                const wp = (reg.workplace && reg.workplace !== 'N/A') ? reg.workplace : (reg.users?.profile_data?.workplace || 'មិនបញ្ជាក់');
                workplace[wp] = (workplace[wp] || 0) + 1;
                const prov = reg.province && reg.province !== 'N/A' ? reg.province : (reg.users?.profile_data?.province || 'មិនបញ្ជាក់');
                province[prov] = (province[prov] || 0) + 1;
                const lic = reg.users?.profile_data?.license_status || 'មិនបញ្ជាក់';
                licenseStatus[lic] = (licenseStatus[lic] || 0) + 1;
            });
            from += step;
            if (data.length < step) hasMore = false;
        }
        regStats = { total, gender, position, workplace, province, licenseStatus };
    }

    function printRegSummaryStats() {
        if (regStats.total === 0) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");
        const printWindow = window.open('', '_blank');
        let html = `<html><head><title>របាយការណ៍សង្ខេបអ្នកចុះឈ្មោះ</title><style>@import url('https://fonts.googleapis.com/css2?family=Nokora:wght@400;700&display=swap');body{font-family:'Nokora',sans-serif;padding:20px;color:#1f2937;}h1{text-align:center;color:#0d9488;margin-bottom:10px;}h2{font-size:16px;margin-top:20px;border-bottom:2px solid #0d9488;padding-bottom:5px;color:#0f766e;line-height:1.4;}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:30px;}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13px;}th,td{border:1px solid #d1d5db;padding:8px;text-align:left;}th{background-color:#f3f4f6;font-weight:bold;}.total-row{font-weight:bold;background-color:#e5e7eb;}.header-info{text-align:center;margin-bottom:30px;font-size:14px;background:#f0fdfa;padding:15px;border-radius:10px;border:1px solid #ccfbf1;}@media print{body{padding:0;}.header-info{border:1px solid #ddd;}}</style></head><body><h1>របាយការណ៍សង្ខេបអ្នកចុះឈ្មោះ</h1><div class="header-info"><p style="margin:0 0 5px 0;">កាលបរិច្ឆេទ Export: ${new Date().toLocaleString('km-KH')}</p><p style="margin:0 0 5px 0;">អ្នកចុះឈ្មោះសរុប: <strong>${regStats.total}</strong></p>${meetingFilter ? `<p style="margin:0;">ការប្រជុំ: <strong>${escapeHTML(uniqueMeetings.find(m => String(m.id) === String(meetingFilter))?.title || '')}</strong></p>` : ''}</div><div class="grid">`;
        const makeTable = (title, dataObj) => {
            let t = `<div><h2>${title}</h2><table><thead><tr><th>ឈ្មោះ</th><th>ចំនួន</th><th>ភាគរយ</th></tr></thead><tbody>`;
            Object.entries(dataObj).sort((a,b) => b[1]-a[1]).forEach(([label, count]) => { t += `<tr><td>${escapeHTML(label)}</td><td>${count}</td><td>${Math.round((count / regStats.total) * 100)}%</td></tr>`; });
            t += `<tr class="total-row"><td>សរុប</td><td>${regStats.total}</td><td>100%</td></tr></tbody></table></div>`;
            return t;
        };
        html += makeTable('ភេទ', regStats.gender) + makeTable('មុខតំណែង / កម្រិតជំនាញ', regStats.position) + makeTable('កន្លែងធ្វើការ', regStats.workplace) + makeTable('រាជធានី/ខេត្ត', regStats.province) + makeTable('ស្ថានភាពអាជ្ញាប័ណ្ណ', regStats.licenseStatus);
        if (formAnswerStats.length > 0) {
            html += `</div><h2 style="text-align:center; color:#0d9488; margin-top:40px; font-size:18px;">📝 ចម្លើយ Form ស្ទង់មតិ</h2><div class="grid">`;
            formAnswerStats.forEach(q => {
                if (Object.keys(q.counts).length > 0) {
                    let t = `<div><h2>${escapeHTML(q.label)}</h2><table><thead><tr><th>ចម្លើយ</th><th>ចំនួន</th><th>ភាគរយ</th></tr></thead><tbody>`;
                    Object.entries(q.counts).sort((a,b) => b[1]-a[1]).forEach(([label, count]) => { t += `<tr><td>${escapeHTML(label)}</td><td>${count}</td><td>${Math.round((count / q.responded) * 100)}%</td></tr>`; });
                    t += `<tr class="total-row"><td>អ្នកឆ្លើយសរុប</td><td>${q.responded}</td><td>100%</td></tr></tbody></table></div>`;
                    html += t;
                }
            });
        }
        html += `</div><script>window.onload=()=>{window.print();}<\/script></body></html>`;
        printWindow.document.write(html);
        printWindow.document.close();
    }

    function exportRegSummaryStatsToExcel() {
        if (regStats.total === 0) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");
        const BOM = "\uFEFF";
        let csvContent = `របាយការណ៍សង្ខេបអ្នកចុះឈ្មោះ\nកាលបរិច្ឆេទ Export:,${new Date().toLocaleString('km-KH')}\nអ្នកចុះឈ្មោះសរុប:,${regStats.total}\n${meetingFilter ? `ការប្រជុំ:,"${(uniqueMeetings.find(m => String(m.id) === String(meetingFilter))?.title || '').replace(/"/g, '""')}"\n` : ''}\n`;
        const appendTable = (title, dataObj, total) => {
            csvContent += `${title},ចំនួន,ភាគរយ\n`;
            Object.entries(dataObj).sort((a,b) => b[1]-a[1]).forEach(([label, count]) => { csvContent += `"${String(label).replace(/"/g, '""')}",${count},${Math.round((count / total) * 100)}%\n`; });
            csvContent += `សរុប,${total},100%\n\n`;
        };
        appendTable('ភេទ', regStats.gender, regStats.total); appendTable('មុខតំណែង / កម្រិតជំនាញ', regStats.position, regStats.total); appendTable('កន្លែងធ្វើការ', regStats.workplace, regStats.total); appendTable('រាជធានី/ខេត្ត', regStats.province, regStats.total); appendTable('ស្ថានភាពអាជ្ញាប័ណ្ណ', regStats.licenseStatus, regStats.total);
        if (formAnswerStats.length > 0) {
            csvContent += `📝 ចម្លើយ Form ស្ទង់មតិ\n\n`;
            formAnswerStats.forEach(q => { if (Object.keys(q.counts).length > 0) appendTable(q.label, q.counts, q.responded); });
        }
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = `registration_stats_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    }

    async function loadFormAnswerStats() {
        formAnswerStats = [];
        if (!meetingFilter) return;
        
        const meetingDef = uniqueMeetings.find(m => String(m.id) === String(meetingFilter));
        const formId = meetingDef?.registration_form_id;
        if (!formId) return;
        
        loadingFormStats = true;
        try {
            const { data: formDef } = await supabase.from('custom_forms').select('fields').eq('id', formId).single();
            if (!formDef) return;
            const questionFields = (formDef.fields || []).filter(f => f.type !== 'section');
            
            let userIds = [];
            let hasMore = true; let from = 0;
            while(hasMore) {
                let q = supabase.from('meeting_registrations').select('user_id').eq('meeting_id', meetingFilter);
                if (debouncedRegSearch) {
                    const safeSearch = debouncedRegSearch.replace(/,/g, ' ').trim();
                    q = q.or(`name_khmer.ilike.%${safeSearch}%,name_latin.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`);
                }
                const {data} = await q.range(from, from+999);
                if(!data || !data.length) break;
                userIds.push(...data.map(d=>d.user_id).filter(Boolean));
                from+=1000;
                if(data.length<1000) hasMore = false;
            }
            
            if (!userIds.length) return;
            
            let allSubs = [];
            for (let i = 0; i < userIds.length; i += 200) {
                const chunk = userIds.slice(i, i + 200);
                const { data: subs } = await supabase.from('custom_form_submissions').select('user_id, data').eq('form_id', formId).in('user_id', chunk);
                if (subs) allSubs = [...allSubs, ...subs];
            }

            if (!allSubs.length) return;
            
            formAnswerStats = questionFields.map(field => {
                const counts = {};
                allSubs.forEach(sub => {
                    const val = sub.data?.[field.label];
                    const values = Array.isArray(val) ? val : [val];
                    values.forEach(v => { const s = String(v ?? '').trim(); if (s && s !== 'undefined') counts[s] = (counts[s] || 0) + 1; });
                });
                return { label: field.label, counts, responded: allSubs.length };
            });
        } finally {
            loadingFormStats = false;
        }
    }
</script>

<div class="card bg-base-100 p-5 shadow-md border border-base-300">
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div><h3 class="font-bold text-xl text-gray-800">📋 បញ្ជីអ្នកចុះឈ្មោះប្រជុំ</h3></div>
        <div class="flex flex-wrap gap-2 w-full md:w-auto justify-end">
            <button on:click={loadRegistrations} class="btn btn-sm btn-primary shadow-sm hover:shadow-md">{#if loadingRegs}<span class="loading loading-spinner loading-xs"></span>{/if} Refresh</button>
            <div class="flex flex-wrap gap-1 bg-base-200/50 p-1 px-2 rounded-lg border border-base-300 items-center">
                <span class="text-xs font-bold text-gray-500 mr-1 hidden lg:inline-block">Export:</span>
                <button on:click={exportToExcel} disabled={isExporting} class="btn btn-xs btn-success text-white shadow-sm" title="ទាញយកជា Excel">
                    {#if isExporting}<span class="loading loading-spinner loading-xs"></span>{/if} 📊 Excel
                </button>
                <button on:click={printRegistrations} disabled={isExporting} class="btn btn-xs btn-warning text-white shadow-sm" title="ព្រីន (Print/PDF)">
                    {#if isExporting}<span class="loading loading-spinner loading-xs"></span>{/if} 🖨️ PDF
                </button>
            </div>
        </div>
    </div>
    
    <div class="bg-base-200/50 p-3 border border-base-300 rounded-xl mb-4 flex flex-col xl:flex-row gap-3 items-start xl:items-center justify-between">
        <div class="flex flex-wrap gap-2 w-full xl:w-auto flex-1 items-center">
            <div class="relative w-full sm:w-auto sm:min-w-[200px]">
                {#if isRegSearching}<span class="absolute left-2.5 top-1/2 -translate-y-1/2 loading loading-spinner loading-xs text-primary"></span>{:else}<span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>{/if}
                <input type="text" bind:value={registrationSearch} on:input={() => isRegSearching = true} placeholder="ស្វែងរកឈ្មោះ ឬលេខទូរស័ព្ទ..." class="input input-sm input-bordered w-full pl-8" />
            </div>
            <select bind:value={meetingFilter} on:change={() => { currentPage = 1; loadRegistrations(); }} class="select select-sm select-bordered w-full sm:w-auto sm:max-w-xs">
                <option value="">📋 ការប្រជុំទាំងអស់</option>
                {#each uniqueMeetings as m}<option value={m.id}>{m.title}</option>{/each}
            </select>
        </div>
    </div>

    <div class="mb-4">
        <div class="flex items-center justify-between mb-2">
            <button class="flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-primary transition-colors" on:click={() => showSummary = !showSummary}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 transition-transform {showSummary ? 'rotate-90' : ''}"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                📊 សង្ខេបទិន្នន័យ ({regStats.total} នាក់)
            </button>
            {#if showSummary}
                <div class="flex gap-2">
                    <button class="btn btn-xs btn-square btn-warning text-white shadow-sm text-base" on:click={printRegSummaryStats} title="ព្រីនតារាងសង្ខេប (Print/PDF)">🖨️</button>
                    <button class="btn btn-xs btn-square btn-success text-white shadow-sm text-base" on:click={exportRegSummaryStatsToExcel} title="ទាញយកតារាងសង្ខេបជា Excel">📊</button>
                </div>
            {/if}
        </div>
        {#if showSummary}
        <div class="space-y-3" in:slide={{ duration: 200 }}>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-center">
                    <div class="text-2xl font-black text-indigo-700">{regStats.total}</div>
                    <div class="text-xs text-indigo-500 font-medium">សរុប</div>
                </div>
                {#each Object.entries(regStats.gender).sort((a,b) => b[1]-a[1]) as [g, n]}
                <div class="rounded-xl p-3 text-center {g === 'ប្រុស' ? 'bg-blue-50 border border-blue-100' : 'bg-pink-50 border border-pink-100'}">
                    <div class="text-2xl font-black {g === 'ប្រុស' ? 'text-blue-700' : 'text-pink-700'}">{n}</div>
                    <div class="text-xs font-medium {g === 'ប្រុស' ? 'text-blue-500' : 'text-pink-500'}">{g}</div>
                </div>
                {/each}
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <div class="bg-violet-50 border border-violet-100 rounded-xl p-3">
                    <div class="text-xs font-bold text-violet-700 mb-2">មុខតំណែង / កម្រិតជំនាញ</div>
                    <div class="space-y-1 max-h-48 overflow-y-auto pr-1">
                        {#each Object.entries(regStats.position).sort((a,b) => b[1]-a[1]) as [label, count]}
                        <div class="flex justify-between items-center gap-2">
                            <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                            <span class="text-xs font-bold text-violet-700 shrink-0">{count}</span>
                            <div class="w-16 bg-violet-100 rounded-full h-1.5 shrink-0"><div class="bg-violet-400 h-1.5 rounded-full" style="width:{Math.round(count/regStats.total*100)}%"></div></div>
                        </div>
                        {/each}
                    </div>
                </div>
                <div class="bg-teal-50 border border-teal-100 rounded-xl p-3">
                    <div class="text-xs font-bold text-teal-700 mb-2">ទីកន្លែងធ្វើការ</div>
                    <div class="space-y-1 max-h-48 overflow-y-auto pr-1">
                        {#each Object.entries(regStats.workplace).sort((a,b) => b[1]-a[1]) as [label, count]}
                        <div class="flex justify-between items-center gap-2">
                            <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                            <span class="text-xs font-bold text-teal-700 shrink-0">{count}</span>
                            <div class="w-16 bg-teal-100 rounded-full h-1.5 shrink-0"><div class="bg-teal-400 h-1.5 rounded-full" style="width:{Math.round(count/regStats.total*100)}%"></div></div>
                        </div>
                        {/each}
                    </div>
                </div>
                <div class="bg-amber-50 border border-amber-100 rounded-xl p-3">
                    <div class="text-xs font-bold text-amber-700 mb-2">រាជធានី/ខេត្ត</div>
                    <div class="space-y-1 max-h-48 overflow-y-auto pr-1">
                        {#each Object.entries(regStats.province).sort((a,b) => b[1]-a[1]) as [label, count]}
                        <div class="flex justify-between items-center gap-2">
                            <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                            <span class="text-xs font-bold text-amber-700 shrink-0">{count}</span>
                            <div class="w-16 bg-amber-100 rounded-full h-1.5 shrink-0"><div class="bg-amber-400 h-1.5 rounded-full" style="width:{Math.round(count/regStats.total*100)}%"></div></div>
                        </div>
                        {/each}
                    </div>
                </div>
                <div class="bg-rose-50 border border-rose-100 rounded-xl p-3">
                    <div class="text-xs font-bold text-rose-700 mb-2">ស្ថានភាពអាជ្ញាប័ណ្ណ</div>
                    <div class="space-y-1 max-h-48 overflow-y-auto pr-1">
                        {#each Object.entries(regStats.licenseStatus).sort((a,b) => b[1]-a[1]) as [label, count]}
                        <div class="flex justify-between items-center gap-2">
                            <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                            <span class="text-xs font-bold text-rose-700 shrink-0">{count}</span>
                            <div class="w-16 bg-rose-100 rounded-full h-1.5 shrink-0"><div class="bg-rose-400 h-1.5 rounded-full" style="width:{Math.round(count/regStats.total*100)}%"></div></div>
                        </div>
                        {/each}
                    </div>
                </div>
            </div>
            {#if meetingFilter}
            <div class="bg-base-200/50 border border-base-300 rounded-xl p-3">
                <div class="text-xs font-bold text-gray-600 mb-2">📝 ចម្លើយ Form</div>
                {#if loadingFormStats}
                    <div class="flex items-center gap-2 text-xs text-gray-400"><span class="loading loading-spinner loading-xs"></span> កំពុងទាញ...</div>
                {:else if formAnswerStats.length === 0}
                    <div class="text-xs text-gray-400 italic">ការប្រជុំនេះមិនមាន Form ចុះឈ្មោះទេ</div>
                {:else}
                    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                        {#each formAnswerStats as q}
                        {#if Object.keys(q.counts).length > 0}
                        <div class="bg-white border border-base-200 rounded-lg p-3">
                            <div class="text-xs font-bold text-gray-700 mb-2 line-clamp-2" title={q.label}>{q.label}</div>
                            <div class="space-y-1 max-h-48 overflow-y-auto pr-1">
                                {#each Object.entries(q.counts).sort((a,b) => b[1]-a[1]) as [ans, cnt]}
                                <div class="flex justify-between items-center gap-2">
                                    <span class="text-xs text-gray-600 truncate flex-1" title={ans}>{ans}</span>
                                    <span class="text-xs font-bold text-primary shrink-0">{cnt}</span>
                                    <div class="w-16 bg-primary/10 rounded-full h-1.5 shrink-0"><div class="bg-primary h-1.5 rounded-full" style="width:{Math.round(cnt/q.responded*100)}%"></div></div>
                                </div>
                                {/each}
                            </div>
                        </div>
                        {/if}
                        {/each}
                    </div>
                {/if}
            </div>
            {/if}
        </div>
        {/if}
    </div>

    <div class="overflow-x-auto bg-base-100 rounded-xl border border-base-300">
        <table class="table table-xs w-full">
            <thead class="bg-base-200 text-base-content">
                <tr>
                    <th>ល.រ</th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleRegSort('created_at')}>កាលបរិច្ឆេទ {regSortColumn === 'created_at' ? (regSortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleRegSort('name')}>ឈ្មោះ (ខ្មែរ/ឡាតាំង) {regSortColumn === 'name' ? (regSortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleRegSort('gender')}>ភេទ {regSortColumn === 'gender' ? (regSortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleRegSort('position')}>ការងារ & អាជ្ញាប័ណ្ណ {regSortColumn === 'position' ? (regSortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleRegSort('province')}>ខេត្ត {regSortColumn === 'province' ? (regSortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleRegSort('phone')}>លេខទូរស័ព្ទ {regSortColumn === 'phone' ? (regSortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleRegSort('meeting')}>ការប្រជុំ {regSortColumn === 'meeting' ? (regSortDirection === 'asc' ? '▲' : '▼') : ''}</th>
                </tr>
            </thead>
            <tbody>
            {#if paginatedRegistrations.length === 0}
                <tr><td colspan="8" class="text-center py-8 text-gray-500">រកមិនឃើញទិន្នន័យ</td></tr>
            {:else}
                {#each paginatedRegistrations as reg, i}
                    <tr class="group hover" in:fade={{ duration: 200, delay: i * 30 }}>
                        <th>{(currentPage - 1) * itemsPerPage + i + 1}</th>
                        <td>{new Date(reg.created_at).toLocaleDateString('km-KH')}</td>
                        <td class="cursor-pointer hover:bg-blue-50 transition-colors rounded-lg" on:click={() => reg.users && dispatch('viewUserProfile', reg.users)} title="មើលប្រវត្តិរូបពេញ">
                            <div class="font-bold">{reg.name_khmer}</div>
                            <div class="text-xs opacity-50">{reg.name_latin}</div>
                        </td>
                        <td>{reg.gender === 'Male' ? 'ប្រុស' : 'ស្រី'}</td>
                        <td>
                            <div class="font-bold text-xs">{(reg.position && reg.position !== 'N/A') ? reg.position : (reg.users?.profile_data?.position || '-')}</div>
                            <div class="text-xs opacity-70">{(reg.workplace && reg.workplace !== 'N/A') ? reg.workplace : (reg.users?.profile_data?.workplace || '-')}</div>
                            {#if reg.users?.profile_data?.license_status}
                                <div class="text-[10px] mt-1 font-mono font-bold {reg.users.profile_data.license_status === 'មាន' ? 'text-success' : reg.users.profile_data.license_status === 'មានតែហួសសុពលភាព' ? 'text-error' : reg.users.profile_data.license_status === 'កំពុងបន្ដ' ? 'text-warning' : 'text-gray-500'}">Lic: {reg.users.profile_data.license_status} {reg.users.profile_data.license_number ? `(${reg.users.profile_data.license_number})` : ''}</div>
                            {/if}
                        </td>
                        <td>{(reg.province && reg.province !== 'N/A') ? reg.province : (reg.users?.profile_data?.province || '-')}</td>
                        <td>{reg.phone}</td>
                        <td>
                            {#if reg.live_meetings}
                                <div class="font-bold text-teal-700">{reg.live_meetings.title}</div>
                                <div class="text-xs">{new Date(reg.live_meetings.scheduled_at).toLocaleDateString('km-KH')}</div>
                            {:else}
                                <span class="text-red-400 italic">ការប្រជុំត្រូវបានលុប</span>
                            {/if}
                        </td>
                    </tr>
                {/each}
            {/if}
            </tbody>
        </table>
    </div>

    <div class="flex flex-col md:flex-row justify-between items-center mt-4 gap-4">
        <div class="text-sm text-gray-500">បង្ហាញ {totalRegistrations > 0 ? ((currentPage - 1) * itemsPerPage) + 1 : 0} ដល់ {Math.min(currentPage * itemsPerPage, totalRegistrations)} នៃ {totalRegistrations}</div>
        <div class="join">
            <button class="join-item btn btn-sm btn-outline" disabled={currentPage === 1} on:click={() => { currentPage--; loadRegistrations(); }}>«</button>
            <button class="join-item btn btn-sm btn-ghost">ទំព័រ {currentPage} / {totalPages || 1}</button>
            <button class="join-item btn btn-sm btn-outline" disabled={currentPage === totalPages || totalPages === 0} on:click={() => { currentPage++; loadRegistrations(); }}>»</button>
        </div>
        <select bind:value={itemsPerPage} on:change={() => { currentPage = 1; loadRegistrations(); }} class="select select-bordered select-sm"><option value={10}>10 / ទំព័រ</option><option value={20}>20 / ទំព័រ</option><option value={50}>50 / ទំព័រ</option><option value={100}>100 / ទំព័រ</option></select>
    </div>
</div>