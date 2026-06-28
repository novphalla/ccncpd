<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    import { XIcon } from 'lucide-svelte';
    import FormAnalytics from '$lib/Components/admin/FormAnalytics.svelte';
    import { handleUpload } from '$lib/utils';

    export let supabase;
    export let currentUser;
    export let loginLogoUrl = '';

    const dispatch = createEventDispatcher();

    let forms = [];
    let loadingForms = false;
    let showFormModal = false;
    let showPreviewFormModal = false;
    let editingForm = { title: '', description: '', fields: [] };
    let viewingSubmissions = null; // formId
    let formSubmissions = [];
    let loadingSubmissions = false;
    let submissionProgressTotal = 0;
    let submissionProgressCurrent = 0;
    let submissionSearch = '';
    let debouncedSubmissionSearch = '';
    let submissionSearchTimeout;
    let isSubmissionSearching = false;

    $: {
        clearTimeout(submissionSearchTimeout);
        submissionSearchTimeout = setTimeout(() => {
            debouncedSubmissionSearch = submissionSearch;
            isSubmissionSearching = false;
        }, 300);
    }
    let submissionPage = 1;
    let submissionPageSize = 10;
    let submissionSortColumn = 'created_at';
    let submissionSortDirection = 'desc';
    let selectedSubmissions = new Set();

    onMount(() => {
        loadForms();
    });

    async function logAdminAction(action, details = '') {
        if (!currentUser?.id) return;
        await supabase.from('admin_logs').insert({
            admin_id: currentUser.id,
            action,
            details
        });
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

    function toggleSubmissionSort(column) {
        if (submissionSortColumn === column) {
            submissionSortDirection = submissionSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            submissionSortColumn = column;
            submissionSortDirection = 'asc';
        }
    }

    $: filteredSubmissions = formSubmissions.filter(sub => {
        const search = debouncedSubmissionSearch.toLowerCase();
        const userName = (sub.users?.full_name || '').toLowerCase();
        const userPhone = (sub.users?.phone_number || '');
        return userName.includes(search) || userPhone.includes(search);
    }).sort((a, b) => {
        let aVal, bVal;
        if (submissionSortColumn === 'created_at') {
             aVal = new Date(a.created_at).getTime();
             bVal = new Date(b.created_at).getTime();
        } else if (submissionSortColumn === 'user') {
             aVal = (a.users?.full_name || '').toLowerCase();
             bVal = (b.users?.full_name || '').toLowerCase();
        } else {
            return 0;
        }
        if (aVal < bVal) return submissionSortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return submissionSortDirection === 'asc' ? 1 : -1;
        return 0;
    });

    $: paginatedSubmissions = filteredSubmissions.slice((submissionPage - 1) * submissionPageSize, submissionPage * submissionPageSize);
    $: totalSubmissionPages = Math.ceil(filteredSubmissions.length / submissionPageSize);

    $: submissionStats = (() => {
        if (!formSubmissions.length) return null;
        const male = formSubmissions.filter(s => s.users?.gender === 'Male').length;
        const female = formSubmissions.filter(s => s.users?.gender === 'Female').length;
        const withLicense = formSubmissions.filter(s => s.users?.profile_data?.license_status === 'មាន').length;
        const provinceCounts = {};
        formSubmissions.forEach(s => {
            const p = s.users?.profile_data?.province || 'មិនបញ្ជាក់';
            provinceCounts[p] = (provinceCounts[p] || 0) + 1;
        });
        const topProvinces = Object.entries(provinceCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

        const positionCounts = {};
        formSubmissions.forEach(s => {
            const p = s.users?.profile_data?.position || 'មិនបញ្ជាក់';
            positionCounts[p] = (positionCounts[p] || 0) + 1;
        });
        const topPositions = Object.entries(positionCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

        const workplaceCounts = {};
        formSubmissions.forEach(s => {
            const w = s.users?.profile_data?.workplace || 'មិនបញ្ជាក់';
            workplaceCounts[w] = (workplaceCounts[w] || 0) + 1;
        });
        const topWorkplaces = Object.entries(workplaceCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

        // Aggregate form field answers
        const currentForm = forms.find(f => f.id === viewingSubmissions);
        const fieldSummaries = [];
        if (currentForm?.fields) {
            const summarizableTypes = ['radio', 'select', 'checkbox', 'scale', 'rating', 'emoji_rating'];
            currentForm.fields.filter(f => summarizableTypes.includes(f.type)).forEach(field => {
                const counts = {};
                if (field.options) field.options.split(',').forEach(opt => { counts[opt.trim()] = 0; });
                if (field.type === 'scale' || field.type === 'rating') [1,2,3,4,5].forEach(n => { counts[String(n)] = 0; });
                if (field.type === 'emoji_rating') ['☺️ ពេញចិត្តខ្លាំង', '😊 ពេញចិត្ត', '😑 អាចទទួលយកបាន', '☹️ មិនពេញចិត្ត', '😡 មិនពេញចិត្តខ្លាំង'].forEach(n => { counts[n] = 0; });
                formSubmissions.forEach(sub => {
                    const val = sub.data?.[field.label];
                    if (Array.isArray(val)) {
                        val.forEach(v => { const k = String(v).trim(); counts[k] = (counts[k] || 0) + 1; });
                    } else if (val != null && val !== '') {
                        const k = String(val).trim();
                        counts[k] = (counts[k] || 0) + 1;
                    }
                });
                const entries = Object.entries(counts).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
                if (entries.length) fieldSummaries.push({ label: field.label, type: field.type, entries, total: formSubmissions.length });
            });
        }

        return { male, female, withLicense, topProvinces, topPositions, topWorkplaces, fieldSummaries };
    })();

    $: { submissionSearch; viewingSubmissions; submissionPageSize; submissionPage = 1; selectedSubmissions = new Set(); }

    function toggleSubmissionSelection(id) {
        if (selectedSubmissions.has(id)) selectedSubmissions.delete(id);
        else selectedSubmissions.add(id);
        selectedSubmissions = selectedSubmissions;
    }

    function toggleSelectAllSubmissions(e) {
        if (e.target.checked) {
            filteredSubmissions.forEach(sub => selectedSubmissions.add(sub.id));
        } else {
            selectedSubmissions.clear();
        }
        selectedSubmissions = selectedSubmissions;
    }

    async function deleteSelectedSubmissions() {
        if (selectedSubmissions.size === 0) return;
        if (!confirm(`តើអ្នកពិតជាចង់លុបចម្លើយចំនួន ${selectedSubmissions.size} នេះមែនទេ?`)) return;

        const ids = Array.from(selectedSubmissions);
        const { error } = await supabase.from('custom_form_submissions').delete().in('id', ids);

        if (error) {
            alert("Error deleting submissions: " + error.message);
        } else {
            alert("បានលុបចម្លើយដែលបានជ្រើសរើសជោគជ័យ!");
            // ដកទិន្នន័យចេញពី UI ភ្លាមៗដោយមិនបាច់រង់ចាំទាញយកថ្មី
            formSubmissions = formSubmissions.filter(sub => !selectedSubmissions.has(sub.id));
            selectedSubmissions.clear();
        }
    }

    function exportSelectedSubmissions() {
        const selected = formSubmissions.filter(sub => selectedSubmissions.has(sub.id));
        const form = forms.find(f => f.id === viewingSubmissions);
        exportDataToExcel(selected, 'selected_submissions', form);
    }

    async function loadForms() {
        loadingForms = true;
        const { data } = await supabase
            .from('custom_forms')
            .select('id, title, description, is_published, is_public_access, expiry_date, created_at, deleted_at')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(500);
        forms = data || [];
        loadingForms = false;
    }

    async function openFormModal(form = null) {
        if (form) {
            // Fetch full form including fields JSONB (not loaded in list view)
            const { data } = await supabase.from('custom_forms').select('*').eq('id', form.id).maybeSingle();
            editingForm = data ? JSON.parse(JSON.stringify(data)) : JSON.parse(JSON.stringify(form));
        } else {
            editingForm = { title: '', description: '', fields: [], is_published: true, is_public_access: false, expiry_date: null };
        }
        if (!editingForm.fields) editingForm.fields = [];
        if (editingForm.expiry_date) {
            editingForm.expiry_date = new Date(editingForm.expiry_date).toISOString().slice(0, 16);
        }
        showFormModal = true;
    }

    function addField() {
        editingForm.fields = [...editingForm.fields, { label: 'សំណួរថ្មី', type: 'text', required: false, options: '', rows: '', minLabel: '', maxLabel: '', allowOther: false, subtitle: '', image_url: '', logic: {}, enableScore: false, scores: {}, correctAnswer: '', correctAnswers: [] }];
    }

    function removeField(index) {
        editingForm.fields = editingForm.fields.filter((_, i) => i !== index);
    }

    function moveField(index, direction) {
        if ((direction === -1 && index === 0) || (direction === 1 && index === editingForm.fields.length - 1)) return;
        const fields = [...editingForm.fields];
        const temp = fields[index];
        fields[index] = fields[index + direction];
        fields[index + direction] = temp;
        editingForm.fields = fields;
    }

    function duplicateField(index) {
        const fieldToCopy = editingForm.fields[index];
        const newField = JSON.parse(JSON.stringify(fieldToCopy));
        editingForm.fields = [
            ...editingForm.fields.slice(0, index + 1),
            newField,
            ...editingForm.fields.slice(index + 1)
        ];
    }

    async function saveForm() {
        if (!editingForm.title) return alert("សូមដាក់ចំណងជើង!");
        for (const field of editingForm.fields) {
            if (['select', 'radio', 'checkbox', 'grid_radio', 'grid_checkbox'].includes(field.type) && !(field.options || '').trim()) {
                return alert(`សំណួរ "${field.label}" ត្រូវការកំណត់ជម្រើស (Options) ជាចាំបាច់!`);
            }
        }

        const formData = { ...editingForm };
        if (!formData.expiry_date) formData.expiry_date = null;

        const { error } = await supabase.from('custom_forms').upsert(formData);
        if (error) alert(error.message);
        else {
            logAdminAction(editingForm.id ? 'Update Form' : 'Create Form', `Form: ${editingForm.title}`);
            showFormModal = false;
            loadForms();
        }
    }

    async function uploadFieldImage(e, index) {
        const file = e.target.files[0];
        if (!file) return;
        if (!['image/jpeg', 'image/png'].includes(file.type)) {
            alert("សូម Upload តែឯកសារប្រភេទ JPG ឬ PNG ប៉ុណ្ណោះ!");
            e.target.value = '';
            return;
        }
        const url = await handleUpload(file, 'form_assets');
        if (url) {
            editingForm.fields[index].image_url = url;
            editingForm = editingForm; 
        }
    }

    async function deleteForm(id) {
        if(!confirm('តើអ្នកពិតជាចង់លុបបែបបទនេះ (ដាក់ក្នុងធុងសំរាម) មែនទេ?')) return;
        const { error } = await supabase
            .from('custom_forms')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', id);
        if (error) return alert('Error moving form to trash: ' + error.message);
        logAdminAction('Soft Delete Form', `Form ID: ${id}`);
        // កាត់ Form ចេញពីបញ្ជីភ្លាមៗដោយមិនបាច់ទាញយកថ្មី
        forms = forms.filter(f => f.id !== id);
    }

    async function duplicateForm(form) {
        if (!confirm(`តើអ្នកពិតជាចង់ចម្លងបែបបទ "${form.title}" ដែរឬទេ?`)) return;

        const newForm = {
            title: `${form.title} (Copy)`,
            description: form.description,
            fields: form.fields,
            is_published: false
        };

        const { error } = await supabase.from('custom_forms').insert(newForm);

        if (error) alert("Error duplicating form: " + error.message);
        else {
            logAdminAction('Duplicate Form', `Form: ${form.title}`);
            loadForms();
        }
    }

    let showQrModal = false;
    let qrCodeUrl = '';
    let qrFormTitle = '';

    async function showFormQrCode(form) {
        try {
            const QRCode = await import('qrcode');
            const link = `${window.location.origin}/?form_id=${form.id}`;
            
            const qrBase64 = await QRCode.toDataURL(link, { 
                width: 400, 
                margin: 2,
                errorCorrectionLevel: 'H'
            });

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const qrImg = new Image();
            const logoImg = new Image();
            logoImg.crossOrigin = "Anonymous";

            qrImg.src = qrBase64;
            await new Promise(r => qrImg.onload = r);

            canvas.width = qrImg.width;
            canvas.height = qrImg.height;
            ctx.drawImage(qrImg, 0, 0);

            logoImg.src = loginLogoUrl || '/ccn-logo.png';
            await new Promise(resolve => {
                logoImg.onload = () => {
                    const logoSize = canvas.width * 0.22;
                    const center = (canvas.width - logoSize) / 2;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(center - 2, center - 2, logoSize + 4, logoSize + 4);
                    ctx.drawImage(logoImg, center, center, logoSize, logoSize);
                    resolve();
                };
                logoImg.onerror = resolve; 
            });

            qrCodeUrl = canvas.toDataURL();
            qrFormTitle = form.title;
            showQrModal = true;
        } catch (e) {
            console.error(e);
            alert("Error generating QR Code");
        }
    }

    function printQrCode() {
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
            <head>
                <title>${qrFormTitle}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Nokora:wght@400;700&display=swap');
                    body { font-family: 'Nokora', sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
                    h1 { margin-bottom: 20px; text-align: center; font-size: 28px; }
                    img { width: 400px; height: 400px; }
                    p { margin-top: 20px; color: #666; font-size: 18px; }
                </style>
            </head>
            <body>
                <h1>${qrFormTitle}</h1>
                <img src="${qrCodeUrl}" />
                <p>ស្កេនដើម្បីបំពេញបែបបទ</p>
                <script>window.onload = () => { window.print(); }<\/script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }

    async function loadFormSubmissions(formId) {
        viewingSubmissions = formId;
        loadingSubmissions = true;
        formSubmissions = []; // សម្អាតទិន្នន័យចាស់ចេញពី UI ជាមុនសិន
        submissionProgressTotal = 0;
        submissionProgressCurrent = 0;

        // ទាញយកចំនួនសរុបជាមុន ដើម្បីយកមកធ្វើ Progress Bar
        const { count } = await supabase
            .from('custom_form_submissions')
            .select('id', { count: 'exact', head: true })
            .eq('form_id', formId);
        submissionProgressTotal = count || 0;

        let allData = [];
        let hasMore = true;
        let from = 0;
        const step = 1000;
        
        while (hasMore) {
            const { data, error } = await supabase
                .from('custom_form_submissions')
                .select('*, users(full_name, phone_number, name_latin, gender, profile_data, avatar_url)')
                .eq('form_id', formId)
                .order('created_at', { ascending: false })
                .range(from, from + step - 1);
                
            if (error) break;
            if (data && data.length > 0) {
                allData.push(...data);
                submissionProgressCurrent = allData.length;
                from += step;
                if (data.length < step) hasMore = false;
            } else {
                hasMore = false;
            }
        }
        formSubmissions = allData;
        loadingSubmissions = false;
    }

    function exportFormSubmissionsToExcel() {
        const form = forms.find(f => f.id === viewingSubmissions);
        exportDataToExcel(formSubmissions, 'form_submissions', form);
    }

    function exportDataToExcel(data, filenamePrefix, form = null) {
        if (!data.length) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");

        let orderedKeys;
        if (form?.fields?.length) {
            orderedKeys = form.fields
                .filter(f => f.type !== 'section')
                .map(f => f.label);
        } else {
            const dataKeys = new Set();
            data.forEach(sub => {
                if (sub.data) {
                    Object.keys(sub.data).filter(k => k !== '_score').forEach(k => dataKeys.add(k));
                }
            });
            orderedKeys = Array.from(dataKeys);
        }

        const profileHeaders = ['ល.រ', 'កាលបរិច្ឆេទ', 'ឈ្មោះខ្មែរ', 'ឈ្មោះឡាតាំង', 'ភេទ', 'តួនាទី', 'ទីកន្លែងធ្វើការ', 'រាជធានី/ខេត្ត', 'ស្ថានភាពអាជ្ញាប័ណ្ណ', 'លេខទូរស័ព្ទ'];
        const headers = [...profileHeaders, ...orderedKeys];
        const rows = data.map((sub, index) => {
            const u = sub.users;
            const gender = u?.gender === 'Male' ? 'ប្រុស' : u?.gender === 'Female' ? 'ស្រី' : (u?.gender || '');
            const licenseStatus = u?.profile_data?.license_status || '';
            const licenseNumber = u?.profile_data?.license_number || '';
            const licenseCell = licenseStatus === 'មាន' && licenseNumber
                ? `${licenseStatus} (${licenseNumber})`
                : licenseStatus;
            const rowData = [
                index + 1,
                new Date(sub.created_at).toLocaleDateString('km-KH'),
                `"${(u?.full_name || 'អនាមិក').replace(/"/g, '""')}"`,
                `"${(u?.name_latin || '').replace(/"/g, '""')}"`,
                `"${gender}"`,
                `"${(u?.profile_data?.position || '').replace(/"/g, '""')}"`,
                `"${(u?.profile_data?.workplace || '').replace(/"/g, '""')}"`,
                `"${(u?.profile_data?.province || '').replace(/"/g, '""')}"`,
                `"${licenseCell.replace(/"/g, '""')}"`,
                `"${(u?.phone_number || '').replace(/"/g, '""')}"`
            ];

            orderedKeys.forEach(key => {
                const val = sub.data ? sub.data[key] : '';
                const strVal = Array.isArray(val) ? val.join(', ') : String(val ?? '');
                rowData.push(`"${strVal.replace(/"/g, '""')}"`);
            });

            return rowData.join(',');
        });

        downloadCSV(`${filenamePrefix}_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    }

    function printSubmissionStats() {
        if (!submissionStats || !formSubmissions.length) return alert("គ្មានទិន្នន័យសម្រាប់ព្រីនទេ");
        
        const formTitle = forms.find(f => f.id === viewingSubmissions)?.title || 'Form Analytics';
        const printWindow = window.open('', '_blank');
        
        let html = `
            <html>
            <head>
                <title>របាយការណ៍ស្ថិតិ - ${formTitle}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Nokora:wght@400;700&display=swap');
                    body { font-family: 'Nokora', sans-serif; padding: 20px; max-width: 900px; margin: 0 auto; color: #1f2937; }
                    h1 { text-align: center; color: #0d9488; margin-bottom: 5px; }
                    h2 { font-size: 16px; margin-top: 20px; border-bottom: 2px solid #0d9488; padding-bottom: 5px; color: #0f766e; }
                    .header-info { text-align: center; margin-bottom: 30px; font-size: 14px; background: #f0fdfa; padding: 15px; border-radius: 10px; border: 1px solid #ccfbf1; }
                    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
                    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
                    th { background-color: #f3f4f6; font-weight: bold; }
                    .total-row { font-weight: bold; background-color: #e5e7eb; }
                    @media print { body { padding: 0; } .header-info { border: 1px solid #ddd; } }
                </style>
            </head>
            <body>
                <h1>របាយការណ៍ស្ថិតិ</h1>
                <div class="header-info">
                    <p style="margin:0 0 5px 0;">បែបបទ: <strong>${formTitle}</strong></p>
                    <p style="margin:0 0 5px 0;">កាលបរិច្ឆេទ Export: ${new Date().toLocaleString('km-KH')}</p>
                    <p style="margin:0;">អ្នកឆ្លើយសរុប: <strong>${formSubmissions.length}</strong> នាក់</p>
                </div>
                <div class="grid">
        `;

        const makeTable = (title, dataArray, total) => {
            if (!dataArray || !dataArray.length) return '';
            let t = `<div><h2>${title}</h2><table><thead><tr><th>ឈ្មោះ</th><th>ចំនួន</th><th>ភាគរយ</th></tr></thead><tbody>`;
            dataArray.forEach(([label, count]) => {
                t += `<tr><td>${label}</td><td>${count}</td><td>${Math.round((count / total) * 100)}%</td></tr>`;
            });
            t += `<tr class="total-row"><td>សរុប</td><td>${total}</td><td>100%</td></tr></tbody></table></div>`;
            return t;
        };

        html += makeTable('ភេទ', [['ប្រុស', submissionStats.male], ['ស្រី', submissionStats.female]], formSubmissions.length);
        html += makeTable('ស្ថានភាពអាជ្ញាប័ណ្ណ', [['មាន', submissionStats.withLicense], ['គ្មាន/ផ្សេងៗ', formSubmissions.length - submissionStats.withLicense]], formSubmissions.length);
        html += makeTable('រាជធានី/ខេត្ត', submissionStats.topProvinces, formSubmissions.length);
        html += makeTable('តួនាទី', submissionStats.topPositions, formSubmissions.length);
        html += makeTable('កន្លែងធ្វើការ', submissionStats.topWorkplaces, formSubmissions.length);
        html += `</div>`;

        if (submissionStats.fieldSummaries && submissionStats.fieldSummaries.length) {
            html += `<h2 style="text-align:center; color:#0d9488; margin-top:40px; font-size:18px;">📝 ចម្លើយ Form ស្ទង់មតិ</h2><div class="grid">`;
            submissionStats.fieldSummaries.forEach(field => {
                html += makeTable(field.label, field.entries, field.total);
            });
            html += `</div>`;
        }

        html += `</div><script>window.onload = () => { window.print(); }<\/script></body></html>`;

        printWindow.document.write(html);
        printWindow.document.close();
    }

    function copyFormLink(id) {
        const link = `${window.location.origin}/?form_id=${id}`;
        navigator.clipboard.writeText(link).then(() => alert("បានចម្លងតំណភ្ជាប់! ផ្ញើ Link នេះទៅអ្នកដែលត្រូវបំពេញ។"));
    }

    let showChartsModal = false;

    async function openChartsModal() {
        if (!formSubmissions.length) return alert("គ្មានទិន្នន័យសម្រាប់បង្ហាញទេ");
        showChartsModal = true;
    }

    function printSubmission(sub) {
        const printWindow = window.open('', '_blank');
        const formTitle = forms.find(f => f.id === viewingSubmissions)?.title || 'Form Submission';
        
        let html = `
            <html>
            <head>
                <title>${formTitle} - ${sub.users?.full_name || 'Anonymous'}</title>
                <style>
                    body { font-family: 'Nokora', sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
                    h1 { text-align: center; color: #0d9488; margin-bottom: 5px; }
                    .meta { margin-bottom: 20px; border-bottom: 2px solid #eee; padding-bottom: 15px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
                    .field { margin-bottom: 15px; page-break-inside: avoid; }
                    .label { font-weight: bold; display: block; margin-bottom: 5px; color: #374151; }
                    .value { background: #f9fafb; padding: 10px; border-radius: 5px; border: 1px solid #e5e7eb; white-space: pre-wrap; }
                    @media print { body { padding: 0; } .value { border: 1px solid #ddd; } }
                </style>
            </head>
            <body>
                <h1>${formTitle}</h1>
                <div class="meta">
                    <div><strong>អ្នកឆ្លើយ:</strong> ${sub.users?.full_name || 'អនាមិក'} ${sub.users?.name_latin ? `(${sub.users.name_latin})` : ''}</div>
                    <div><strong>លេខទូរស័ព្ទ:</strong> ${sub.users?.phone_number || '-'}</div>
                    <div><strong>កាលបរិច្ឆេទ:</strong> ${new Date(sub.created_at).toLocaleString('km-KH')}</div>
                </div>
                <div class="content">
        `;

        if (sub.data) {
            Object.entries(sub.data).forEach(([key, value]) => {
                if (key !== '_score') {
                    html += `<div class="field"><span class="label">${key}</span><div class="value">${Array.isArray(value) ? value.join(', ') : (value || '-')}</div></div>`;
                }
            });
            if (sub.data._score !== undefined) {
                 html += `<div class="field"><span class="label">ពិន្ទុ (Score)</span><div class="value"><strong>${sub.data._score}</strong></div></div>`;
            }
        }

        html += `</div><script>window.onload = () => { window.print(); }<\/script></body></html>`;

        printWindow.document.write(html);
        printWindow.document.close();
    }
</script>

<script context="module">
    function draggable(node) {
        let startX, startY, initialLeft, initialTop;
        const modalBox = node.closest('.modal-box');
        if (!modalBox) return;
        function onMouseDown(e) {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'INPUT') return;
            startX = e.clientX;
            startY = e.clientY;
            const style = window.getComputedStyle(modalBox);
            const matrix = new DOMMatrix(style.transform);
            initialLeft = matrix.m41;
            initialTop = matrix.m42;
            modalBox.style.transition = 'none';
            modalBox.style.animation = 'none';
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
            node.style.cursor = 'grabbing';
        }
        function onMouseMove(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            modalBox.style.transform = `translate(${initialLeft + dx}px, ${initialTop + dy}px)`;
        }
        function onMouseUp() {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            node.style.cursor = 'grab';
        }
        node.style.cursor = 'grab';
        node.addEventListener('mousedown', onMouseDown);
        return { 
            destroy() { 
                node.removeEventListener('mousedown', onMouseDown); 
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            } 
        };
    }
</script>

{#if viewingSubmissions}
    <div class="card bg-base-100 p-5 shadow-md border border-base-300">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
            <button on:click={() => viewingSubmissions = null} class="flex items-center gap-1 mb-1 pl-0 px-2 py-1 rounded hover:bg-gray-100 cursor-pointer border-0 outline-none bg-transparent" style="color: #4b5563;">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
                ត្រឡប់ក្រោយ
            </button>
            <h3 class="text-xl font-bold text-gray-800">
                ចម្លើយអ្នកចូលរួម <span class="badge badge-primary badge-outline ml-2">{filteredSubmissions.length}</span>
            </h3>
            <p class="text-sm text-gray-500 mt-1">សម្រាប់បែបបទ: <span class="font-semibold text-primary">{forms.find(f => f.id === viewingSubmissions)?.title}</span></p>
        </div>
        <div class="flex flex-wrap gap-2 w-full md:w-auto justify-end items-center">
            <button on:click={openChartsModal} class="btn btn-sm btn-info text-white shadow-sm hover:shadow-md" disabled={loadingSubmissions}>📈 ក្រាហ្វិក</button>
            <div class="flex flex-wrap gap-1 bg-base-200/50 p-1 px-2 rounded-lg border border-base-300 items-center">
                <span class="text-xs font-bold text-gray-500 mr-1 hidden lg:inline-block">Export:</span>
                <button on:click={printSubmissionStats} class="btn btn-xs btn-warning text-white shadow-sm" title="ព្រីន (Print/PDF)" disabled={loadingSubmissions}>🖨️ PDF</button>
                <button on:click={exportFormSubmissionsToExcel} class="btn btn-xs btn-success text-white shadow-sm" title="ទាញយកជា Excel" disabled={loadingSubmissions}>📊 Excel</button>
            </div>
        </div>
    </div>

    <div class="bg-base-200/50 p-3 border border-base-300 rounded-xl mb-4 flex flex-col xl:flex-row gap-3 items-start xl:items-center justify-between">
        <div class="flex flex-wrap gap-2 w-full xl:w-auto flex-1 items-center">
            <div class="relative w-full sm:w-auto sm:min-w-[200px]">
                {#if isSubmissionSearching}
                    <span class="absolute left-2.5 top-1/2 -translate-y-1/2 loading loading-spinner loading-xs text-primary"></span>
                {:else}
                    <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
                {/if}
                <input type="text" bind:value={submissionSearch} on:input={() => isSubmissionSearching = true} placeholder="ស្វែងរកឈ្មោះ ឬលេខទូរស័ព្ទ..." class="input input-sm input-bordered w-full pl-8" disabled={loadingSubmissions} />
            </div>
        </div>
        {#if selectedSubmissions.size > 0}
            <div class="flex gap-2 items-center bg-base-200/50 p-1 px-2 rounded-lg border border-base-300 shrink-0">
                <button class="btn btn-xs btn-success text-white shadow-sm hover:shadow-md" on:click={exportSelectedSubmissions}>📊 Export ({selectedSubmissions.size})</button>
                <button class="btn btn-xs btn-error text-white shadow-sm hover:shadow-md animate-pulse" on:click={deleteSelectedSubmissions}>🗑️ លុប ({selectedSubmissions.size})</button>
            </div>
        {/if}
    </div>

    {#if loadingSubmissions}
        <div class="flex flex-col items-center justify-center py-24 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200 my-6">
            <span class="loading loading-spinner loading-lg text-primary mb-4"></span>
            <h3 class="text-lg font-bold text-gray-700">កំពុងទាញយកទិន្នន័យ...</h3>
            {#if submissionProgressTotal > 0}
                <div class="w-full max-w-md mt-4 px-4">
                    <div class="flex justify-between text-xs font-bold text-gray-500 mb-1">
                        <span>{submissionProgressCurrent} / {submissionProgressTotal} ចម្លើយ</span>
                        <span class="text-primary">{Math.round((submissionProgressCurrent / submissionProgressTotal) * 100)}%</span>
                    </div>
                    <progress class="progress progress-primary w-full" value={submissionProgressCurrent} max={submissionProgressTotal}></progress>
                </div>
            {:else}
                <p class="text-sm text-gray-500 mt-2">សូមរង់ចាំបន្តិច ប្រព័ន្ធកំពុងទាញយកចម្លើយទាំងអស់របស់អ្នកចូលរួម។</p>
            {/if}
        </div>
    {:else}
        <!-- Summary Stats -->
        {#if submissionStats}
        <div class="grid grid-cols-3 gap-3 mb-4">
            <div class="bg-primary/5 border border-primary/20 rounded-xl p-3 text-center">
                <div class="text-2xl font-bold text-primary">{formSubmissions.length}</div>
                <div class="text-xs text-gray-500 mt-0.5">ចំលើយសរុប</div>
            </div>
            <div class="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                <div class="flex justify-center gap-3 text-lg font-bold">
                    <span class="text-blue-600">{submissionStats.male}♂</span>
                    <span class="text-pink-500">{submissionStats.female}♀</span>
                </div>
                <div class="text-xs text-gray-500 mt-0.5">ប្រុស / ស្រី</div>
            </div>
            <div class="bg-green-50 border border-green-100 rounded-xl p-3 text-center">
                <div class="text-lg font-bold text-green-600">{submissionStats.withLicense} <span class="text-xs font-normal text-gray-400">/ {formSubmissions.length - submissionStats.withLicense}</span></div>
                <div class="text-xs text-gray-500 mt-0.5">មានអជ្ញាប័ណ្ណ / គ្មាន</div>
            </div>
        </div>
        <div class="bg-gray-50 rounded-xl border border-gray-200 p-3 mb-4">
            <div class="text-xs font-bold text-gray-500 mb-2">រាជធានី/ខេត្ត</div>
            <div class="flex flex-wrap gap-2">
                {#each submissionStats.topProvinces as [province, count]}
                    <span class="badge badge-ghost badge-sm border border-gray-300 gap-1">
                        {province} <strong class="text-primary">{count}</strong>
                    </span>
                {/each}
            </div>
        </div>
        <div class="grid grid-cols-2 gap-3 mb-4">
            <div class="bg-gray-50 rounded-xl border border-gray-200 p-3">
                <div class="text-xs font-bold text-gray-500 mb-2">តួនាទី</div>
                <div class="flex flex-wrap gap-1.5">
                    {#each submissionStats.topPositions as [pos, count]}
                        <span class="badge badge-ghost badge-sm border border-gray-300 gap-1">
                            {pos} <strong class="text-primary">{count}</strong>
                        </span>
                    {/each}
                </div>
            </div>
            <div class="bg-gray-50 rounded-xl border border-gray-200 p-3">
                <div class="text-xs font-bold text-gray-500 mb-2">ទីកន្លែងធ្វើការ</div>
                <div class="flex flex-wrap gap-1.5">
                    {#each submissionStats.topWorkplaces as [wp, count]}
                        <span class="badge badge-ghost badge-sm border border-gray-300 gap-1">
                            {wp} <strong class="text-primary">{count}</strong>
                        </span>
                    {/each}
                </div>
            </div>
        </div>
        {/if}

        <!-- Field Answer Summaries -->
        {#if submissionStats?.fieldSummaries?.length}
        <div class="space-y-3 mb-4">
            <div class="text-xs font-bold text-gray-500">សង្ខេបចំលើយ</div>
            {#each submissionStats.fieldSummaries as field}
            <div class="bg-white border border-gray-200 rounded-xl p-3">
                <div class="text-sm font-bold text-gray-700 mb-2">{field.label}</div>
                <div class="space-y-1.5">
                    {#each field.entries as [option, count]}
                    <div class="flex items-center gap-2 text-xs">
                        <span class="text-gray-600 w-40 shrink-0 truncate" title={option}>{option}</span>
                        <div class="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                            <div class="bg-primary h-full rounded-full transition-all" style="width: {Math.round(count / field.total * 100)}%"></div>
                        </div>
                        <span class="text-gray-500 shrink-0 w-14 text-right">{count} ({Math.round(count / field.total * 100)}%)</span>
                    </div>
                    {/each}
                </div>
            </div>
            {/each}
        </div>
        {/if}

        <div class="overflow-x-auto bg-base-100 rounded-xl border border-base-300">
        <table class="table table-xs w-full">
                <thead class="bg-base-200 text-base-content uppercase text-xs font-bold">
                <tr>
                    <th class="w-10">
                        <label>
                            <input type="checkbox" class="checkbox checkbox-xs" 
                                checked={filteredSubmissions.length > 0 && selectedSubmissions.size === filteredSubmissions.length} 
                                on:change={toggleSelectAllSubmissions} />
                        </label>
                    </th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleSubmissionSort('created_at')}>
                        កាលបរិច្ឆេទ {submissionSortColumn === 'created_at' ? (submissionSortDirection === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleSubmissionSort('user')}>
                        អ្នកឆ្លើយ {submissionSortColumn === 'user' ? (submissionSortDirection === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th>ទិន្នន័យ (JSON)</th>
                    <th class="text-right">សកម្មភាព</th>
                </tr>
            </thead>
            <tbody>
                {#if paginatedSubmissions.length === 0}
                    <tr><td colspan="5" class="text-center py-8 text-gray-500">រកមិនឃើញទិន្នន័យ</td></tr>
                {:else}
                    {#each paginatedSubmissions as sub, i}
                            <tr class="group hover border-b border-base-200 last:border-none transition-colors" class:bg-blue-50={selectedSubmissions.has(sub.id)} in:fade={{ duration: 200, delay: i * 30 }}>
                            <td>
                                <label>
                                    <input type="checkbox" class="checkbox checkbox-xs" 
                                        checked={selectedSubmissions.has(sub.id)} 
                                        on:change={() => toggleSubmissionSelection(sub.id)} />
                                </label>
                            </td>
                            <td class="text-xs text-gray-500 font-mono">
                                <div>{new Date(sub.created_at).toLocaleDateString('km-KH')}</div>
                                <div class="text-[10px]">{new Date(sub.created_at).toLocaleTimeString('km-KH')}</div>
                            </td>
                        <td class="cursor-pointer hover:bg-blue-50 transition-colors rounded-lg" on:click={() => { if (sub.users) dispatch('viewUserProfile', sub.users); }} title="មើលប្រវត្តិរូបពេញ">
                            {#if sub.users}
                                <div class="font-bold text-gray-800">{sub.users.full_name}</div>
                                <div class="text-xs text-gray-500">{sub.users.name_latin || ''} • {sub.users.phone_number || ''}</div>
                                {#if sub.users.profile_data?.province}
                                    <div class="text-[10px] text-gray-400 mt-0.5">📍 {sub.users.profile_data.province}</div>
                                {/if}
                            {:else}
                                <span class="text-gray-400 italic">អនាមិក</span>
                            {/if}
                        </td>
                        <td>
                                <div class="max-w-md max-h-20 overflow-y-auto text-[10px] font-mono bg-base-200/50 p-2 rounded border border-base-300">
                                {JSON.stringify(sub.data, null, 2)}
                            </div>
                        </td>
                        <td class="text-right">
                            <button class="btn btn-xs btn-outline" on:click={() => printSubmission(sub)}>🖨️ PDF</button>
                        </td>
                    </tr>
                    {/each}
                {/if}
            </tbody>
        </table>
    </div>

        <div class="flex flex-col md:flex-row justify-between items-center mt-4 gap-4">
        <div class="text-sm text-gray-500">
            បង្ហាញ {filteredSubmissions.length > 0 ? ((submissionPage - 1) * submissionPageSize) + 1 : 0} ដល់ {Math.min(submissionPage * submissionPageSize, filteredSubmissions.length)} នៃ {filteredSubmissions.length}
        </div>
        <div class="join">
                <button class="join-item btn btn-sm btn-outline" disabled={submissionPage === 1} on:click={() => submissionPage--}>«</button>
                <button class="join-item btn btn-sm btn-ghost">ទំព័រ {submissionPage} / {totalSubmissionPages || 1}</button>
                <button class="join-item btn btn-sm btn-outline" disabled={submissionPage === totalSubmissionPages || totalSubmissionPages === 0} on:click={() => submissionPage++}>»</button>
        </div>
            <select bind:value={submissionPageSize} class="select select-bordered select-sm">
            <option value={10}>10 / ទំព័រ</option>
            <option value={20}>20 / ទំព័រ</option>
            <option value={50}>50 / ទំព័រ</option>
            <option value={100}>100 / ទំព័រ</option>
        </select>
    </div>
    {/if}
    </div>
    <!-- Charts Modal -->
    {#if showChartsModal}
        <div class="modal modal-open bg-black/60" transition:fade={{ duration: 200 }}>
            <div class="modal-box w-11/12 max-w-6xl p-0 overflow-hidden rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
                <div class="flex justify-between items-center p-4 border-b border-base-300 bg-base-200 shrink-0" use:draggable>
                    <h3 class="font-bold text-lg">ក្រាហ្វិកសង្ខេបចម្លើយ</h3>
                    <button on:click={() => showChartsModal = false} class="rounded-full w-8 h-8 hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none text-gray-500"><XIcon class="w-4 h-4" /></button>
                </div>
                
                <div class="p-4 overflow-y-auto flex-1 min-h-0">
                    <FormAnalytics 
                        form={forms.find(f => f.id === viewingSubmissions)} 
                        submissions={formSubmissions} 
                    />
                </div>
            </div>
        </div>
    {/if}
{:else}
    <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold">បញ្ជីបែបបទ</h2>
        <button on:click={() => openFormModal()} class="btn btn-primary btn-sm">+ បង្កើតថ្មី</button>
    </div>
    <div class="grid gap-4">
        {#each forms as form}
            <div class="card bg-base-100 p-4 shadow-md border border-base-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div class="w-full md:w-auto">
                    <div class="flex items-center gap-2">
                        <h3 class="font-bold text-lg">{form.title}</h3>
                        {#if form.is_published === false}
                            <span class="badge badge-sm badge-warning">Draft</span>
                        {/if}
                    </div>
                    <p class="text-sm text-gray-500">{form.description || 'គ្មានការពិពណ៌នា'}</p>
                    <div class="text-xs text-gray-400 mt-2 flex items-center gap-1">👁️ {form.view_count || 0} views</div>
                </div>
                <div class="flex flex-wrap gap-2 items-center w-full md:w-auto justify-start md:justify-end">
                    <label class="cursor-pointer label p-0 mr-2">
                        <span class="label-text text-xs mr-1">ផ្សាយ</span> 
                        <input type="checkbox" class="toggle toggle-xs toggle-success" checked={form.is_published !== false} 
                            on:change={async (e) => {
                                await supabase.from('custom_forms').update({ is_published: e.target.checked }).eq('id', form.id);
                                loadForms();
                            }} />
                    </label>
                    <div class="dropdown dropdown-end">
                        <div tabindex="0" role="button" class="btn btn-sm btn-ghost text-xl">⋮</div>
                        <ul tabindex="0" class="dropdown-content z-10 menu p-2 shadow bg-white rounded-box w-52 border border-gray-100">
                            <li>
                                <button on:click={() => copyFormLink(form.id)}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" /></svg>
                                    Copy Link
                                </button>
                            </li>
                            <li>
                                <button on:click={() => showFormQrCode(form)}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" /><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75zM16.5 19.5h.75v.75h-.75v-.75zM19.5 16.5h.75v.75h-.75v-.75z" /></svg>
                                    QR Code
                                </button>
                            </li>
                            <li>
                                <button on:click={() => loadFormSubmissions(form.id)}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                    មើលចម្លើយ
                                </button>
                            </li>
                            <li>
                                <button on:click={() => duplicateForm(form)}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" /></svg>
                                    ចម្លង
                                </button>
                            </li>
                            <li>
                                <button on:click={() => openFormModal(form)}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                    កែប្រែ
                                </button>
                            </li>
                            <li>
                                <button on:click={() => deleteForm(form.id)} class="text-error">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                    លុប
                                </button>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        {/each}
    </div>

    <!-- Form Editor Modal -->
    {#if showFormModal}
        <div class="modal modal-open bg-black/60" transition:fade={{ duration: 200 }}>
            <div class="modal-box w-11/12 max-w-3xl p-0 overflow-hidden rounded-2xl flex flex-col max-h-[90vh] shadow-2xl">
                <div class="p-6 overflow-y-auto flex-1 min-h-0" use:draggable>
                    <h3 class="font-bold text-lg mb-4">បង្កើត/កែប្រែ បែបបទ</h3>
                    <div class="form-control w-full mb-2">
                        <label class="label">ចំណងជើង</label>
                        <input bind:value={editingForm.title} class="input input-bordered w-full" placeholder="ឈ្មោះ Form" />
                    </div>
                    <div class="form-control w-full mb-4">
                        <label class="label">ការពិពណ៌នា</label>
                        <textarea bind:value={editingForm.description} class="textarea textarea-bordered w-full" placeholder="ពន្យល់បន្ថែម..."></textarea>
                        <label class="label cursor-pointer justify-start gap-2 mt-2">
                            <input type="checkbox" bind:checked={editingForm.is_public_access} class="checkbox checkbox-primary" />
                            <span class="label-text font-bold text-gray-700">អនុញ្ញាតឱ្យបំពេញដោយមិនចាំបាច់ Login (Public Form)</span>
                        </label>
                        <div class="form-control w-full mt-2">
                            <label class="label"><span class="label-text font-bold text-gray-700">កាលបរិច្ឆេទផុតកំណត់ (Expiry Date)</span></label>
                            <input type="datetime-local" bind:value={editingForm.expiry_date} class="input input-bordered w-full" />
                            <label class="label">
                                <span class="label-text-alt text-gray-500">ទុកចោលបើមិនចង់កំណត់ (Optional)</span>
                            </label>
                        </div>
                    </div>
                    
                    <div class="divider">សំណួរ (Fields)</div>
                    {#each editingForm.fields as field, i}
                    <div class="bg-base-200/50 p-3 rounded-lg mb-2 border border-base-300 relative">
                        <div class="absolute top-2 right-2 flex gap-0.5">
                            <button on:click={() => moveField(i, -1)} class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-base-300 text-gray-500 disabled:opacity-30 transition-colors" disabled={i === 0} title="Move Up">▲</button>
                            <button on:click={() => moveField(i, 1)} class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-base-300 text-gray-500 disabled:opacity-30 transition-colors" disabled={i === editingForm.fields.length - 1} title="Move Down">▼</button>
                            <button on:click={() => duplicateField(i)} class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-base-300 text-gray-500 transition-colors" title="Duplicate">📋</button>
                            <button on:click={() => removeField(i)} class="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-100 text-red-500 transition-colors" title="Remove">✕</button>
                        </div>
                        <div class="grid grid-cols-2 gap-2 pr-[120px]">
                            <input bind:value={field.label} class="input input-sm input-bordered" placeholder="សរសេរសំណួរ..." />
                            <select bind:value={field.type} class="select select-sm select-bordered">
                                <option value="text">អក្សរខ្លី (Text)</option>
                                <option value="section">ផ្នែក (Section Header)</option>
                                <option value="textarea">អក្សរវែង (Paragraph)</option>
                                <option value="number">លេខ (Number)</option>
                                <option value="date">កាលបរិច្ឆេទ (Date)</option>
                                <option value="time">ម៉ោង (Time)</option>
                                <option value="select">ជម្រើស (Dropdown)</option>
                                <option value="radio">Multiple Choice</option>
                                <option value="checkbox">Checkboxes</option>
                                <option value="scale">Linear Scale</option>
                                <option value="rating">Rating (ផ្កាយ)</option>
                                <option value="emoji_rating">Emoji Rating (ពេញចិត្ត)</option>
                                <option value="grid_radio">Multiple-choice Grid</option>
                                <option value="grid_checkbox">Tick box Grid</option>
                            </select>
                        </div>
                        
                        <!-- Subtitle & Image Upload -->
                        <input bind:value={field.subtitle} class="input input-xs input-bordered w-full mt-2" placeholder="ការពិពណ៌នាបន្ថែម (Subtitle)..." />
                        
                        {#if field.type !== 'section'}
                            <div class="mt-2">
                                {#if field.image_url}
                                    <div class="relative inline-block">
                                        <img src={field.image_url} alt="Question" class="h-20 rounded border object-cover" />
                                        <button class="btn btn-xs btn-circle btn-error absolute -top-2 -right-2 text-white" on:click={() => field.image_url = ''}><XIcon class="w-3 h-3" /></button>
                                    </div>
                                {:else}
                                    <label class="btn btn-xs btn-outline gap-1"><span class="text-lg">🖼️</span> បន្ថែមរូបភាព <input type="file" class="hidden" accept=".jpg,.jpeg,.png" on:change={(e) => uploadFieldImage(e, i)} /></label>
                                {/if}
                            </div>
                        {/if}

                        {#if ['select', 'radio', 'checkbox', 'grid_radio', 'grid_checkbox'].includes(field.type)}
                            <input bind:value={field.options} class="input input-sm input-bordered w-full mt-2" placeholder={['grid_radio', 'grid_checkbox'].includes(field.type) ? "ជួរឈរ (Columns) (បំបែកដោយសញ្ញាក្បៀស , )" : "ជម្រើស (Options) (បំបែកដោយសញ្ញាក្បៀស , )"} />
                        {/if}

                        <!-- Logic Jump UI -->
                        {#if ['radio', 'select'].includes(field.type) && field.options}
                            <div class="mt-2 p-2 bg-base-200/50 rounded border border-base-300">
                                <div class="text-xs font-bold mb-1 text-gray-600">Logic Jump (លោតទៅសំណួរ)</div>
                                {#each field.options.split(',') as opt}
                                    <div class="flex items-center gap-2 mb-1">
                                        <span class="text-xs badge badge-ghost whitespace-nowrap max-w-[100px] truncate" title={opt.trim()}>{opt.trim()}</span>
                                        <span class="text-xs">→</span>
                                        <select class="select select-bordered select-xs w-full" 
                                            value={field.logic?.[opt.trim()] || ''} 
                                            on:change={(e) => { if(!field.logic) field.logic = {}; field.logic[opt.trim()] = e.target.value; }}>
                                            <option value="">សំណួរបន្ទាប់ (Next)</option>
                                            {#each editingForm.fields as targetF, targetI}
                                                {#if targetI > i}<option value={targetI}>Go to {targetI + 1}. {targetF.label}</option>{/if}
                                            {/each}
                                            <option value="submit">បញ្ជូន (Submit)</option>
                                        </select>
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        <!-- Scoring UI -->
                        {#if ['radio', 'checkbox', 'select'].includes(field.type) && field.options}
                            <div class="mt-2 p-2 bg-blue-50/50 rounded border border-blue-100/50">
                                <div class="flex justify-between items-center mb-1">
                                    <span class="text-xs font-bold text-blue-800">ពិន្ទុ & ចម្លើយត្រឹមត្រូវ</span>
                                    <label class="cursor-pointer label p-0">
                                        <span class="label-text text-xs mr-1 text-blue-600">បើក</span>
                                        <input type="checkbox" class="toggle toggle-xs toggle-info" bind:checked={field.enableScore} />
                                    </label>
                                </div>
                                {#if field.enableScore}
                                    <div class="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto">
                                        {#each field.options.split(',') as opt}
                                            <div class="flex items-center gap-2">
                                                <input 
                                                    type={field.type === 'checkbox' ? 'checkbox' : 'radio'} 
                                                    name={`correct_${i}`}
                                                    class={field.type === 'checkbox' ? 'checkbox checkbox-xs checkbox-success' : 'radio radio-xs radio-success'}
                                                    checked={field.type === 'checkbox' ? (field.correctAnswers || []).includes(opt.trim()) : field.correctAnswer === opt.trim()}
                                                    on:change={(e) => {
                                                        if (field.type === 'checkbox') {
                                                            if (!field.correctAnswers) field.correctAnswers = [];
                                                            if (e.target.checked) field.correctAnswers = [...field.correctAnswers, opt.trim()];
                                                            else field.correctAnswers = field.correctAnswers.filter(a => a !== opt.trim());
                                                        } else {
                                                            field.correctAnswer = opt.trim();
                                                        }
                                                    }}
                                                    title="កំណត់ជាចម្លើយត្រឹមត្រូវ"
                                                />
                                                <span class="text-xs badge badge-ghost whitespace-nowrap max-w-[150px] truncate" title={opt.trim()}>{opt.trim()}</span>
                                                <input type="number" class="input input-xs input-bordered w-20 text-right" placeholder="0" 
                                                    value={field.scores?.[opt.trim()] || 0} 
                                                    on:input={(e) => {
                                                        if(!field.scores) field.scores = {};
                                                        field.scores[opt.trim()] = parseInt(e.target.value) || 0;
                                                    }} />
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        {/if}

                        {#if ['radio', 'checkbox'].includes(field.type)}
                            <label class="cursor-pointer label justify-start gap-2 mt-1">
                                <input type="checkbox" bind:checked={field.allowOther} class="checkbox checkbox-xs" />
                                <span class="label-text text-xs">ដាក់ជម្រើស "ផ្សេងៗ" (Other) ឱ្យសរសេរបាន</span>
                            </label>
                        {/if}
                        {#if ['grid_radio', 'grid_checkbox'].includes(field.type)}
                            <input bind:value={field.rows} class="input input-sm input-bordered w-full mt-2" placeholder="ជួរដេក (Rows) (បំបែកដោយសញ្ញាក្បៀស , )" />
                        {/if}
                        {#if field.type === 'scale'}
                            <div class="grid grid-cols-2 gap-2 mt-2">
                                <input bind:value={field.minLabel} class="input input-sm input-bordered" placeholder="Label (Min) ឧ: មិនល្អ" />
                                <input bind:value={field.maxLabel} class="input input-sm input-bordered" placeholder="Label (Max) ឧ: ល្អណាស់" />
                            </div>
                        {/if}
                        {#if field.type !== 'section'}
                            <label class="cursor-pointer label justify-start gap-2 mt-1">
                                <input type="checkbox" bind:checked={field.required} class="checkbox checkbox-xs" />
                                <span class="label-text text-xs">តម្រូវឱ្យឆ្លើយ (Required)</span>
                            </label>
                        {/if}
                    </div>
                {/each}
                <button on:click={addField} class="btn btn-sm btn-outline w-full border-dashed">+ បន្ថែមសំណួរ</button>

            </div>
            <div class="modal-action p-6 border-t bg-gray-50/50 m-0 shrink-0">
                <button class="btn btn-info text-white" on:click={() => showPreviewFormModal = true}>👁️ Preview</button>
                <button class="btn" on:click={() => showFormModal = false}>បោះបង់</button>
                <button class="btn btn-primary" on:click={saveForm}>រក្សាទុក</button>
            </div>
        </div>
    </div>
    {/if}

    <!-- Preview Form Modal -->
    {#if showPreviewFormModal}
        <div class="modal modal-open bg-black/60" transition:fade={{ duration: 200 }}>
            <div class="modal-box w-11/12 max-w-3xl p-0 overflow-hidden rounded-2xl flex flex-col max-h-[90vh] shadow-2xl">
                <div class="p-6 overflow-y-auto flex-1 min-h-0" use:draggable>
                    <h3 class="font-bold text-lg mb-4 text-primary">Preview: {editingForm.title}</h3>
                    <p class="text-gray-500 mb-4 whitespace-pre-line">{editingForm.description || ''}</p>
                    
                    <div class="flex flex-col gap-4 pointer-events-none opacity-75">
                    {#each editingForm.fields as field}
                        {#if field.type === 'section'}
                            <div class="divider mt-4 mb-0"></div>
                            <h3 class="text-xl font-bold text-primary">{field.label}</h3>
                            {#if field.subtitle}<p class="text-sm text-gray-500">{field.subtitle}</p>{/if}
                        {:else}
                        <div class="form-control w-full">
                            <label class="label">
                                <div class="flex flex-col gap-1 w-full">
                                    <span class="label-text font-bold text-base">
                                        {field.label} {#if field.required}<span class="text-red-500">*</span>{/if}
                                    </span>
                                    {#if field.image_url}<img src={field.image_url} alt="Q" class="max-h-40 object-contain rounded-lg border self-start" />{/if}
                                    {#if field.subtitle}<span class="text-xs text-gray-500">{field.subtitle}</span>{/if}
                                </div>
                            </label>
                            {#if field.type === 'textarea'}
                                <textarea class="textarea textarea-bordered h-24" placeholder="ចម្លើយ..."></textarea>
                            {:else if field.type === 'select'}
                                <select class="select select-bordered w-full">
                                    <option value="" disabled selected>សូមជ្រើសរើស</option>
                                    {#each (field.options || '').split(',') as opt}
                                        <option value={opt.trim()}>{opt.trim()}</option>
                                    {/each}
                                </select>
                            {:else if field.type === 'date'}
                                <input type="date" class="input input-bordered" />
                            {:else if field.type === 'time'}
                                <input type="time" class="input input-bordered" />
                            {:else if field.type === 'number'}
                                <input type="number" class="input input-bordered" placeholder="ចម្លើយ..." />
                            {:else if field.type === 'radio'}
                                <div class="flex flex-col gap-2 mt-2">
                                    {#each (field.options || '').split(',') as opt}
                                        <label class="label cursor-pointer justify-start gap-2 py-1">
                                            <input type="radio" name={field.label} class="radio radio-primary radio-sm" />
                                            <span class="label-text">{opt.trim()}</span>
                                        </label>
                                    {/each}
                                    {#if field.allowOther}
                                        <div class="flex items-center gap-2 mt-1 ml-1">
                                            <label class="cursor-pointer flex items-center gap-2">
                                                <input type="radio" name={field.label} class="radio radio-primary radio-sm" />
                                                <span class="label-text">ផ្សេងៗ (Other):</span>
                                            </label>
                                            <textarea class="textarea textarea-bordered w-full max-w-xs" placeholder="សូមសរសេរចម្លើយ..."></textarea>
                                        </div>
                                    {/if}
                                </div>
                            {:else if field.type === 'checkbox'}
                                <div class="flex flex-col gap-2 mt-2">
                                    {#each (field.options || '').split(',') as opt}
                                        <label class="label cursor-pointer justify-start gap-2 py-1">
                                            <input type="checkbox" class="checkbox checkbox-primary checkbox-sm" />
                                            <span class="label-text">{opt.trim()}</span>
                                        </label>
                                    {/each}
                                    {#if field.allowOther}
                                        <div class="flex items-center gap-2 mt-1 ml-1">
                                            <label class="cursor-pointer flex items-center gap-2">
                                                <input type="checkbox" class="checkbox checkbox-primary checkbox-sm" />
                                                <span class="label-text">ផ្សេងៗ (Other):</span>
                                            </label>
                                            <textarea class="textarea textarea-bordered w-full max-w-xs" placeholder="សូមសរសេរចម្លើយ..."></textarea>
                                        </div>
                                    {/if}
                                </div>
                            {:else if field.type === 'scale'}
                                <div class="flex items-center justify-between gap-2 mt-4 px-2">
                                    <span class="text-sm font-bold">{field.minLabel || '1'}</span>
                                    <div class="flex gap-4 sm:gap-8">
                                        {#each Array(5) as _, i}
                                            <div class="flex flex-col items-center">
                                                <span class="text-xs mb-1">{i + 1}</span>
                                                <input type="radio" name={field.label} class="radio radio-primary" />
                                            </div>
                                        {/each}
                                    </div>
                                    <span class="text-sm font-bold">{field.maxLabel || '5'}</span>
                                </div>
                            {:else if field.type === 'rating'}
                                <div class="rating rating-lg mt-2">
                                    {#each Array(5) as _, i}
                                        <input type="radio" name={field.label} class="mask mask-star-2 bg-orange-400" />
                                    {/each}
                                </div>
                                {:else if field.type === 'emoji_rating'}
                                    <div class="flex flex-col gap-2 mt-2">
                                        {#each ['☺️ ពេញចិត្តខ្លាំង', '😊 ពេញចិត្ត', '😑 អាចទទួលយកបាន', '☹️ មិនពេញចិត្ត', '😡 មិនពេញចិត្តខ្លាំង'] as opt}
                                            <label class="label cursor-pointer justify-start gap-2 py-1">
                                                <input type="radio" name={field.label} class="radio radio-primary radio-sm" />
                                                <span class="label-text">{opt}</span>
                                            </label>
                                        {/each}
                                    </div>
                            {:else if field.type === 'grid_radio' || field.type === 'grid_checkbox'}
                                <div class="overflow-x-auto mt-2">
                                    <table class="table table-xs">
                                        <thead>
                                            <tr>
                                                <th></th>
                                                {#each (field.options || '').split(',').filter(c => c.trim()) as col}
                                                    <th class="text-center">{col.trim()}</th>
                                                {/each}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {#each (field.rows || '').split(',').filter(r => r.trim()) as row}
                                                <tr>
                                                    <td>{row.trim()}</td>
                                                    {#each (field.options || '').split(',') as col}
                                                        <td class="text-center">
                                                            {#if field.type === 'grid_radio'}
                                                                <input type="radio" name={`${field.label}_${row.trim()}`} class="radio radio-xs" />
                                                            {:else}
                                                                <input type="checkbox" class="checkbox checkbox-xs" />
                                                            {/if}
                                                        </td>
                                                    {/each}
                                                </tr>
                                            {/each}
                                        </tbody>
                                    </table>
                                </div>
                            {:else}
                                <input type="text" class="input input-bordered" placeholder="ចម្លើយ..." />
                            {/if}
                        </div>
                        {/if}
                    {/each}
                    </div>
                </div>

                <div class="modal-action p-6 border-t bg-base-200/50 m-0 shrink-0">
                    <button class="btn" on:click={() => showPreviewFormModal = false}>បិទ Preview</button>
                </div>
            </div>
        </div>
    {/if}

    <!-- QR Code Modal -->
    {#if showQrModal}
        <div class="modal modal-open bg-black/60" transition:fade={{ duration: 200 }}>
            <div class="modal-box text-center shadow-2xl" use:draggable>
                <h3 class="font-bold text-lg mb-4">{qrFormTitle}</h3>
                <div class="flex justify-center mb-4">
                    <img src={qrCodeUrl} alt="QR Code" class="w-64 h-64 border rounded-lg shadow-sm" />
                </div>
                <p class="text-sm text-gray-500 mb-6">ស្កេនដើម្បីបំពេញបែបបទ</p>
                <div class="flex gap-2 justify-center">
                    <button class="btn btn-primary text-white" on:click={printQrCode}>🖨️ Print</button>
                    <button class="btn" on:click={() => showQrModal = false}>បិទ</button>
                </div>
            </div>
        </div>
    {/if}
{/if}