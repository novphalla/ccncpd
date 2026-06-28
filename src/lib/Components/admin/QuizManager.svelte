<script>
    import { createEventDispatcher } from 'svelte';
    import { flip } from 'svelte/animate';
    import { 
        PencilIcon, Trash2Icon, SaveIcon, XIcon, UploadIcon, 
        DownloadIcon, ImageIcon, GripVerticalIcon, PlusIcon
    } from 'lucide-svelte';

    export let supabase;
    export let editingCourse;
    export let editingQuestions = [];

    const dispatch = createEventDispatcher();

    let loading = false;
    let newQuestion = { question: '', options: [], correct_answer: '', explanation: '', image_url: '' };
    let editingQuestionId = null;

    async function loadQuestions() {
        if (!editingCourse?.id) return;
        loading = true;
        const { data, error } = await supabase.from('quiz_questions').select('*').eq('course_id', editingCourse.id).order('sort_order', { ascending: true }).order('id', { ascending: true });
        if (error) console.error(error);
        else editingQuestions = data || [];
        loading = false;
    }

    // Load questions when course changes
    $: if (editingCourse?.id) loadQuestions();

    function addOption() {
        newQuestion.options = [...newQuestion.options, ''];
    }

    function removeOption(index) {
        newQuestion.options = newQuestion.options.filter((_, i) => i !== index);
    }

    async function handleQuestionImage(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        loading = true;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', 'quiz_assets');

        try {
            const res = await fetch('/api/storage', { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) return alert("Upload Error: " + data.error);
            
            newQuestion.image_url = data.publicUrl;
        } catch (error) {
            alert("Upload failed: " + error.message);
        } finally {
            loading = false;
        }
    }

    async function saveQuestion() {
        const validOptions = [];
        let newCorrectIndex = null;

        for (let i = 0; i < newQuestion.options.length; i++) {
            const opt = newQuestion.options[i].trim();
            if (opt) {
                validOptions.push(opt);
                if (i === newQuestion.correct_answer) newCorrectIndex = validOptions.length - 1;
            }
        }

        if (!newQuestion.question || validOptions.length < 2 || newCorrectIndex === null) return alert('សូមបំពេញសំណួរ, យ៉ាងហោចណាស់ជម្រើស ២, និងចម្លើយត្រឹមត្រូវ (ដែលមិនទទេ)!');
        
        // ផ្ទៀងផ្ទាត់កុំឱ្យសំណួរជាន់គ្នា (ស្ទួន) នៅក្នុងវគ្គនេះ
        const isDuplicate = editingQuestions.some(q => 
            q.question.trim().toLowerCase() === newQuestion.question.trim().toLowerCase() && 
            q.id !== editingQuestionId
        );
        if (isDuplicate) {
            return alert('សំណួរនេះមានរួចហើយនៅក្នុងវគ្គនេះ! សូមពិនិត្យមើល និងកែប្រែជំនួសវិញ។');
        }

        const payload = { 
            course_id: editingCourse.id, 
            question: newQuestion.question, 
            options: validOptions, 
            correct_answer: newCorrectIndex, 
            explanation: newQuestion.explanation,
            image_url: newQuestion.image_url
        };

        let error;
        if (editingQuestionId) {
            const { error: err } = await supabase.from('quiz_questions').update(payload).eq('id', editingQuestionId);
            error = err;
        } else {
            const { error: err } = await supabase.from('quiz_questions').insert(payload);
            error = err;
        }

        if (error) alert(error.message);
        else {
            cancelEdit();
            loadQuestions(); // Reload local list
            dispatch('refresh');
        }
    }

    async function deleteQuestion(id) {
        if (!confirm('តើអ្នកពិតជាចង់លុបសំណួរនេះមែនទេ?')) return;
        const { error } = await supabase.from('quiz_questions').delete().eq('id', id);
        if (error) {
            alert(error.message);
        } else {
            loadQuestions();
            dispatch('refresh');
        }
    }
    
    async function deleteAllQuestions() {
        if (!confirm("តើអ្នកពិតជាចង់លុបសំណួរទាំងអស់ក្នុងវគ្គនេះមែនទេ? (មិនអាចស្តារវិញបានទេ)")) return;
        const { error } = await supabase.from('quiz_questions').delete().eq('course_id', editingCourse.id);
        if (error) {
            alert(error.message);
        } else {
            loadQuestions();
            dispatch('refresh');
        }
    }

    function editQuestion(q) {
        editingQuestionId = q.id;
        newQuestion = {
            question: q.question,
            options: Array.isArray(q.options) ? [...q.options] : (typeof q.options === 'string' ? q.options.split(',') : []),
            correct_answer: q.correct_answer,
            explanation: q.explanation || '',
            image_url: q.image_url || ''
        };
        setTimeout(() => {
            const form = document.getElementById('question-form');
            if (form) form.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }

    function cancelEdit() {
        editingQuestionId = null;
        newQuestion = { question: '', options: [], correct_answer: '', explanation: '', image_url: '' };
    }

    function downloadCsvTemplate() {
        const headers = ['question', 'options', 'correct_answer', 'explanation'];
        const example = ['"សំណួរគំរូ?"', '"ជម្រើស១, ជម្រើស២, ជម្រើស៣"', '"ជម្រើស១"', '"ការពន្យល់ (បើមាន)"'];
        const csvContent = "\uFEFF" + [headers.join(','), example.join(',')].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'quiz_template.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    function exportQuestionsCsv() {
        if (!editingQuestions || editingQuestions.length === 0) {
            alert('មិនមានសំណួរសម្រាប់នាំចេញទេ!');
            return;
        }

        const headers = ['question', 'options', 'correct_answer', 'explanation'];
        const rows = editingQuestions.map(q => {
            const optionsArray = Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? q.options.split(',') : []);
            const optionsStr = optionsArray.join(',');
            
            // ដាក់ចម្លើយត្រូវជាអក្សរពេញ ងាយស្រួលអាន ឬដាក់លេខរៀង
            const correctText = optionsArray[q.correct_answer] || (q.correct_answer + 1).toString();
            const explanation = q.explanation || '';

            const escapeCsv = (str) => `"${String(str).replace(/"/g, '""')}"`;

            return [escapeCsv(q.question), escapeCsv(optionsStr), escapeCsv(correctText), escapeCsv(explanation)].join(',');
        });

        const csvContent = "\uFEFF" + [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `quiz_export_${editingCourse?.title || 'course'}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    function exportQuestionsPdf() {
        if (!editingQuestions || editingQuestions.length === 0) {
            alert('មិនមានសំណួរសម្រាប់នាំចេញទេ!');
            return;
        }

        const printWindow = window.open('', '_blank');
        let html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>សំណួរ និងចម្លើយ - ${editingCourse?.title || 'វគ្គសិក្សា'}</title>
                <meta charset="utf-8">
                <style>
                    body { font-family: 'Siemreap', 'Battambang', Arial, sans-serif; padding: 40px; color: #1f2937; line-height: 1.6; }
                    h2 { text-align: center; color: #111827; margin-bottom: 30px; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
                    .question-container { margin-bottom: 25px; page-break-inside: avoid; background: #f9fafb; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; }
                    .question { font-weight: bold; font-size: 16px; margin-bottom: 10px; color: #111827; }
                    .options { margin-left: 20px; list-style-type: decimal; padding-left: 15px; }
                    .options li { margin-bottom: 5px; }
                    .correct { font-weight: bold; color: #059669; }
                    .explanation { margin-top: 10px; font-size: 14px; color: #4b5563; font-style: italic; border-left: 3px solid #60a5fa; padding-left: 10px; }
                    @media print {
                        body { padding: 0; background: white; }
                        .question-container { background: white; border: 1px solid #ccc; margin-bottom: 15px; }
                    }
                </style>
            </head>
            <body>
                <h2>សំណួរ និងចម្លើយវគ្គ: ${editingCourse?.title || 'វគ្គសិក្សា'}</h2>
        `;

        editingQuestions.forEach((q, i) => {
            const optionsArray = Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? q.options.split(',') : []);
            html += `<div class="question-container"><div class="question">${i + 1}. ${q.question}</div><ol class="options">`;
            
            optionsArray.forEach((opt, idx) => {
                const isCorrect = idx === q.correct_answer;
                html += `<li class="${isCorrect ? 'correct' : ''}">${opt} ${isCorrect ? ' (✔ ចម្លើយត្រឹមត្រូវ)' : ''}</li>`;
            });

            html += `</ol>`;
            if (q.explanation) html += `<div class="explanation"><strong>ការពន្យល់:</strong> ${q.explanation}</div>`;
            html += `</div>`;
        });

        html += `</body></html>`;
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        // រង់ចាំបន្តិចដើម្បីឱ្យ Browser Load ម៉ូតអក្សរបានពេញលេញ មុននឹងចេញផ្ទាំង Print
        setTimeout(() => printWindow.print(), 500);
    }

    async function importCsv(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target.result;
            const rows = text.split('\n').slice(1);
            const questionsToAdd = [];
            let duplicateCount = 0;

            const parseCsvLine = (line) => {
                const result = [];
                let startValue = 0;
                let inQuotes = false;
                for (let i = 0; i < line.length; i++) {
                    if (line[i] === '"') inQuotes = !inQuotes;
                    else if (line[i] === ',' && !inQuotes) {
                        let val = line.substring(startValue, i).trim();
                        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
                        result.push(val.replace(/""/g, '"'));
                        startValue = i + 1;
                    }
                }
                let lastVal = line.substring(startValue).trim();
                if (lastVal.startsWith('"') && lastVal.endsWith('"')) lastVal = lastVal.slice(1, -1);
                result.push(lastVal.replace(/""/g, '"'));
                return result;
            };

            for (const row of rows) {
                if (!row.trim()) continue;
                const cols = parseCsvLine(row);
                if (cols.length >= 3) {
                    const options = cols[1].split(',').map(o => o.trim()).filter(o => o);
                    const correctText = cols[2].trim();
                    let correctIndex = options.indexOf(correctText);
                    if (correctIndex === -1) {
                        const parsed = parseInt(correctText);
                        // បំប្លែងលេខរៀងដែលអ្នកប្រើប្រាស់វាយ (1, 2, 3...) ទៅជា Array Index (0, 1, 2...)
                        if (!isNaN(parsed) && parsed >= 1 && parsed <= options.length) correctIndex = parsed - 1;
                    }
                    if (correctIndex === -1) continue;

                    // ផ្ទៀងផ្ទាត់សំណួរជាន់គ្នា (ធៀបនឹងសំណួរក្នុង Database និងសំណួរដែលទើប Import ចូលថ្មីៗក្នុងវដ្តនេះ)
                    const questionText = cols[0].trim();
                    const isDuplicate = editingQuestions.some(q => q.question.trim().toLowerCase() === questionText.toLowerCase()) || 
                                        questionsToAdd.some(q => q.question.trim().toLowerCase() === questionText.toLowerCase());
                    if (isDuplicate) {
                        duplicateCount++;
                        continue; // រំលងសំណួរនេះចោល
                    }

                    questionsToAdd.push({
                        course_id: editingCourse.id,
                        question: cols[0],
                        options: options,
                        correct_answer: correctIndex,
                        explanation: cols[3] || ''
                    });
                }
            }

            if (questionsToAdd.length > 0) {
                const { error } = await supabase.from('quiz_questions').insert(questionsToAdd);
                if (error) alert("Import Error: " + error.message);
                else {
                    const dupMsg = duplicateCount > 0 ? `\n(សំណួរស្ទួនចំនួន ${duplicateCount} ត្រូវបានរំលង)` : '';
                    alert(`បាននាំចូល ${questionsToAdd.length} សំណួរជោគជ័យ!${dupMsg}`);
                    loadQuestions();
                    dispatch('refresh');
                }
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    }

    let draggedQuestion = null;

    function handleQuestionDragStart(e, index) {
        draggedQuestion = index;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.dropEffect = 'move';
    }

    async function handleQuestionDrop(e, index) {
        e.preventDefault();
        if (draggedQuestion === null || draggedQuestion === index) return;
        
        const item = editingQuestions[draggedQuestion];
        editingQuestions.splice(draggedQuestion, 1);
        editingQuestions.splice(index, 0, item);
        editingQuestions = editingQuestions;
        draggedQuestion = null;
        
        const updates = editingQuestions.map((q, i) => ({ id: q.id, sort_order: i }));
        await supabase.from('quiz_questions').upsert(updates);
    }
</script>

<div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <h4 class="font-bold text-lg text-gray-800 flex items-center gap-2">
            ❓ គ្រប់គ្រងសំណួរ <span class="badge badge-info badge-outline badge-sm">{editingQuestions.length}</span>
        </h4>
        <div class="flex flex-wrap gap-2">
            <button class="btn btn-sm btn-outline border-gray-200 hover:bg-gray-50 text-gray-600 rounded-lg" on:click={downloadCsvTemplate}>
                <DownloadIcon class="w-4 h-4 mr-1" /> គំរូ CSV
            </button>
            <label class="btn btn-sm btn-outline btn-success rounded-lg cursor-pointer">
                <UploadIcon class="w-4 h-4 mr-1" /> នាំចូល CSV
                <input type="file" accept=".csv" class="hidden" on:change={importCsv} />
            </label>
            <button class="btn btn-sm btn-outline btn-info rounded-lg" on:click={exportQuestionsCsv} disabled={editingQuestions.length === 0}>
                <DownloadIcon class="w-4 h-4 mr-1" /> នាំចេញ CSV
            </button>
            <button class="btn btn-sm btn-outline btn-secondary rounded-lg" on:click={exportQuestionsPdf} disabled={editingQuestions.length === 0}>
                <DownloadIcon class="w-4 h-4 mr-1" /> ទាញយក PDF
            </button>
            <button class="btn btn-sm btn-outline btn-error rounded-lg" on:click={deleteAllQuestions}>
                <Trash2Icon class="w-4 h-4 mr-1" /> លុបទាំងអស់
            </button>
        </div>
    </div>

    <!-- Question List -->
    <div class="space-y-3 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar mb-6">
        {#each editingQuestions as q, i (q.id || i)}
            <div 
                class="p-4 bg-gray-50 rounded-xl border border-gray-100 hover:border-primary/30 transition-all group relative cursor-move"
                draggable="true"
                on:dragstart={(e) => handleQuestionDragStart(e, i)}
                on:dragover={(e) => e.preventDefault()}
                on:drop={(e) => handleQuestionDrop(e, i)}
                animate:flip={{duration: 300}}
            >
                <div class="flex gap-3">
                    <span class="font-bold text-gray-400 text-sm mt-0.5">{i + 1}.</span>
                    <div class="flex-1 space-y-2">
                        <div class="flex justify-between items-start gap-4">
                            <p class="font-bold text-gray-800 text-sm leading-relaxed">{q.question}</p>
                            {#if q.image_url}
                                <img src={q.image_url} alt="Q" class="h-12 w-12 object-cover rounded-lg border border-gray-200 shadow-sm" />
                            {/if}
                        </div>
                        
                        <div class="flex flex-wrap gap-2">
                            {#each (Array.isArray(q.options) ? q.options : (typeof q.options === 'string' ? q.options.split(',') : [])) as opt, idx}
                                <span class="badge badge-sm {idx === q.correct_answer ? 'badge-success text-white shadow-sm' : 'badge-ghost bg-white border-gray-200 text-gray-500'}">
                                    {opt}
                                </span>
                            {/each}
                        </div>
                    </div>
                </div>
                
                <div class="absolute top-3 right-3 flex gap-1 bg-white/90 backdrop-blur-sm rounded-lg p-1 shadow-sm z-10 border border-gray-100">
                    <button on:click={() => editQuestion(q)} class="w-7 h-7 rounded-md hover:bg-blue-50 flex items-center justify-center cursor-pointer border-0 outline-none" style="color: #0056b3;">
                        <PencilIcon class="w-4 h-4" />
                    </button>
                    <button on:click={() => deleteQuestion(q.id)} class="w-7 h-7 rounded-md hover:bg-red-50 flex items-center justify-center cursor-pointer border-0 outline-none" style="color: #ef4444;">
                        <Trash2Icon class="w-4 h-4" />
                    </button>
                </div>
            </div>
        {:else}
            <div class="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400 text-sm">
                មិនទាន់មានសំណួរ
            </div>
        {/each}
    </div>

    <!-- Add/Edit Question Form -->
    <div class="bg-gray-50 p-5 rounded-2xl border border-gray-200 relative" id="question-form">
        {#if editingQuestionId}
            <div class="absolute top-0 left-0 right-0 h-1 bg-warning rounded-t-2xl"></div>
        {/if}
        
        <div class="flex justify-between items-center mb-4">
            <h5 class="font-bold text-gray-800 flex items-center gap-2">
                {editingQuestionId ? '✏️ កែប្រែសំណួរ' : '➕ បន្ថែមសំណួរថ្មី'}
            </h5>
            {#if editingQuestionId}
                <button on:click={cancelEdit} class="flex items-center px-2 py-1 rounded hover:bg-gray-100 cursor-pointer border-0 outline-none text-gray-500">
                    <XIcon class="w-3 h-3 mr-1" /> បោះបង់
                </button>
            {/if}
        </div>

        <div class="space-y-4">
            <div class="form-control w-full">
                <textarea bind:value={newQuestion.question} class="textarea textarea-bordered w-full bg-white rounded-xl focus:ring-2 focus:ring-primary/20 text-base min-h-[80px]" placeholder="សរសេរសំណួរនៅទីនេះ..."></textarea>
            </div>
            
            <div class="flex items-center gap-4">
                <div class="flex-1">
                    <label class="btn btn-sm btn-outline border-gray-300 bg-white text-gray-600 rounded-xl w-full justify-start gap-2 normal-case font-normal">
                        <ImageIcon class="w-4 h-4 mr-1" /> {newQuestion.image_url ? 'ប្តូររូបភាព' : 'បន្ថែមរូបភាព (Optional)'}
                        <input type="file" accept="image/*" on:change={handleQuestionImage} class="hidden" />
                    </label>
                </div>
                {#if newQuestion.image_url}
                    <div class="relative group">
                        <img src={newQuestion.image_url} alt="Preview" class="h-10 w-10 object-cover rounded-lg border shadow-sm" />
                        <button class="btn btn-xs btn-circle btn-error absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity text-white" on:click={() => newQuestion.image_url = ''}>
                            <XIcon class="w-3 h-3" />
                        </button>
                    </div>
                {/if}
            </div>

            <div class="bg-white p-4 rounded-xl border border-gray-200 space-y-3">
                <div class="flex justify-between items-center">
                    <label class="text-xs font-bold text-gray-500 uppercase tracking-wider">ជម្រើស (Options)</label>
                    <span class="text-[10px] text-gray-400">ចុចលើលេខរៀងដើម្បីកំណត់ចម្លើយត្រូវ</span>
                </div>
                
                {#each newQuestion.options as option, i}
                    <div class="flex gap-2 items-center">
                        <button 
                            class="btn btn-sm btn-circle {newQuestion.correct_answer === i ? 'btn-success text-white shadow-md scale-110' : 'btn-ghost bg-gray-100 text-gray-400 hover:bg-gray-200'}" 
                            on:click={() => newQuestion.correct_answer = i}
                            title="កំណត់ជាចម្លើយត្រឹមត្រូវ"
                        >
                            {i + 1}
                        </button>
                        <input bind:value={newQuestion.options[i]} class="input input-sm input-bordered w-full bg-gray-50 focus:bg-white rounded-lg transition-colors" placeholder={`ជម្រើសទី ${i + 1}`} />
                        <button class="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center cursor-pointer border-0 outline-none text-gray-400" on:click={() => removeOption(i)}>
                            <XIcon class="w-4 h-4" />
                        </button>
                    </div>
                {/each}
                <button class="w-full flex items-center justify-center border border-dashed border-gray-300 text-gray-500 rounded-xl hover:bg-gray-50 hover:border-gray-400 mt-2 py-2 cursor-pointer outline-none bg-transparent" on:click={addOption}>
                    <PlusIcon class="w-4 h-4 mr-1" /> បន្ថែមជម្រើស
                </button>
            </div>

            <div class="form-control w-full">
                <input bind:value={newQuestion.explanation} class="input input-bordered w-full bg-white rounded-xl focus:ring-2 focus:ring-primary/20" placeholder="ការពន្យល់បន្ថែម (Optional)..." />
            </div>

            <div class="pt-2">
                <button on:click={saveQuestion} class="btn btn-primary w-full text-white rounded-xl shadow-lg shadow-primary/20">
                    <SaveIcon class="w-5 h-5 mr-1" />
                    {editingQuestionId ? 'រក្សាទុកការកែប្រែ' : 'រក្សាទុកសំណួរ'}
                </button>
            </div>
        </div>
    </div>
</div>