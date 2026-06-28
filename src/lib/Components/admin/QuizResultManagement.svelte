<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fade, slide, fly } from 'svelte/transition';

    export let supabase;
    export let courses = [];
    export let loginLogoUrl = '';

    const dispatch = createEventDispatcher();

    let paginatedQuizResults = [];
    let allDeduplicatedResults = [];
    let filteredResults = [];
    let allRawQuizResults = [];
    let totalQuizRecords = 0;
    let isExporting = false;
    let loadingQuizResults = false;
    let quizSearch = '';
    let debouncedQuizSearch = '';
    let quizSearchTimeout;
    let isQuizSearching = false;

    $: {
        clearTimeout(quizSearchTimeout);
        quizSearchTimeout = setTimeout(() => {
            if (debouncedQuizSearch !== quizSearch) {
                debouncedQuizSearch = quizSearch;
                isQuizSearching = false;
                quizPage = 1;
                applyFiltersAndPagination();
            } else {
                isQuizSearching = false;
            }
        }, 300);
    }
    let selectedCourseFilter = 'none'; // 'none'=ជ្រើសរើស, ''=គ្រប់វគ្គ, courseId=វគ្គជាក្លាក់;
    let quizStartDate = '';
    let quizEndDate = '';
    let quizPage = 1;
    let quizPageSize = 10;
    let quizSortColumn = 'created_at';
    let quizStatusFilter = ''; // '', 'passed', 'failed'
    let quizTypeFilter = ''; // '', 'pre', 'post'
    let quizSortDirection = 'desc';
    $: totalQuizPages = Math.ceil(totalQuizRecords / quizPageSize);
    let showQuizSummary = true;
    let quizStats = { total: 0, passed: 0, failed: 0, passRate: 0 };
    let quizSummaryStats = { total: 0, gender: {}, position: {}, workplace: {}, licenseStatus: {}, province: {} };

    // Question Analytics State
    let showQuestionAnalyticsModal = false;
    let questionAnalyticsData = [];
    let analyzingQuestions = false;

    // Manual score assignment
    let showManualScoreModal = false;
    let manualScoreTab = 'manual'; // 'manual' | 'excel'
    let manualScoreUsers = [];
    let manualScoreSelectedUsers = [];
    let manualScoreSearch = '';
    let manualScoreCourseId = '';
    let manualScoreValue = 100;
    let manualScoreType = 'post';
    let manualScoreDate = '';
    let manualScoreLoading = false;
    $: manualScoreFiltered = manualScoreSearch.trim()
        ? manualScoreUsers.filter(u => {
            const q = manualScoreSearch.toLowerCase();
            return (u.full_name || '').toLowerCase().includes(q) ||
                   (u.name_latin || '').toLowerCase().includes(q) ||
                   (u.phone_number || '').includes(q);
          }).slice(0, 100)
        : manualScoreUsers.slice(0, 100);

    // Excel import state
    let excelImportRows = [];
    let excelImportLoading = false;
    let excelImportError = '';
    let excelReplaceMode = true; // true = replace old records, false = append
    $: excelValidCount = excelImportRows.filter(r => r.valid).length;
    $: excelErrorCount = excelImportRows.filter(r => !r.valid).length;

    let downloadingCerts = new Set();
    let sharingCerts = new Set();
    let isBatchDownloading = false;
    let batchCancelled = false;
    let batchProgressCurrent = 0;
    let batchProgressTotal = 0;
    let batchProgressText = '';

    // History Modal State
    let showHistoryModal = false;
    let selectedHistory = [];
    let selectedHistoryStudent = '';
    let selectedHistoryCourse = '';

    function exportQuestionAnalytics() {
        if (!questionAnalyticsData.length) return;
        const courseName = courses.find(c => String(c.id) === String(selectedCourseFilter))?.title || 'Course';
        const header = ['#', 'សំណួរ', 'ឆ្លើយសរុប', 'ឆ្លើយត្រូវ', 'ឆ្លើយខុស', 'អត្រាខុស (%)'];
        const rows = questionAnalyticsData.map((q, i) => [
            i + 1,
            q.question,
            q.totalAttempts,
            q.correct,
            q.wrong,
            q.errorRate
        ]);
        const bom = '\uFEFF';
        const csvContent = bom + header.join(',') + '\n' +
            rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `question-analytics-${courseName.slice(0, 30)}-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }


    function exportQuestionAnalyticsPDF() {
        if (!questionAnalyticsData.length) return;
        const courseName = courses.find(c => String(c.id) === String(selectedCourseFilter))?.title || 'Course';
        const date = new Date().toLocaleDateString('km-KH');
        const rowsHtml = questionAnalyticsData.map(function(q, i) {
            const bg = i % 2 === 0 ? '#f9fafb' : '#ffffff';
            const color = q.errorRate >= 50 ? '#dc2626' : q.errorRate >= 30 ? '#ea580c' : '#16a34a';
            return '<tr style="background:' + bg + '">'
                + '<td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:center;font-weight:bold">' + (i + 1) + '</td>'
                + '<td style="padding:8px 10px;border:1px solid #e5e7eb">' + (q.question || '') + '</td>'
                + '<td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:center">' + q.totalAttempts + '</td>'
                + '<td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:center;color:#16a34a">' + q.correct + '</td>'
                + '<td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:center;color:#dc2626">' + q.wrong + '</td>'
                + '<td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:center;font-weight:bold;color:' + color + '">' + q.errorRate + '%</td>'
                + '</tr>';
        }).join('');
        const css = 'body{font-family:Arial,sans-serif;font-size:13px;margin:20px;color:#1f2937}'
            + 'h1{font-size:18px;margin-bottom:4px}'
            + '.sub{color:#6b7280;font-size:12px;margin-bottom:16px}'
            + 'table{width:100%;border-collapse:collapse}'
            + 'th,td{border:1px solid #e5e7eb}'
            + 'th{background:#1e40af;color:white;padding:10px;text-align:center}'
            + 'th:nth-child(2){text-align:left}'
            + '@media print{body{margin:10px}}';
        const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><' + 'style>' + css + '</' + 'style></head><body>'
            + '<h1>វិភាគសំណួរ (Question Analytics)</h1>'
            + '<div class="sub">វគ្គ: <strong>' + courseName + '</strong> &nbsp;|&nbsp; ស្រង់: ' + date + '</div>'
            + '<table><thead><tr>'
            + '<th style="width:40px">#</th>'
            + '<th style="text-align:left">សំណួរ</th>'
            + '<th style="width:70px">ឆ្លើយសរុប</th>'
            + '<th style="width:70px">ឆ្លើយត្រូវ</th>'
            + '<th style="width:70px">ឆ្លើយខុស</th>'
            + '<th style="width:80px">អត្រាខុស (%)</th>'
            + '</tr></thead><tbody>' + rowsHtml + '</tbody></table>'
            + '<' + 'script>window.onload=function(){window.print()}</' + 'script>'
            + '</body></html>';
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); }
    }

    onMount(async () => {
        // ស្វែងរក course ចុងក្រោយដែលមានការប្រឡង ដើម្បីបង្ហាញដោយស្វ័យប្រវត្តិ
        const { data: latest } = await supabase
            .from('student_quiz_results')
            .select('course_id')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (latest?.course_id) {
            selectedCourseFilter = String(latest.course_id);
        } else {
            selectedCourseFilter = 'none';
        }
        loadQuizResults();
    });

    function toggleQuizSort(column) {
        if (quizSortColumn === column) {
            quizSortDirection = quizSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            quizSortColumn = column;
            quizSortDirection = 'asc';
        }
        quizPage = 1;
        applyFiltersAndPagination();
    }

    function handleFilterChange() {
        quizPage = 1;
        applyFiltersAndPagination();
    }

    async function handleCourseChange() {
        quizPage = 1;
        await loadQuizResults();
    }

    async function loadQuizResults() {
        // 'none' = មិនទាន់ជ្រើស → បង្ហាញទទេ
        if (selectedCourseFilter === 'none') {
            allDeduplicatedResults = [];
            allRawQuizResults = [];
            applyFiltersAndPagination();
            return;
        }

        loadingQuizResults = true;
        let allFetchedData = [];
        let hasMore = true; 
        let from = 0; 
        const step = 1000;

        while (hasMore) {
            let query = supabase.from('student_quiz_results')
                .select('id, user_id, course_id, score, passed, type, created_at, users!inner(full_name, name_latin, phone_number, gender, profile_data, avatar_url), courses!inner(title, cpd_points, cert_template_url)')
                .order('created_at', { ascending: false });

            // filter course_id នៅលើ DB ដើម្បីមិនទាញទិន្នន័យទាំងអស់
            if (selectedCourseFilter && selectedCourseFilter !== 'none') {
                query = query.eq('course_id', selectedCourseFilter);
            }

            const { data, error } = await query.range(from, from + step - 1);
            if (error || !data || data.length === 0) break;

            allFetchedData.push(...data);
            from += step;
            if (data.length < step) hasMore = false;
        }

        // រាប់ចំនួនដងដែលសិស្សម្នាក់ៗបានប្រឡង
        const attemptCounts = {};
        for (const r of allFetchedData) {
            const key = `${r.user_id}_${r.course_id}_${r.type}`;
            attemptCounts[key] = (attemptCounts[key] || 0) + 1;
        }

        // ចម្រាញ់យកតែការប្រឡងចុងក្រោយបំផុត (Latest Attempt) សម្រាប់សិស្សម្នាក់ៗ ក្នុងមួយវគ្គ តាមប្រភេទ (Pre/Post)
        const seen = new Set();
        const deduplicated = [];
        for (const r of allFetchedData) {
            const key = `${r.user_id}_${r.course_id}_${r.type}`;
            if (!seen.has(key)) {
                seen.add(key);
                // បញ្ចូលចំនួនដងដែលបានប្រឡង (attempt_count) ទៅក្នុង object
                deduplicated.push({ ...r, attempt_count: attemptCounts[key] || 1 });
            }
        }

        allDeduplicatedResults = deduplicated;
        allRawQuizResults = allFetchedData;

        applyFiltersAndPagination();
        loadingQuizResults = false;
    }

    function applyFiltersAndPagination() {
        filteredResults = allDeduplicatedResults.filter(r => {
            if (selectedCourseFilter && selectedCourseFilter !== 'none' && String(r.course_id) !== String(selectedCourseFilter)) return false;
            
            if (quizStatusFilter === 'passed' && !r.passed) return false;
            if (quizStatusFilter === 'failed' && r.passed) return false;
            if (quizTypeFilter && r.type !== quizTypeFilter) return false;
            
            const rDate = new Date(r.created_at).getTime();
            if (quizStartDate && rDate < new Date(new Date(quizStartDate).setHours(0,0,0,0)).getTime()) return false;
            if (quizEndDate && rDate > new Date(new Date(quizEndDate).setHours(23,59,59,999)).getTime()) return false;
            
            if (debouncedQuizSearch) {
                const search = debouncedQuizSearch.toLowerCase();
                const nameKh = (r.users?.full_name || '').toLowerCase();
                const nameEn = (r.users?.name_latin || '').toLowerCase();
                const phone = (r.users?.phone_number || '').toLowerCase();
                if (!nameKh.includes(search) && !nameEn.includes(search) && !phone.includes(search)) return false;
            }
            
            return true;
        });

        totalQuizRecords = filteredResults.length;
        computeQuizStats(filteredResults);

        let sorted = [...filteredResults];
        
        sorted.sort((a, b) => {
            let valA, valB;
            if (quizSortColumn === 'created_at') {
                valA = new Date(a.created_at).getTime();
                valB = new Date(b.created_at).getTime();
            } else if (quizSortColumn === 'score') {
                valA = a.score;
                valB = b.score;
            } else if (quizSortColumn === 'user') {
                valA = (a.users?.full_name || '').toLowerCase();
                valB = (b.users?.full_name || '').toLowerCase();
            } else if (quizSortColumn === 'course') {
                valA = (a.courses?.title || '').toLowerCase();
                valB = (b.courses?.title || '').toLowerCase();
            } else {
                return 0;
            }
            if (valA < valB) return quizSortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return quizSortDirection === 'asc' ? 1 : -1;
            return 0;
        });

        const startIdx = (quizPage - 1) * quizPageSize;
        paginatedQuizResults = sorted.slice(startIdx, startIdx + quizPageSize).map(r => ({
            ...r, 
            full_name: r.users?.full_name, 
            name_latin: r.users?.name_latin,
            phone_number: r.users?.phone_number, 
            gender: r.users?.gender,
            profile_data: r.users?.profile_data, 
            avatar_url: r.users?.avatar_url,
            course_title: r.courses?.title, 
            cpd_points: r.courses?.cpd_points,
            cert_template_url: r.courses?.cert_template_url
        }));
    }

    function computeQuizStats(data) {
        let total = 0, passed = 0, failed = 0;
        const gender = {}, position = {}, workplace = {}, province = {}, licenseStatus = {};

        data.forEach(r => {
            total++;
            if (r.passed) passed++; else failed++;
            const pd = r.users?.profile_data || {};
            const g = r.users?.gender === 'Male' ? 'ប្រុស' : r.users?.gender === 'Female' ? 'ស្រី' : 'មិនបញ្ជាក់';
            gender[g] = (gender[g] || 0) + 1;
            const pos = pd.position || 'មិនបញ្ជាក់'; position[pos] = (position[pos] || 0) + 1;
            const wp = pd.workplace || 'មិនបញ្ជាក់'; workplace[wp] = (workplace[wp] || 0) + 1;
            const prov = pd.province || 'មិនបញ្ជាក់'; province[prov] = (province[prov] || 0) + 1;
            const lic = pd.license_status || 'មិនបញ្ជាក់'; licenseStatus[lic] = (licenseStatus[lic] || 0) + 1;
        });

        quizStats = { total, passed, failed, passRate: total ? Math.round(passed/total*100) : 0 };
        quizSummaryStats = { total, gender, position, workplace, province, licenseStatus };
    }

    function viewHistory(userId, courseId, type, studentName, courseTitle) {
        selectedHistoryStudent = studentName || 'អនាមិក';
        selectedHistoryCourse = courseTitle || 'មិនស្គាល់វគ្គសិក្សា';
        selectedHistory = allRawQuizResults
            .filter(r => r.user_id === userId && r.course_id === courseId && r.type === type)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        showHistoryModal = true;
    }

    async function deleteHistoryRecord(recordId) {
        if (!confirm("តើអ្នកពិតជាចង់លុបប្រវត្តិប្រឡងនេះមែនទេ? (ទិន្នន័យនេះនឹងត្រូវលុបជាស្ថាពរ)")) return;
        
        const { error } = await supabase.from('student_quiz_results').delete().eq('id', recordId);
        if (error) {
            alert("មានបញ្ហាក្នុងការលុប: " + error.message);
        } else {
            // ដកប្រវត្តិដែលលុបចេញពី Modal ភ្លាមៗ
            selectedHistory = selectedHistory.filter(h => h.id !== recordId);
            // បើលុបអស់ពី Modal ហើយ ឱ្យបិទ Modal
            if (selectedHistory.length === 0) showHistoryModal = false;
            // ទាញយកទិន្នន័យថ្មីដើម្បីអាប់ដេតតារាងធំខាងក្រោយ
            loadQuizResults(); 
        }
    }

    async function editHistoryScore(historyRecord) {
        const newScoreStr = prompt("សូមបញ្ចូលពិន្ទុថ្មី (0-100):", historyRecord.score);
        if (newScoreStr === null) return; // User cancelled

        const newScore = parseInt(newScoreStr);
        if (isNaN(newScore) || newScore < 0 || newScore > 100) {
            return alert("ពិន្ទុមិនត្រឹមត្រូវ! សូមបញ្ចូលលេខរវាង 0 និង 100។");
        }

        // ស្វែងរកវគ្គសិក្សាដើម្បីទទួលបានពិន្ទុអប្បបរមាសម្រាប់ជាប់
        const course = courses.find(c => String(c.id) === String(historyRecord.course_id));
        const passingScore = course?.quiz_passing_score || 70;
        const newPassedStatus = newScore >= passingScore;

        const { error } = await supabase
            .from('student_quiz_results')
            .update({ score: newScore, passed: newPassedStatus })
            .eq('id', historyRecord.id);

        if (error) {
            alert("មានបញ្ហាក្នុងការកែប្រែពិន្ទុ: " + error.message);
        } else {
            // Update the modal UI immediately for better UX
            const recordInHistory = selectedHistory.find(h => h.id === historyRecord.id);
            if (recordInHistory) { recordInHistory.score = newScore; recordInHistory.passed = newPassedStatus; selectedHistory = [...selectedHistory]; }
            loadQuizResults(); // Reload all data in the background
            alert("បានកែប្រែពិន្ទុដោយជោគជ័យ!");
        }
    }

    function printStudentHistory() {
        if (!selectedHistory.length) return alert("គ្មានទិន្នន័យសម្រាប់ព្រីនទេ");

        const printWindow = window.open('', '_blank');
        
        let html = `
            <html>
            <head>
                <title>ប្រវត្តិប្រឡង - ${selectedHistoryStudent}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Nokora:wght@400;700&display=swap');
                    body { font-family: 'Nokora', sans-serif; padding: 20px; color: #1f2937; }
                    h1 { text-align: center; color: #0d9488; margin-bottom: 10px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 14px; }
                    th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; }
                    th { background-color: #f3f4f6; font-weight: bold; }
                    .header-info { text-align: center; margin-bottom: 30px; font-size: 14px; background: #f0fdfa; padding: 15px; border-radius: 10px; border: 1px solid #ccfbf1; }
                    .text-success { color: #16a34a; font-weight: bold; }
                    .text-error { color: #dc2626; font-weight: bold; }
                    @media print { body { padding: 0; } .header-info { border: 1px solid #ddd; } }
                </style>
            </head>
            <body>
                <h1>ប្រវត្តិប្រឡងលម្អិត</h1>
                <div class="header-info">
                    <p style="margin:0 0 5px 0;">សិស្ស: <strong>${selectedHistoryStudent}</strong></p>
                    <p style="margin:0 0 5px 0;">វគ្គសិក្សា: <strong>${selectedHistoryCourse}</strong></p>
                    <p style="margin:0;">កាលបរិច្ឆេទ Export: ${new Date().toLocaleString('km-KH')}</p>
                </div>
                
                <table>
                    <thead>
                        <tr><th>លើកទី</th><th>កាលបរិច្ឆេទ</th><th>ពិន្ទុ</th><th>លទ្ធផល</th></tr>
                    </thead>
                    <tbody>
        `;

        selectedHistory.forEach((hist, idx) => {
            const attempt = selectedHistory.length - idx;
            const dateStr = new Date(hist.created_at).toLocaleString('km-KH');
            const statusHtml = hist.passed ? '<span class="text-success">✅ ជាប់</span>' : '<span class="text-error">❌ ធ្លាក់</span>';
            html += `<tr><td>${attempt}</td><td>${dateStr}</td><td><strong>${hist.score}%</strong></td><td>${statusHtml}</td></tr>`;
        });

        html += `</tbody></table><script>window.onload = () => { window.print(); }<\/script></body></html>`;

        printWindow.document.write(html);
        printWindow.document.close();
    }

    async function fetchAllForExport() {
        isExporting = true;
        await new Promise(res => setTimeout(res, 50));
        const mapped = filteredResults.map(r => ({
            ...r, full_name: r.users?.full_name, name_latin: r.users?.name_latin, phone_number: r.users?.phone_number,
            gender: r.users?.gender, profile_data: r.users?.profile_data, avatar_url: r.users?.avatar_url,
            course_title: r.courses?.title, cpd_points: r.courses?.cpd_points, cert_template_url: r.courses?.cert_template_url
        }));
        isExporting = false;
        return mapped;
    }

    async function analyzeQuizQuestions() {
        if (!selectedCourseFilter) return alert("សូមជ្រើសរើសវគ្គសិក្សាជាមុនសិន!");
        
        analyzingQuestions = true;
        showQuestionAnalyticsModal = true;
        questionAnalyticsData = [];

        try {
            // 1. ទាញយកសំណួរទាំងអស់ក្នុងវគ្គនេះ
            const { data: questions, error } = await supabase
                .from('quiz_questions')
                .select('id, question, correct_answer')
                .eq('course_id', selectedCourseFilter);

            if (error) throw error;
            if (!questions || questions.length === 0) return;

            const stats = {};
            questions.forEach(q => {
                stats[q.id] = { ...q, totalAttempts: 0, correct: 0, wrong: 0 };
            });

            let hasMore = true; let from = 0; const step = 1000;
            while(hasMore) {
                let query = supabase.from('student_quiz_results').select('question_ids, answers').eq('course_id', selectedCourseFilter);
                if (quizStartDate) query = query.gte('created_at', new Date(new Date(quizStartDate).setHours(0,0,0,0)).toISOString());
                if (quizEndDate) query = query.lte('created_at', new Date(new Date(quizEndDate).setHours(23,59,59,999)).toISOString());
                if (quizStatusFilter) query = query.eq('passed', quizStatusFilter === 'passed');
                if (debouncedQuizSearch) query = query.or(`full_name.ilike.%${debouncedQuizSearch}%,name_latin.ilike.%${debouncedQuizSearch}%,phone_number.ilike.%${debouncedQuizSearch}%`, { foreignTable: 'users' });

                const { data } = await query.range(from, from + step - 1);
                if (!data || data.length === 0) break;

                data.forEach(result => {
                    const qIds = result.question_ids || [];
                    const answers = result.answers || [];
                    qIds.forEach((qId, index) => {
                        if (stats[qId]) {
                            stats[qId].totalAttempts++;
                            const studentAnswer = answers[index];
                            let correctAnswers = Array.isArray(stats[qId].correct_answer) ? stats[qId].correct_answer.map(Number) : [Number(stats[qId].correct_answer)];
                            if (studentAnswer !== null && studentAnswer !== undefined) {
                                if (correctAnswers.includes(Number(studentAnswer))) stats[qId].correct++;
                                else stats[qId].wrong++;
                            }
                        }
                    });
                });
                from += step;
                if (data.length < step) hasMore = false;
            }

            // 3. គណនាភាគរយខុស និងតម្រៀបពីខុសច្រើន ទៅខុសតិច
            questionAnalyticsData = Object.values(stats).map(stat => {
                const errorRate = stat.totalAttempts > 0 ? Math.round((stat.wrong / stat.totalAttempts) * 100) : 0;
                return { ...stat, errorRate };
            }).sort((a, b) => b.errorRate - a.errorRate);

        } catch (err) {
            console.error(err);
            alert("មានបញ្ហាក្នុងការវិភាគសំណួរ: " + err.message);
        } finally {
            analyzingQuestions = false;
        }
    }

    async function resetQuizFilters() {
        quizSearch = '';
        selectedCourseFilter = 'none';
        quizStartDate = '';
        quizEndDate = '';
        quizStatusFilter = '';
        quizTypeFilter = '';
        quizPage = 1;
        await loadQuizResults();
    }

    async function openManualScoreModal() {
        manualScoreSelectedUsers = [];
        manualScoreSearch = '';
        manualScoreCourseId = '';
        manualScoreValue = 100;
        manualScoreType = 'post';
        manualScoreDate = new Date().toISOString().split('T')[0];
        manualScoreTab = 'manual';
        excelImportRows = [];
        excelImportError = '';
        showManualScoreModal = true;
        
        let allUsers = [];
        let hasMore = true;
        let from = 0;
        const step = 1000;
        
        while (hasMore) {
            const { data, error } = await supabase
                .from('users')
                .select('id, full_name, name_latin, phone_number')
                .order('full_name')
                .range(from, from + step - 1);
                
            if (error) break;
            if (data && data.length > 0) {
                allUsers = [...allUsers, ...data];
                from += step;
                if (data.length < step) hasMore = false;
            } else hasMore = false;
        }
        manualScoreUsers = allUsers;
    }

    async function submitManualScore() {
        if (!manualScoreSelectedUsers.length || !manualScoreCourseId) return alert('សូមជ្រើសរើសសិស្ស និងវគ្គសិក្សា');
        const score = parseInt(manualScoreValue);
        if (isNaN(score) || score < 0 || score > 100) return alert('ពិន្ទុត្រូវតែស្ថិតក្នុងចន្លោះ 0–100');
        manualScoreLoading = true;
        const course = courses.find(c => c.id === manualScoreCourseId);
        const passingScore = course?.quiz_passing_score || 70;
        const rows = manualScoreSelectedUsers.map(uid => ({
            user_id: uid,
            course_id: manualScoreCourseId,
            score,
            correct_count: 0,
            total_questions: 0,
            passed: score >= passingScore,
            type: manualScoreType,
            answers: {},
            ...(manualScoreDate ? { created_at: new Date(manualScoreDate).toISOString() } : {})
        }));
        const { error } = await supabase.from('student_quiz_results').insert(rows);
        manualScoreLoading = false;
        if (error) { alert('មានបញ្ហា: ' + error.message); return; }
        showManualScoreModal = false;
        await loadQuizResults();
    }

    function downloadImportTemplate() {
        const BOM = '\uFEFF';
        const csv = BOM + 'phone_number,score,type,date\n="0123456789",85,post,2026-04-05\n="0987654321",72,pre,2026-04-05\n';
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'score_import_template.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    function parseCSV(text) {
        const cleaned = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const lines = cleaned.split('\n').filter(l => l.trim());
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
        return lines.slice(1).map(line => {
            const values = [];
            let cur = '';
            let inQuote = false;
            for (const ch of line) {
                if (ch === '"' || ch === "'") { inQuote = !inQuote; }
                else if (ch === ',' && !inQuote) { values.push(cur.trim()); cur = ''; }
                else { cur += ch; }
            }
            values.push(cur.trim());
            const row = {};
            headers.forEach((h, i) => { row[h] = (values[i] || '').replace(/^["']|["']$/g, ''); });
            return row;
        });
    }

    async function handleExcelFileSelect(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        excelImportError = '';
        excelImportLoading = true;
        excelImportRows = [];
        try {
            const text = await file.text();
            const parsed = parseCSV(text);
            if (!parsed.length) {
                excelImportError = 'ឯកសារទទេ ឬ format មិនត្រឹមត្រូវ (ត្រូវការ CSV)';
                excelImportLoading = false;
                return;
            }
            const phoneMap = {};
            for (const u of manualScoreUsers) {
                if (u.phone_number) phoneMap[u.phone_number.replace(/\D/g, '')] = u;
            }
            excelImportRows = parsed.map((r, i) => {
                let phone = (r.phone_number || r.phone || '').replace(/\D/g, '');
                let user = phoneMap[phone];
                if (!user && phone && !phone.startsWith('0')) {
                    user = phoneMap['0' + phone];
                    if (user) phone = '0' + phone;
                }
                const score = parseInt(r.score);
                const type = ['pre', 'post'].includes((r.type || '').toLowerCase()) ? r.type.toLowerCase() : manualScoreType;
                const date = r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : manualScoreDate;
                const valid = !!user && !isNaN(score) && score >= 0 && score <= 100;
                return {
                    row: i + 2,
                    phone_number: r.phone_number || r.phone || '',
                    full_name: user?.full_name || '—',
                    user_id: user?.id || null,
                    score: isNaN(score) ? null : score,
                    type,
                    date,
                    valid,
                    errorMsg: !phone ? 'គ្មានលេខ' : !user ? 'រកមិនឃើញ' : (isNaN(score) || score < 0 || score > 100) ? 'ពិន្ទុខុស' : ''
                };
            });
        } catch (err) {
            excelImportError = 'មានបញ្ហាក្នុងការអានឯកសារ: ' + err.message;
        }
        excelImportLoading = false;
        e.target.value = '';
    }

    async function submitExcelImport() {
        if (!manualScoreCourseId) return alert('សូមជ្រើសរើសវគ្គសិក្សា');
        const validRows = excelImportRows.filter(r => r.valid);
        if (!validRows.length) return alert('គ្មានទិន្នន័យត្រឹមត្រូវ');
        manualScoreLoading = true;
        const course = courses.find(c => c.id === manualScoreCourseId);
        const passingScore = course?.quiz_passing_score || 70;
        const rows = validRows.map(r => ({
            user_id: r.user_id,
            course_id: manualScoreCourseId,
            score: r.score,
            correct_count: 0,
            total_questions: 0,
            passed: r.score >= passingScore,
            type: r.type,
            answers: {},
            created_at: new Date(r.date || manualScoreDate).toISOString()
        }));

        if (excelReplaceMode) {
            const userIds = [...new Set(validRows.map(r => r.user_id))];
            const typeFilter = [...new Set(validRows.map(r => r.type))];
            await supabase.from('student_quiz_results').delete()
                .eq('course_id', manualScoreCourseId)
                .in('type', typeFilter)
                .in('user_id', userIds);
        }

        const { error } = await supabase.from('student_quiz_results').insert(rows);
        manualScoreLoading = false;
        if (error) { alert('មានបញ្ហា: ' + error.message); return; }
        showManualScoreModal = false;
        excelImportRows = [];
        await loadQuizResults();
    }

    function downloadCSV(filename, headers, rows) {
        const BOM = "\uFEFF"; // សម្រាប់ឱ្យ Excel ស្គាល់ភាសាខ្មែរ (UTF-8)
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

    function printQuizSummaryStats() {
        if (quizStats.total === 0) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");

        const printWindow = window.open('', '_blank');
        
        let html = `
            <html>
            <head>
                <title>របាយការណ៍សង្ខេបលទ្ធផលប្រឡង</title>
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
                <h1>របាយការណ៍សង្ខេបលទ្ធផលប្រឡង</h1>
                <div class="header-info">
                    <p style="margin:0 0 5px 0;">កាលបរិច្ឆេទ Export: ${new Date().toLocaleString('km-KH')}</p>
                    <p style="margin:0 0 5px 0;">សិស្សសរុប: <strong>${quizStats.total}</strong> | ជាប់: <strong style="color: #16a34a;">${quizStats.passed}</strong> | ធ្លាក់: <strong style="color: #dc2626;">${quizStats.failed}</strong> | អត្រាជាប់: <strong>${quizStats.passRate}%</strong></p>
                    ${selectedCourseFilter ? `<p style="margin:0;">វគ្គសិក្សា: <strong>${courses.find(c => String(c.id) === String(selectedCourseFilter))?.title || ''}</strong></p>` : ''}
                </div>
                
                <div class="grid">
        `;

        const makeTable = (title, dataObj) => {
            let t = `<div><h2>${title}</h2><table><thead><tr><th>ឈ្មោះ</th><th>ចំនួន</th><th>ភាគរយ</th></tr></thead><tbody>`;
            const entries = Object.entries(dataObj).sort((a,b) => b[1]-a[1]);
            entries.forEach(([label, count]) => {
                t += `<tr><td>${label}</td><td>${count}</td><td>${Math.round((count / quizSummaryStats.total) * 100)}%</td></tr>`;
            });
            t += `<tr class="total-row"><td>សរុប</td><td>${quizSummaryStats.total}</td><td>100%</td></tr>`;
            t += `</tbody></table></div>`;
            return t;
        };

        html += makeTable('ភេទ', quizSummaryStats.gender);
        html += makeTable('មុខតំណែង / កម្រិតជំនាញ', quizSummaryStats.position);
        html += makeTable('កន្លែងធ្វើការ', quizSummaryStats.workplace);
        html += makeTable('រាជធានី/ខេត្ត', quizSummaryStats.province);
        html += makeTable('ស្ថានភាពអាជ្ញាប័ណ្ណ', quizSummaryStats.licenseStatus);

        html += `
                </div>
                <script>window.onload = () => { window.print(); }<\/script>
            </body>
            </html>
        `;

        printWindow.document.write(html);
        printWindow.document.close();
    }

    function exportQuizSummaryStatsToExcel() {
        if (quizStats.total === 0) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");

        const BOM = "\uFEFF";
        let csvContent = `របាយការណ៍សង្ខេបលទ្ធផលប្រឡង\n`;
        csvContent += `កាលបរិច្ឆេទ Export:,${new Date().toLocaleString('km-KH')}\n`;
        csvContent += `សិស្សសរុប:,${quizStats.total}\n`;
        csvContent += `ជាប់:,${quizStats.passed}\n`;
        csvContent += `ធ្លាក់:,${quizStats.failed}\n`;
        csvContent += `អត្រាជាប់:,${quizStats.passRate}%\n`;
        if (selectedCourseFilter) {
            csvContent += `វគ្គសិក្សា:,"${(courses.find(c => String(c.id) === String(selectedCourseFilter))?.title || '').replace(/"/g, '""')}"\n`;
        }
        csvContent += `\n`;

        const appendTable = (title, dataObj, total) => {
            csvContent += `${title},ចំនួន,ភាគរយ\n`;
            const entries = Object.entries(dataObj).sort((a,b) => b[1]-a[1]);
            entries.forEach(([label, count]) => {
                const pct = Math.round((count / total) * 100);
                csvContent += `"${String(label).replace(/"/g, '""')}",${count},${pct}%\n`;
            });
            csvContent += `សរុប,${total},100%\n\n`;
        };

        appendTable('ភេទ', quizSummaryStats.gender, quizSummaryStats.total);
        appendTable('មុខតំណែង / កម្រិតជំនាញ', quizSummaryStats.position, quizSummaryStats.total);
        appendTable('កន្លែងធ្វើការ', quizSummaryStats.workplace, quizSummaryStats.total);
        appendTable('រាជធានី/ខេត្ត', quizSummaryStats.province, quizSummaryStats.total);
        appendTable('ស្ថានភាពអាជ្ញាប័ណ្ណ', quizSummaryStats.licenseStatus, quizSummaryStats.total);

        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `quiz_stats_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function exportQuizResultsToExcel() {
        if (quizStats.total === 0) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");
        const allData = await fetchAllForExport();

        const headers = ['កាលបរិច្ឆេទ', 'សិស្ស', 'ឈ្មោះឡាតាំង', 'ភេទ', 'តួនាទី', 'ទីកន្លែងធ្វើការ', 'ខេត្ត', 'ស្ថានភាពអាជ្ញាប័ណ្ណ', 'លេខទូរស័ព្ទ', 'វគ្គសិក្សា', 'ប្រភេទ', 'ពិន្ទុ', 'លទ្ធផល', 'CPD'];
        const rows = allData.map(result => {
            const pd = result.profile_data || {};
            const gender = result.gender === 'Male' ? 'ប្រុស' : result.gender === 'Female' ? 'ស្រី' : (result.gender || '');
            return [
                new Date(result.created_at).toLocaleDateString('km-KH'),
                `"${(result.full_name || 'Unknown').replace(/"/g, '""')}"`,
                `"${(result.name_latin || '').replace(/"/g, '""')}"`,
                `"${gender}"`,
                `"${(pd.position || '').replace(/"/g, '""')}"`,
                `"${(pd.workplace || '').replace(/"/g, '""')}"`,
                `"${(pd.province || '').replace(/"/g, '""')}"`,
                `"${(pd.license_status || '').replace(/"/g, '""')} ${pd.license_number || ''}"`,
                `="${(result.phone_number || '').replace(/"/g, '""')}"`,
                `"${(result.course_title || 'Unknown Course').replace(/"/g, '""')}"`,
                result.type === 'pre' ? 'Pre-test' : 'Post-test',
                result.score,
                result.passed ? 'ជាប់' : 'ធ្លាក់',
                (result.passed && result.type !== 'pre') ? (result.cpd_points || 0) : 0
            ].join(',');
        });

        downloadCSV(`quiz_results_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    }

    async function exportPrePostReport() {
        if (quizStats.total === 0) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");
        const allData = await fetchAllForExport();

        const reportMap = {};
        allData.forEach(r => {
            const key = `${r.user_id}_${r.course_id}`;
            if (!reportMap[key]) {
                reportMap[key] = {
                    user: {
                        full_name: r.full_name,
                        name_latin: r.name_latin,
                        phone_number: r.phone_number,
                        gender: r.gender,
                        profile_data: r.profile_data
                    },
                    course_title: r.course_title || 'Unknown Course',
                    pre_score: null,
                    post_score: null
                };
            }
            if (r.type === 'pre') {
                if (reportMap[key].pre_score === null || r.score > reportMap[key].pre_score) reportMap[key].pre_score = r.score;
            } else {
                if (reportMap[key].post_score === null || r.score > reportMap[key].post_score) reportMap[key].post_score = r.score;
            }
        });

        const headers = ['ឈ្មោះសិស្ស', 'ភេទ', 'តួនាទី', 'ទីកន្លែងធ្វើការ', 'ខេត្ត', 'ស្ថានភាពអាជ្ញាប័ណ្ណ', 'លេខទូរស័ព្ទ', 'វគ្គសិក្សា', 'ពិន្ទុ Pre-test', 'ពិន្ទុ Post-test', 'ការកើនឡើង'];
        const rows = Object.values(reportMap).map(row => {
            const u = row.user || {};
            const pd = u.profile_data || {};
            const gender = u.gender === 'Male' ? 'ប្រុស' : u.gender === 'Female' ? 'ស្រី' : (u.gender || '');
            const pre = row.pre_score !== null ? row.pre_score : 0;
            const post = row.post_score !== null ? row.post_score : 0;
            const improvement = post - pre;

            return [
                `"${(u.full_name || '').replace(/"/g, '""')}"`,
                `"${gender}"`,
                `"${(pd.position || '').replace(/"/g, '""')}"`,
                `"${(pd.workplace || '').replace(/"/g, '""')}"`,
                `"${(pd.province || '').replace(/"/g, '""')}"`,
                `"${(pd.license_status || '').replace(/"/g, '""')} ${pd.license_number || ''}"`,
                `="${(u.phone_number || '').replace(/"/g, '""')}"`,
                `"${(row.course_title || '').replace(/"/g, '""')}"`,
                pre,
                post,
                improvement
            ].join(',');
        });

        downloadCSV(`pre_post_report_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    }

    async function downloadStudentCertificate(result) {
        const course = courses.find(c => String(c.id) === String(result.course_id));
        if (!course || !course.cert_template_url) {
            return alert("វគ្គសិក្សានេះមិនទាន់មានលិខិតបញ្ជាក់ការសិក្សាទេ");
        }

        downloadingCerts.add(result.id);
        downloadingCerts = downloadingCerts;

        try {
            const student = {
                id: result.user_id,
                full_name: result.full_name || 'អនាមិក',
                name_latin: result.name_latin || '',
                phone_number: result.phone_number || ''
            };

            const certId = `CCN-${String(result.id).padStart(3, '0')}`;
            const dateStr = new Date(result.created_at).toLocaleDateString('km-KH');
            const qrData = `${window.location.origin}/verify?u=${student.id}&c=${course.id}`;
            const logo = loginLogoUrl || '/ccn-logo.png';

            const canvas = document.createElement('canvas');
            const { drawCertificate } = await import('$lib/certificate.js');
            await drawCertificate(canvas, course, student, certId, dateStr, qrData, logo);
            
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const { jsPDF } = await import('jspdf');
            
            const orientation = canvas.width > canvas.height ? 'l' : 'p';
            const pdf = new jsPDF(orientation, 'mm', 'a4');
            const pageWidth = pdf.internal.pageSize.getWidth();
            const pageHeight = pdf.internal.pageSize.getHeight();
            
            pdf.addImage(dataUrl, 'JPEG', 0, 0, pageWidth, pageHeight);
            const safeTitle = course.title.replace(/[\/\\?%*:|"<>]/g, '-');
            pdf.save(`Certificate_${certId}_${student.full_name}_${safeTitle}.pdf`);
            
        } catch (e) {
            console.error(e);
            alert("បរាជ័យក្នុងការទាញយកលិខិតបញ្ជាក់: " + e.message);
        } finally {
            downloadingCerts.delete(result.id);
            downloadingCerts = downloadingCerts;
        }
    }

    async function shareStudentCertificate(result) {
        const course = courses.find(c => String(c.id) === String(result.course_id));
        if (!course || !course.cert_template_url) {
            return alert("វគ្គសិក្សានេះមិនទាន់មានលិខិតបញ្ជាក់ការសិក្សាទេ");
        }

        sharingCerts.add(result.id);
        sharingCerts = sharingCerts;

        try {
            const student = {
                id: result.user_id,
                full_name: result.users?.full_name || 'អនាមិក',
                name_latin: result.users?.name_latin || '',
                phone_number: result.users?.phone_number || ''
            };

            const certId = `CCN-${String(result.id).padStart(3, '0')}`;
            const dateStr = new Date(result.created_at).toLocaleDateString('km-KH');
            const qrData = `${window.location.origin}/verify?u=${student.id}&c=${course.id}`;
            const logo = loginLogoUrl || '/ccn-logo.png';

            const canvas = document.createElement('canvas');
            const { drawCertificate } = await import('$lib/certificate.js');
            await drawCertificate(canvas, course, student, certId, dateStr, qrData, logo);
            
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
            const file = new File([blob], `Certificate_${student.full_name}.jpg`, { type: 'image/jpeg' });

            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: 'សញ្ញាបត្របញ្ជាក់ការសិក្សា',
                    text: `សូមអបអរសាទរ! នេះគឺជាសញ្ញាបត្របញ្ជាក់ការសិក្សារបស់អ្នកសម្រាប់វគ្គ "${course.title}"`
                });
            } else {
                const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(qrData)}&text=${encodeURIComponent(`សូមអបអរសាទរ! នេះគឺជាលិខិតបញ្ជាក់ការសិក្សារបស់អ្នកសម្រាប់វគ្គ "${course.title}"`)}`;
                window.open(shareUrl, '_blank');
            }
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error(e);
                alert("បរាជ័យក្នុងការចែករំលែក: " + e.message);
            }
        } finally {
            sharingCerts.delete(result.id);
            sharingCerts = sharingCerts;
        }
    }

    async function batchDownloadCertificates() {
        const allData = await fetchAllForExport();
        const passedResults = allData.filter(r => r.passed && r.type !== 'pre' && r.cert_template_url);
        if (passedResults.length === 0) return alert("គ្មានសិស្សដែលប្រឡងជាប់និងមានទម្រង់សញ្ញាបត្រសម្រាប់ទាញយកទេ!");

        const CHUNK_SIZE = 200;
        const totalChunks = Math.ceil(passedResults.length / CHUNK_SIZE);
        const confirmMsg = passedResults.length > CHUNK_SIZE
            ? `មានសញ្ញាបត្រ ${passedResults.length} សន្លឹក។ ប្រព័ន្ធនឹងទាញយកជា ${totalChunks} ឯកសារ ZIP (${CHUNK_SIZE} សន្លឹកក្នុងមួយ ZIP) ដើម្បីការពារ RAM។ បន្ត?`
            : `តើអ្នកពិតជាចង់ទាញយកសញ្ញាបត្រចំនួន ${passedResults.length} សន្លឹក (File ZIP) មែនទេ?`;
        if (!confirm(confirmMsg)) return;

        isBatchDownloading = true;
        batchCancelled = false;
        batchProgressTotal = passedResults.length;
        batchProgressCurrent = 0;
        batchProgressText = 'កំពុងរៀបចំប្រព័ន្ធ...';

        try {
            const { jsPDF } = await import('jspdf');
            const JSZipModule = await import('jszip');
            const JSZip = JSZipModule.default || JSZipModule;
            const { drawCertificate } = await import('$lib/certificate.js');
            const logo = loginLogoUrl || '/ccn-logo.png';
            const canvas = document.createElement('canvas');

            const uniqueCourseIds = [...new Set(passedResults.map(r => r.course_id))];
            const baseZipName = uniqueCourseIds.length === 1
                ? (courses.find(c => String(c.id) === String(uniqueCourseIds[0]))?.title || 'Batch').replace(/[\/\\?%*:|"<>]/g, '-')
                : `Batch_Certificates_${new Date().toISOString().split('T')[0]}`;

            for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
                if (batchCancelled) break;
                const chunk = passedResults.slice(chunkIndex * CHUNK_SIZE, (chunkIndex + 1) * CHUNK_SIZE);
                const zip = new JSZip();

                for (let i = 0; i < chunk.length; i++) {
                    if (batchCancelled) break;
                    const globalIndex = chunkIndex * CHUNK_SIZE + i;
                    batchProgressCurrent = globalIndex + 1;
                    batchProgressText = totalChunks > 1
                        ? `ZIP ${chunkIndex + 1}/${totalChunks} — គូរ (${globalIndex + 1}/${passedResults.length})...`
                        : `កំពុងគូរសញ្ញាបត្រ (${globalIndex + 1}/${passedResults.length})...`;
                    // yield to UI so progress bar updates and browser stays responsive
                    await new Promise(r => setTimeout(r, 0));

                    const result = chunk[i];
                    const course = courses.find(c => String(c.id) === String(result.course_id));
                    const student = { id: result.user_id, full_name: result.full_name || 'អនាមិក', name_latin: result.name_latin || '', phone_number: result.phone_number || '' };
                    const certId = `CCN-${String(result.id).padStart(3, '0')}`;
                    const dateStr = new Date(result.created_at).toLocaleDateString('km-KH');
                    const qrData = `${window.location.origin}/verify?u=${student.id}&c=${course.id}`;

                    await drawCertificate(canvas, course, student, certId, dateStr, qrData, logo);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                    const orientation = canvas.width > canvas.height ? 'l' : 'p';
                    const pdf = new jsPDF(orientation, 'mm', 'a4');
                    pdf.addImage(dataUrl, 'JPEG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight());
                    const pdfBlob = pdf.output('blob');
                    const safeTitle = course.title.replace(/[\/\\?%*:|"<>]/g, '-');
                    const safeName = student.full_name.replace(/[\/\\?%*:|"<>]/g, '-');
                    zip.file(`${safeName}_${certId}_${safeTitle}.pdf`, pdfBlob);
                }

                if (batchCancelled) break;
                batchProgressText = `កំពុងចងក្រង ZIP ${chunkIndex + 1}/${totalChunks} (សូមរង់ចាំ)...`;
                await new Promise(r => setTimeout(r, 0));
                const zipBlob = await zip.generateAsync({ type: 'blob' });

                const suffix = totalChunks > 1 ? `_Part${chunkIndex + 1}of${totalChunks}` : '';
                const url = URL.createObjectURL(zipBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${baseZipName}${suffix}.zip`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                // delay revoke so browser can start the download before URL disappears
                setTimeout(() => URL.revokeObjectURL(url), 2000);

                if (chunkIndex < totalChunks - 1) {
                    batchProgressText = `បានបញ្ចប់ ZIP ${chunkIndex + 1}/${totalChunks}។ ត្រៀម ZIP ក្រោយ...`;
                    // pause so browser can process the download + allow garbage collection
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        } catch (e) {
            if (!batchCancelled) alert("បរាជ័យក្នុងការទាញយកសញ្ញាបត្រជាក្រុម: " + e.message);
        } finally {
            isBatchDownloading = false;
            batchCancelled = false;
        }
    }
</script>

<!-- Batch Download Progress Overlay -->
{#if isBatchDownloading}
    <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" transition:fade={{ duration: 200 }}>
        <div class="bg-white p-6 rounded-2xl shadow-2xl w-full max-w-sm text-center">
            <div class="mb-4">
                <span class="text-4xl inline-block animate-bounce">📦</span>
            </div>
            <h3 class="font-bold text-lg text-gray-800 mb-2">កំពុងទាញយកសញ្ញាបត្រ</h3>
            <p class="text-sm text-gray-500 mb-4">{batchProgressText}</p>
            
            <div class="w-full bg-gray-100 rounded-full h-3 mb-2 overflow-hidden shadow-inner">
                <div class="bg-primary h-3 rounded-full transition-all duration-300" style="width: {batchProgressTotal > 0 ? Math.round((batchProgressCurrent / batchProgressTotal) * 100) : 0}%"></div>
            </div>
            <div class="text-xs font-bold text-primary mb-4">
                {batchProgressTotal > 0 ? Math.round((batchProgressCurrent / batchProgressTotal) * 100) : 0}%
                ({batchProgressCurrent}/{batchProgressTotal})
            </div>
            <button class="btn btn-sm btn-error" on:click={() => { batchCancelled = true; batchProgressText = 'កំពុងបោះបង់...'; }}
                disabled={batchCancelled}>
                ✖ បោះបង់
            </button>
        </div>
    </div>
{/if}

<div class="card bg-base-100 p-5 shadow-md border border-base-300">
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
            <h3 class="font-bold text-xl text-gray-800">📜 ប្រវត្តិប្រឡងរបស់សិស្ស</h3>
            <p class="text-sm text-gray-500">មើលលទ្ធផលតេស្ត Pre-test និង Post-test</p>
        </div>
        
        <div class="flex flex-wrap gap-2 w-full md:w-auto justify-end">
            {#if selectedCourseFilter}
                <button class="btn btn-sm btn-secondary shadow-sm hover:shadow-md animate-pulse" on:click={analyzeQuizQuestions}>
                    📊 វិភាគសំណួរ
                </button>
            {/if}
            <button class="btn btn-sm btn-warning shadow-sm hover:shadow-md" on:click={openManualScoreModal}>
                ✏️ ដាក់ពិន្ទុ
            </button>
            <button class="btn btn-sm btn-primary shadow-sm hover:shadow-md" on:click={loadQuizResults}>
                {#if loadingQuizResults}<span class="loading loading-spinner loading-xs"></span>{/if} Refresh
            </button>
            <div class="flex flex-wrap gap-1 bg-base-200/50 p-1 px-2 rounded-lg border border-base-300 items-center">
                <span class="text-xs font-bold text-gray-500 mr-1 hidden lg:inline-block">Export:</span>
                <button class="btn btn-xs btn-info text-white shadow-sm" on:click={exportPrePostReport} disabled={isExporting} title="របាយការណ៍ Pre/Post">{#if isExporting}<span class="loading loading-spinner loading-xs"></span>{/if} 📈 Pre/Post</button>
                <button class="btn btn-xs btn-success text-white shadow-sm" on:click={exportQuizResultsToExcel} disabled={isExporting} title="ទាញយកទិន្នន័យទាំងអស់">{#if isExporting}<span class="loading loading-spinner loading-xs"></span>{/if} 📊 All Data</button>
                <button class="btn btn-xs btn-secondary text-white shadow-sm" on:click={batchDownloadCertificates} disabled={isBatchDownloading || isExporting} title="ទាញយកសញ្ញាបត្រទាំងអស់ (ZIP)">
                    {#if isBatchDownloading || isExporting}<span class="loading loading-spinner loading-xs"></span>{/if} 🎓 Batch Certs
                </button>
            </div>
        </div>
    </div>
    
    <!-- Filters & Search -->
    <div class="bg-base-200/50 p-3 border border-base-300 rounded-xl mb-4 flex flex-col xl:flex-row gap-3 items-start xl:items-center justify-between">
        <div class="flex flex-wrap gap-2 w-full xl:w-auto flex-1 items-center">
            <div class="relative w-full sm:w-auto sm:min-w-[200px]">
                {#if isQuizSearching}
                    <span class="absolute left-2.5 top-1/2 -translate-y-1/2 loading loading-spinner loading-xs text-primary"></span>
                {:else}
                    <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
                {/if}
                <input type="text" bind:value={quizSearch} on:input={() => isQuizSearching = true} placeholder="ស្វែងរកឈ្មោះ, លេខទូរស័ព្ទ..." class="input input-sm input-bordered w-full pl-8" />
            </div>
            <select bind:value={selectedCourseFilter} on:change={handleCourseChange} class="select select-sm select-bordered w-full sm:w-auto sm:max-w-xs">
                <option value="none" disabled>📚 ជ្រើសរើសវគ្គ...</option>
                <option value="">📚 គ្រប់វគ្គទាំងអស់</option>
                {#each courses as course}
                    <option value={course.id}>{course.title}</option>
                {/each}
            </select>
            <select bind:value={quizTypeFilter} on:change={handleFilterChange} class="select select-sm select-bordered w-full sm:w-auto">
                <option value="">📝 លទ្ធផលទាំងអស់</option>
                <option value="pre">🔵 Pre-test</option>
                <option value="post">🟢 Post-test</option>
            </select>
            <select bind:value={quizStatusFilter} on:change={handleFilterChange} class="select select-sm select-bordered w-full sm:w-auto">
                <option value="">📊 ស្ថានភាពទាំងអស់</option>
                <option value="passed">✅ ជាប់ (Passed)</option>
                <option value="failed">❌ ធ្លាក់ (Failed)</option>
            </select>
            <div class="flex items-center gap-1 w-full sm:w-auto">
                <input type="date" bind:value={quizStartDate} on:change={handleFilterChange} class="input input-sm input-bordered w-full sm:w-auto" title="ចាប់ពីថ្ងៃ (Start Date)" />
                <span class="text-gray-400 text-xs">-</span>
                <input type="date" bind:value={quizEndDate} on:change={handleFilterChange} class="input input-sm input-bordered w-full sm:w-auto" title="ដល់ថ្ងៃ (End Date)" />
                {#if quizSearch || selectedCourseFilter || quizStartDate || quizEndDate || quizStatusFilter || quizTypeFilter}
                    <button class="btn btn-xs btn-square btn-outline btn-error ml-1" on:click={resetQuizFilters} title="Reset Filter">
                        ✕
                    </button>
                {/if}
            </div>
        </div>
    </div>

    {#if quizSummaryStats.total > 0}
    <div class="mb-4">
        <div class="flex items-center justify-between mb-2">
            <button class="flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-primary transition-colors" on:click={() => showQuizSummary = !showQuizSummary}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 transition-transform {showQuizSummary ? 'rotate-90' : ''}"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                📊 សង្ខេបទិន្នន័យ ({quizSummaryStats.total} នាក់)
            </button>
            {#if showQuizSummary}
                <div class="flex gap-2">
                    <button class="btn btn-xs btn-square btn-warning text-white shadow-sm text-base" on:click={printQuizSummaryStats} title="ព្រីនតារាងសង្ខេប (Print/PDF)">🖨️</button>
                    <button class="btn btn-xs btn-square btn-success text-white shadow-sm text-base" on:click={exportQuizSummaryStatsToExcel} title="ទាញយកតារាងសង្ខេបជា Excel">📊</button>
                </div>
            {/if}
        </div>

        {#if showQuizSummary}
        <div class="space-y-3 mb-6" transition:slide={{ duration: 200 }}>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div class="stat bg-blue-50/50 border border-blue-100/50 rounded-xl p-3">
                    <div class="stat-title text-blue-900 font-bold text-xs">សរុប (Total)</div>
                    <div class="stat-value text-blue-600 text-xl">{quizStats.total}</div>
                </div>
                <div class="stat bg-green-50/50 border border-green-100/50 rounded-xl p-3">
                    <div class="stat-title text-green-900 font-bold text-xs">ជាប់ (Passed)</div>
                    <div class="stat-value text-green-600 text-xl">{quizStats.passed}</div>
                </div>
                <div class="stat bg-red-50/50 border border-red-100/50 rounded-xl p-3">
                    <div class="stat-title text-red-900 font-bold text-xs">ធ្លាក់ (Failed)</div>
                    <div class="stat-value text-red-600 text-xl">{quizStats.failed}</div>
                </div>
                <div class="stat bg-yellow-50/50 border border-yellow-100/50 rounded-xl p-3">
                    <div class="stat-title text-yellow-900 font-bold text-xs">អត្រាជាប់ (Rate)</div>
                    <div class="stat-value text-yellow-600 text-xl">{quizStats.passRate}%</div>
                </div>
            </div>
            
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <!-- សង្ខេបភេទ -->
        <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-3 shadow-sm">
            <div class="text-xs font-bold text-indigo-700 mb-2 border-b border-indigo-200 pb-1">ភេទ</div>
            <div class="space-y-1">
                {#each Object.entries(quizSummaryStats.gender).sort((a,b) => b[1]-a[1]) as [label, count]}
                <div class="flex justify-between items-center gap-2">
                    <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                    <span class="text-xs font-bold text-indigo-700 shrink-0">{count}</span>
                    <div class="w-16 bg-indigo-200/50 rounded-full h-1.5 shrink-0">
                        <div class="bg-indigo-500 h-1.5 rounded-full" style="width:{Math.round(count/quizSummaryStats.total*100)}%"></div>
                    </div>
                </div>
                {/each}
            </div>
        </div>

        <!-- សង្ខេបតួនាទី -->
        <div class="bg-violet-50 border border-violet-100 rounded-xl p-3 shadow-sm">
            <div class="text-xs font-bold text-violet-700 mb-2 border-b border-violet-200 pb-1">មុខតំណែង / កម្រិតជំនាញ</div>
            <div class="space-y-1 max-h-32 overflow-y-auto pr-1">
                {#each Object.entries(quizSummaryStats.position).sort((a,b) => b[1]-a[1]) as [label, count]}
                <div class="flex justify-between items-center gap-2">
                    <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                    <span class="text-xs font-bold text-violet-700 shrink-0">{count}</span>
                    <div class="w-16 bg-violet-200/50 rounded-full h-1.5 shrink-0">
                        <div class="bg-violet-500 h-1.5 rounded-full" style="width:{Math.round(count/quizSummaryStats.total*100)}%"></div>
                    </div>
                </div>
                {/each}
            </div>
        </div>

        <!-- សង្ខេបទីកន្លែងការងារ -->
        <div class="bg-teal-50 border border-teal-100 rounded-xl p-3 shadow-sm">
            <div class="text-xs font-bold text-teal-700 mb-2 border-b border-teal-200 pb-1">កន្លែងធ្វើការ</div>
            <div class="space-y-1 max-h-32 overflow-y-auto pr-1">
                {#each Object.entries(quizSummaryStats.workplace).sort((a,b) => b[1]-a[1]) as [label, count]}
                <div class="flex justify-between items-center gap-2">
                    <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                    <span class="text-xs font-bold text-teal-700 shrink-0">{count}</span>
                    <div class="w-16 bg-teal-200/50 rounded-full h-1.5 shrink-0">
                        <div class="bg-teal-500 h-1.5 rounded-full" style="width:{Math.round(count/quizSummaryStats.total*100)}%"></div>
                    </div>
                </div>
                {/each}
            </div>
        </div>

        <!-- សង្ខេបរាជធានី/ខេត្ត -->
        <div class="bg-amber-50 border border-amber-100 rounded-xl p-3 shadow-sm">
            <div class="text-xs font-bold text-amber-700 mb-2 border-b border-amber-200 pb-1">រាជធានី/ខេត្ត</div>
            <div class="space-y-1 max-h-32 overflow-y-auto pr-1">
                {#each Object.entries(quizSummaryStats.province).sort((a,b) => b[1]-a[1]) as [label, count]}
                <div class="flex justify-between items-center gap-2">
                    <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                    <span class="text-xs font-bold text-amber-700 shrink-0">{count}</span>
                    <div class="w-16 bg-amber-200/50 rounded-full h-1.5 shrink-0">
                        <div class="bg-amber-500 h-1.5 rounded-full" style="width:{Math.round(count/quizSummaryStats.total*100)}%"></div>
                    </div>
                </div>
                {/each}
            </div>
        </div>

        <!-- សង្ខេបស្ថានភាពអាជ្ញាប័ណ្ណ -->
        <div class="bg-rose-50 border border-rose-100 rounded-xl p-3 shadow-sm">
            <div class="text-xs font-bold text-rose-700 mb-2 border-b border-rose-200 pb-1">ស្ថានភាពអាជ្ញាប័ណ្ណ</div>
            <div class="space-y-1 max-h-32 overflow-y-auto pr-1">
                {#each Object.entries(quizSummaryStats.licenseStatus).sort((a,b) => b[1]-a[1]) as [label, count]}
                <div class="flex justify-between items-center gap-2">
                    <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                    <span class="text-xs font-bold text-rose-700 shrink-0">{count}</span>
                    <div class="w-16 bg-rose-200/50 rounded-full h-1.5 shrink-0">
                        <div class="bg-rose-500 h-1.5 rounded-full" style="width:{Math.round(count/quizSummaryStats.total*100)}%"></div>
                    </div>
                </div>
                {/each}
            </div>
        </div>
            </div>
        </div>
        {/if}
    </div>
    {/if}

    <div class="overflow-x-auto bg-base-100 border border-base-300 rounded-xl">
        <table class="table table-xs w-full">
            <thead class="bg-base-200 text-base-content uppercase text-xs font-bold border-b border-base-300">
                <tr>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleQuizSort('created_at')}>
                        កាលបរិច្ឆេទ {quizSortColumn === 'created_at' ? (quizSortDirection === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th>
                        សិស្ស
                    </th>
                    <th>
                        វគ្គសិក្សា
                    </th>
                    <th>ប្រភេទ</th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleQuizSort('score')}>
                        ពិន្ទុ {quizSortColumn === 'score' ? (quizSortDirection === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th>លទ្ធផល</th>
                    <th>CPD</th>
                    <th class="text-right">សកម្មភាព</th>
                </tr>
            </thead>
            <tbody>
                {#each paginatedQuizResults as result, i}
                    <tr class="group hover border-b border-base-200 last:border-none transition-colors" in:fly={{ y: 20, duration: 300, delay: i * 40 }}>
                        <td class="text-xs text-gray-500 font-mono">
                            <div>{new Date(result.created_at).toLocaleDateString('km-KH')}</div>
                            <div class="text-[10px]">{new Date(result.created_at).toLocaleTimeString('km-KH')}</div>
                        </td>
                        <td class="cursor-pointer hover:bg-blue-50 transition-colors rounded-lg" on:click={() => result.full_name && dispatch('viewUserProfile', { full_name: result.full_name, name_latin: result.name_latin, phone_number: result.phone_number, gender: result.gender, profile_data: result.profile_data, avatar_url: result.avatar_url })} title="មើលប្រវត្តិរូបពេញ">
                            <div class="font-bold text-gray-800">{result.full_name || 'Unknown'}</div>
                            <div class="text-xs text-gray-600">{result.name_latin || ''}</div>
                            <div class="text-xs text-gray-500 font-mono">{result.phone_number || ''}</div>
                            {#if result.profile_data?.province}
                                <div class="text-[10px] text-gray-400 mt-0.5"> {result.profile_data.province}</div>
                            {/if}
                        </td>
                        <td>
                            <div class="font-medium text-gray-700 line-clamp-1" title={result.course_title}>{result.course_title || 'Unknown Course'}</div>
                        </td>
                        <td>
                            {#if result.type === 'pre'}
                                <span class="badge badge-sm badge-ghost border border-gray-300 rounded-lg">Pre-test</span>
                            {:else}
                                <span class="badge badge-sm badge-neutral border border-gray-300 rounded-lg">Post-test</span>
                            {/if}
                            {#if result.attempt_count > 1}
                                <button class="badge badge-ghost badge-sm text-[10px] mt-1 cursor-pointer hover:bg-blue-50 border-blue-200 text-blue-600 inline-flex" on:click|stopPropagation={() => viewHistory(result.user_id, result.course_id, result.type, result.full_name, result.course_title)}>
                                    ប្រវត្តិ ({result.attempt_count} ដង)
                                </button>
                            {/if}
                        </td>
                        <td class="font-bold font-mono">{result.score}%</td>
                        <td>
                            {#if result.passed}
                                <span class="badge badge-success text-white gap-1 border border-transparent rounded-lg">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3"><path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" /></svg>
                                    ជាប់
                                </span>
                            {:else}
                                <span class="badge badge-error text-white gap-1 border border-transparent rounded-lg">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" /></svg>
                                    ធ្លាក់
                                </span>
                            {/if}
                        </td>
                        <td class="font-bold text-primary">
                            {#if result.passed && result.type !== 'pre'}
                                +{result.cpd_points || 0}
                            {:else}
                                -
                            {/if}
                        </td>
                        <td class="text-right">
                            {#if result.passed && result.type !== 'pre' && result.cert_template_url}
                                <div class="flex items-center justify-end gap-1">
                                    <button class="btn btn-xs btn-outline btn-info" on:click={() => downloadStudentCertificate(result)} disabled={downloadingCerts.has(result.id)} title="ទាញយកសញ្ញាបត្រ (PDF)">
                                        {#if downloadingCerts.has(result.id)}<span class="loading loading-spinner loading-xs"></span>{:else}<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-3 h-3"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>{/if}
                                    </button>
                                    <button class="btn btn-xs btn-outline btn-primary" on:click={() => shareStudentCertificate(result)} disabled={sharingCerts.has(result.id)} title="ផ្ញើតាម Telegram ឬ Share">
                                        {#if sharingCerts.has(result.id)}<span class="loading loading-spinner loading-xs"></span>{:else}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>{/if}
                                    </button>
                                </div>
                            {:else}
                                <span class="text-gray-300">-</span>
                            {/if}
                        </td>
                    </tr>
                {:else}
                    {#if selectedCourseFilter === 'none'}
                        <tr><td colspan="8" class="text-center py-12 text-gray-400 italic">👆 សូមជ្រើសរើសវគ្គសិក្សា ដើម្បីមើលលទ្ធផល</td></tr>
                    {:else if !selectedCourseFilter && loadingQuizResults}
                        <tr><td colspan="8" class="text-center py-12"><span class="loading loading-spinner loading-md text-primary"></span> <span class="text-sm text-gray-500 ml-2">កាលទាញយកវគ្គទាំងអស់... (អាចចំណាយពេលបន្តិច)</span></td></tr>
                    {:else if loadingQuizResults}
                        <tr><td colspan="8" class="text-center py-12"><span class="loading loading-spinner loading-md text-primary"></span></td></tr>
                    {:else}
                        <tr><td colspan="8" class="text-center py-12 text-gray-400 italic">មិនមានទិន្នន័យ</td></tr>
                    {/if}
                {/each}
            </tbody>
        </table>
    </div>

    <!-- Pagination Controls -->
    <div class="flex flex-col md:flex-row justify-between items-center mt-4 gap-4">
        <div class="text-sm text-gray-500">
            បង្ហាញ {totalQuizRecords > 0 ? ((quizPage - 1) * quizPageSize) + 1 : 0} ដល់ {Math.min(quizPage * quizPageSize, totalQuizRecords)} នៃ {totalQuizRecords}
        </div>
        <div class="join">
            <button class="join-item btn btn-sm btn-outline" disabled={quizPage === 1} on:click={() => { quizPage--; applyFiltersAndPagination(); }}>«</button>
            <button class="join-item btn btn-sm btn-ghost">ទំព័រ {quizPage} / {totalQuizPages || 1}</button>
            <button class="join-item btn btn-sm btn-outline" disabled={quizPage === totalQuizPages || totalQuizPages === 0} on:click={() => { quizPage++; applyFiltersAndPagination(); }}>»</button>
        </div>
        <select bind:value={quizPageSize} on:change={() => { quizPage = 1; applyFiltersAndPagination(); }} class="select select-bordered select-sm">
            <option value={10}>10 / ទំព័រ</option>
            <option value={20}>20 / ទំព័រ</option>
            <option value={50}>50 / ទំព័រ</option>
            <option value={100}>100 / ទំព័រ</option>
        </select>
    </div>
</div>

<!-- Question Analytics Modal -->
{#if showQuestionAnalyticsModal}
    <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" on:click|self={() => showQuestionAnalyticsModal = false} transition:fade={{ duration: 200 }}>
        <div class="card bg-base-100 shadow-2xl w-full max-w-4xl mx-4 p-0 rounded-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div class="p-6 border-b border-base-300 bg-base-200/50 flex justify-between items-center">
                <div>
                    <h3 class="font-bold text-xl text-gray-800">📊 ការវិភាគសំណួរ (Question Analytics)</h3>
                    <p class="text-sm text-gray-500 mt-1">ចំណាត់ថ្នាក់សំណួរដែលសិស្សឆ្លើយខុសច្រើនជាងគេ</p>
                </div>
                <div class="flex gap-2 items-center">
                    {#if questionAnalyticsData.length > 0 && !analyzingQuestions}
                        <button class="btn btn-sm btn-error text-white gap-1" on:click={exportQuestionAnalyticsPDF}>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                            ទាញយក PDF
                        </button>
                        <button class="btn btn-sm btn-success text-white gap-1" on:click={exportQuestionAnalytics}>
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                            ទាញយក Excel
                        </button>
                    {/if}
                    <button class="btn btn-ghost btn-sm btn-circle" on:click={() => showQuestionAnalyticsModal = false}>✕</button>
                </div>
            </div>
            
            <div class="p-6 overflow-y-auto flex-1">
                {#if analyzingQuestions}
                    <div class="flex flex-col items-center justify-center py-10 text-gray-500 gap-3">
                        <span class="loading loading-spinner loading-lg text-secondary"></span>
                        <span>កំពុងវិភាគទិន្នន័យ...</span>
                    </div>
                {:else if questionAnalyticsData.length === 0}
                    <div class="text-center py-10 text-gray-400">មិនមានទិន្នន័យសំណួរសម្រាប់វគ្គនេះទេ</div>
                {:else}
                    <div class="space-y-4">
                        {#each questionAnalyticsData as q, idx}
                            <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:border-secondary/50 transition-colors">
                                <div class="flex gap-4 items-start">
                                    <div class="w-8 h-8 rounded-full bg-base-200 flex items-center justify-center font-bold text-gray-500 shrink-0">{idx + 1}</div>
                                    <div class="flex-1">
                                        <h4 class="font-bold text-gray-800 mb-2 leading-relaxed">{q.question}</h4>
                                        <div class="flex items-center gap-4 text-xs font-medium text-gray-500 mb-2">
                                            <span class="text-blue-600">ឆ្លើយសរុប: {q.totalAttempts} ដង</span>
                                            <span class="text-green-600">✅ ត្រូវ: {q.correct}</span>
                                            <span class="text-red-600">❌ ខុស: {q.wrong}</span>
                                        </div>
                                        <div class="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                                            <div class="h-full rounded-full transition-all {q.errorRate >= 50 ? 'bg-red-500' : q.errorRate >= 30 ? 'bg-orange-400' : 'bg-green-500'}" style="width: {q.errorRate}%"></div>
                                        </div>
                                        <div class="text-right text-xs mt-1 font-bold {q.errorRate >= 50 ? 'text-red-600' : 'text-gray-600'}">អត្រាខុស (Error Rate): {q.errorRate}%</div>
                                    </div>
                                </div>
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<!-- History Modal -->
{#if showHistoryModal}
    <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm" on:click|self={() => showHistoryModal = false} transition:fade={{ duration: 200 }}>
        <div class="card bg-base-100 shadow-2xl w-full max-w-2xl mx-4 p-0 rounded-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div class="p-6 border-b border-base-300 bg-base-200/50 flex justify-between items-center">
                <div>
                    <h3 class="font-bold text-lg text-gray-800">ប្រវត្តិប្រឡងលម្អិត</h3>
                    <p class="text-sm text-gray-500 mt-1">សិស្ស: <span class="font-bold text-primary">{selectedHistoryStudent}</span> | វគ្គ: <span class="font-bold">{selectedHistoryCourse}</span></p>
                </div>
                <button class="btn btn-ghost btn-sm btn-circle" on:click={() => showHistoryModal = false}>✕</button>
            </div>
            
            <div class="p-0 overflow-y-auto flex-1">
                <table class="table table-sm w-full">
                    <thead class="bg-gray-50 sticky top-0 shadow-sm">
                        <tr>
                            <th>លើកទី</th>
                            <th>កាលបរិច្ឆេទ</th>
                            <th>ពិន្ទុ</th>
                            <th>លទ្ធផល</th>
                            <th class="text-right">សកម្មភាព</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each selectedHistory as hist, idx}
                            <tr class="hover">
                                <td class="font-bold text-gray-500">{selectedHistory.length - idx}</td>
                                <td>
                                    <div>{new Date(hist.created_at).toLocaleDateString('km-KH')}</div>
                                    <div class="text-[10px] text-gray-400">{new Date(hist.created_at).toLocaleTimeString('km-KH')}</div>
                                </td>
                                <td class="font-bold font-mono">{hist.score}%</td>
                                <td>
                                    {#if hist.passed}
                                        <span class="badge badge-success text-white badge-sm gap-1">✅ ជាប់</span>
                                    {:else}
                                        <span class="badge badge-error text-white badge-sm gap-1">❌ ធ្លាក់</span>
                                    {/if}
                                </td>
                                <td class="text-right">
                                    <button class="btn btn-xs btn-outline btn-info mr-1" on:click={() => editHistoryScore(hist)}>កែពិន្ទុ</button>
                                    <button class="btn btn-xs btn-outline btn-error" on:click={() => deleteHistoryRecord(hist.id)}>លុប</button>
                                </td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
            <div class="bg-base-200/50 p-4 border-t border-base-300 flex justify-end gap-2">
                <button class="btn btn-sm btn-info text-white" on:click={printStudentHistory}>🖨️ PDF</button>
                <button class="btn btn-sm" on:click={() => showHistoryModal = false}>បិទ</button>
            </div>
        </div>
    </div>
{/if}

<!-- Manual Score Modal -->
{#if showManualScoreModal}
    <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm" on:click|self={() => showManualScoreModal = false} transition:fade={{ duration: 200 }}>
        <div class="card bg-base-100 shadow-2xl w-full max-w-lg mx-4 p-6 rounded-2xl max-h-[90vh] flex flex-col">
            <div class="flex justify-between items-center mb-5">
                <h3 class="font-bold text-lg text-gray-800">✏️ ដាក់ពិន្ទុដោយដៃ</h3>
                <button class="btn btn-ghost btn-sm btn-circle" on:click={() => showManualScoreModal = false}>✕</button>
            </div>

            <!-- TAB SELECTOR -->
            <div class="tabs tabs-boxed mb-4 gap-1 p-1 bg-base-200 w-full rounded-xl font-bold">
                <button class="tab flex-1 {manualScoreTab === 'manual' ? 'tab-active bg-white text-orange-500 shadow-sm' : 'text-gray-500 hover:text-gray-700'} rounded-lg transition-all" on:click={() => manualScoreTab = 'manual'}>
                    ✏️ ម្នាក់ម្តង
                </button>
                <button class="tab flex-1 {manualScoreTab === 'excel' ? 'tab-active bg-[#4F46E5] text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'} rounded-lg transition-all" on:click={() => manualScoreTab = 'excel'}>
                    📊 Import CSV/Excel
                </button>
            </div>

            <div class="flex flex-col gap-4 overflow-y-auto flex-1 pr-1">
                
                <!-- Course select (Shared) -->
                <div>
                    <label class="label pb-1"><span class="label-text font-semibold">វគ្គសិក្សា</span></label>
                    <select bind:value={manualScoreCourseId} class="select select-bordered w-full">
                        <option value="">-- ជ្រើសរើសវគ្គ --</option>
                        {#each courses as c}
                            <option value={c.id}>{c.title}</option>
                        {/each}
                    </select>
                </div>

                <!-- Date + Type row (Shared) -->
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="label pb-1"><span class="label-text font-semibold">ថ្ងៃខែប្រឡង</span></label>
                        <input type="date" bind:value={manualScoreDate} class="input input-bordered w-full" />
                    </div>
                    <div>
                        <label class="label pb-1"><span class="label-text font-semibold">ប្រភេទ</span></label>
                        <div class="join w-full">
                            <button class="join-item btn flex-1 btn-sm {manualScoreType === 'pre' ? 'bg-[#4F46E5] text-white' : 'btn-outline border-base-300'}" on:click={() => manualScoreType = 'pre'}>Pre</button>
                            <button class="join-item btn flex-1 btn-sm {manualScoreType === 'post' ? 'bg-[#4F46E5] text-white' : 'btn-outline border-base-300'}" on:click={() => manualScoreType = 'post'}>Post</button>
                        </div>
                    </div>
                </div>

                {#if manualScoreTab === 'manual'}
                    <!-- Student multi-select with search -->
                    <div>
                        <div class="flex items-center justify-between mb-1">
                            <span class="label-text font-semibold">សិស្ស</span>
                            {#if manualScoreSelectedUsers.length > 0}
                                <span class="badge badge-warning badge-sm font-bold">{manualScoreSelectedUsers.length} នាក់បានជ្រើស</span>
                            {/if}
                        </div>
                        <input type="text" bind:value={manualScoreSearch} placeholder="🔍 ស្វែងរកតាមឈ្មោះ ឬលេខទូរស័ព្ទ..." class="input input-bordered input-sm w-full mb-2" />
                        {#if manualScoreUsers.length === 0}
                            <div class="flex items-center gap-2 text-sm text-gray-400 p-2"><span class="loading loading-spinner loading-xs"></span> កំពុងទាញយក...</div>
                        {:else}
                            <div class="border border-base-300 rounded-xl overflow-y-auto max-h-44 divide-y divide-base-200">
                                {#if manualScoreFiltered.length === 0}
                                    <div class="text-center text-sm text-gray-400 py-4">រកមិនឃើញ</div>
                                {:else}
                                    {#each manualScoreFiltered as u}
                                        {@const checked = manualScoreSelectedUsers.includes(u.id)}
                                        <label class="flex items-center gap-3 px-3 py-2 hover:bg-base-200 cursor-pointer {checked ? 'bg-warning/10' : ''}">
                                            <input type="checkbox" checked={checked}
                                                on:change={() => manualScoreSelectedUsers = checked
                                                    ? manualScoreSelectedUsers.filter(id => id !== u.id)
                                                    : [...manualScoreSelectedUsers, u.id]}
                                                class="checkbox checkbox-warning checkbox-sm" />
                                            <div class="flex-1 min-w-0">
                                                <div class="font-medium text-sm truncate">{u.full_name || u.name_latin || '—'}</div>
                                                {#if u.name_latin && u.full_name}
                                                    <div class="text-xs text-gray-400 truncate">{u.name_latin}</div>
                                                {/if}
                                            </div>
                                            {#if u.phone_number}
                                                <span class="text-xs text-gray-400 shrink-0">{u.phone_number}</span>
                                            {/if}
                                        </label>
                                    {/each}
                                {/if}
                            </div>
                            {#if manualScoreFiltered.length === 100}
                                <div class="text-center text-xs text-gray-400 py-1 bg-base-200/50 mt-1 rounded">បង្ហាញត្រឹម ១០០ នាក់ (សូមវាយឈ្មោះដើម្បីស្វែងរកបន្ថែម)</div>
                            {/if}
                            {#if manualScoreSelectedUsers.length > 0}
                                <button class="btn btn-xs btn-ghost text-error mt-1" on:click={() => manualScoreSelectedUsers = []}>✕ លុបការជ្រើសរើសទាំងអស់</button>
                            {/if}
                        {/if}
                    </div>

                    <!-- Score -->
                    <div>
                        <label class="label pb-1">
                            <span class="label-text font-semibold">ពិន្ទុ (%)</span>
                            <span class="label-text-alt font-bold text-primary text-base">{manualScoreValue}%</span>
                        </label>
                        <input type="range" min="0" max="100" bind:value={manualScoreValue} class="range range-primary range-sm w-full" />
                        <div class="flex justify-between text-xs text-gray-400 mt-1 px-1">
                            <span>0%</span><span>50%</span><span>100%</span>
                        </div>
                        <input type="number" min="0" max="100" bind:value={manualScoreValue} class="input input-bordered w-full mt-2 text-center font-bold text-lg" placeholder="0–100" />
                    </div>

                    {#if manualScoreCourseId}
                        {@const selCourse = courses.find(c => c.id === manualScoreCourseId)}
                        {@const passing = selCourse?.quiz_passing_score || 70}
                        <div class="alert {parseInt(manualScoreValue) >= passing ? 'alert-success' : 'alert-error'} py-2 text-sm">
                            {parseInt(manualScoreValue) >= passing ? '✅ ជាប់' : '❌ ធ្លាក់'} — ពិន្ទុអប្បបរមា {passing}%
                        </div>
                    {/if}
                {:else}
                    <!-- CSV Import Specific UI -->
                    <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mt-2">
                        <div class="flex items-center gap-2 font-bold text-blue-800 mb-2">
                            📋 របៀបប្រើ៖
                        </div>
                        <ol class="list-decimal ml-5 text-sm text-blue-700 space-y-1">
                            <li>ទាញយក Template &rarr; បំពេញក្នុង Excel</li>
                            <li>Save As &rarr; <b>CSV (UTF-8)</b></li>
                            <li>Upload ឯកសារ CSV ខាងក្រោម</li>
                        </ol>
                        <div class="text-xs text-blue-600 mt-2">Columns: phone_number, score, type, date</div>
                    </div>

                    <div class="alert alert-warning shadow-sm py-2 text-xs text-orange-800 bg-orange-50 border-orange-200 rounded-xl">
                        <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-4 w-4" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        <span><b>Excel strip leading zero:</b> ប្រព័ន្ធ auto-detect ហើយ prepend 0 ឱ្យ phone number ដែលខ្វះ (ឧ. 123456789 &rarr; 0123456789)។ Template ប្រើ ="0..." format ដើម្បីការពារ។</span>
                    </div>

                    <button class="btn btn-outline btn-info w-full" on:click={downloadImportTemplate}>
                        ⬇️ ទាញយក Template CSV
                    </button>

                    <div class="form-control">
                        <input type="file" accept=".csv" class="file-input file-input-bordered file-input-primary w-full" on:change={handleExcelFileSelect} />
                    </div>

                    {#if excelImportLoading}
                        <div class="text-center py-4"><span class="loading loading-spinner"></span> កំពុងអាន...</div>
                    {:else if excelImportError}
                        <div class="alert alert-error text-sm">{excelImportError}</div>
                    {:else if excelImportRows.length > 0}
                        <div class="text-sm">
                            បានអាន <b>{excelImportRows.length}</b> ជួរ —
                            <span class="text-success font-bold">ត្រឹមត្រូវ {excelValidCount}</span>,
                            <span class="text-error font-bold">មានបញ្ហា {excelErrorCount}</span>
                        </div>
                        <div class="overflow-y-auto max-h-40 border border-base-200 rounded-lg">
                            <table class="table table-xs table-pin-rows">
                                <thead><tr><th>ជួរ</th><th>លេខទូរស័ព្ទ</th><th>សិស្ស</th><th>ពិន្ទុ</th><th>បញ្ហា</th></tr></thead>
                                <tbody>
                                    {#each excelImportRows as r}
                                        <tr class={r.valid ? '' : 'bg-red-50 text-error'}>
                                            <td>{r.row}</td>
                                            <td>{r.phone_number}</td>
                                            <td><div class="max-w-[100px] truncate">{r.full_name}</div></td>
                                            <td>{r.score !== null ? r.score : '-'}</td>
                                            <td>{r.errorMsg}</td>
                                        </tr>
                                    {/each}
                                </tbody>
                            </table>
                        </div>
                    {/if}
                {/if}
            </div>

            <div class="flex justify-end gap-3 mt-5 pt-4 border-t border-base-200 items-center">
                {#if manualScoreTab === 'excel'}
                    <label class="cursor-pointer label gap-2 mr-auto">
                        <input type="checkbox" bind:checked={excelReplaceMode} class="toggle toggle-warning toggle-sm" />
                        <span class="label-text text-xs font-bold text-orange-500">Replace (លុបចាស់ + ដាក់ថ្មី)</span>
                    </label>
                    <button class="btn btn-ghost" on:click={() => showManualScoreModal = false}>បោះបង់</button>
                    <button class="btn text-white bg-[#4F46E5] hover:bg-[#4338CA]" disabled={manualScoreLoading || !excelValidCount || !manualScoreCourseId} on:click={submitExcelImport}>
                        {#if manualScoreLoading}<span class="loading loading-spinner loading-xs"></span>{/if}
                        Import ឆាក
                    </button>
                {:else}
                    <button class="btn btn-ghost" on:click={() => showManualScoreModal = false}>បោះបង់</button>
                    <button class="btn btn-warning text-white" disabled={manualScoreLoading || !manualScoreSelectedUsers.length || !manualScoreCourseId} on:click={submitManualScore}>
                        {#if manualScoreLoading}<span class="loading loading-spinner loading-xs"></span>{/if}
                        រក្សាទុក{#if manualScoreSelectedUsers.length > 1} ({manualScoreSelectedUsers.length} នាក់){/if}
                    </button>
                {/if}
            </div>
        </div>
    </div>
{/if}