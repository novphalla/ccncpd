<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    
    export let supabase;
    export let currentUser = null;
    export let formId;
    export let selectedMeeting = null;
    export let evaluationFromCourseId = null;

    const dispatch = createEventDispatcher();

    let activeFormData = null;
    let formAlreadySubmitted = false;
    let formAnswers = {};
    let visibleFieldIndices = new Set();
    let loading = true;

    onMount(() => {
        if (formId) loadForm();
    });

    $: if (formId && activeFormData?.id !== formId) {
        loadForm();
    }

    async function loadForm() {
        loading = true;
        formAlreadySubmitted = false;

        const isMeetingReg = selectedMeeting && selectedMeeting.registration_form_id === formId;

        if (currentUser && !isMeetingReg) {
            const { data } = await supabase.from('custom_form_submissions')
                .select('data')
                .eq('form_id', formId)
                .eq('user_id', currentUser.id)
                .maybeSingle();
            if (data) { 
                formAlreadySubmitted = true; 
                formAnswers = data.data; 
                if (evaluationFromCourseId) {
                    dispatch('evaluationCompleted', evaluationFromCourseId);
                }
            }
        } else if (!currentUser && !isMeetingReg) {
            const localSubmittedData = localStorage.getItem(`form_submitted_${formId}`);
            if (localSubmittedData) {
                formAlreadySubmitted = true;
                try { formAnswers = JSON.parse(localSubmittedData); } catch(e) {}
            }
        }

        const { data } = await supabase.from('custom_forms').select('*').eq('id', formId).single();
        if (data) {
            if (data.is_published === false && currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
                alert('ទម្រង់នេះមិនទាន់បានផ្សព្វផ្សាយទេ (Draft)។');
                dispatch('close');
                return;
            }
            if (data.expiry_date && new Date(data.expiry_date) < new Date()) {
                alert('ទម្រង់នេះបានផុតកំណត់ហើយ។ (Expired)');
                dispatch('close');
                return;
            }
            if (!currentUser && !data.is_public_access) {
                alert('អ្នកត្រូវចូលប្រព័ន្ធជាមុនសិន ដើម្បីបំពេញបែបបទនេះ។');
                dispatch('close');
                return;
            }

            activeFormData = data;
            supabase.rpc('increment_form_view', { form_id: formId });
            
            const savedDraft = localStorage.getItem(`form_draft_${formId}`);
            let draftData = {};
            if (savedDraft) {
                try { draftData = JSON.parse(savedDraft); } catch(e) {}
            }

            if (!formAlreadySubmitted) {
                formAnswers = {};
                data.fields.forEach(f => {
                    if (draftData[f.label] !== undefined) formAnswers[f.label] = draftData[f.label];
                    else if (f.type === 'checkbox') formAnswers[f.label] = [];
                    else if (f.type === 'grid_radio' || f.type === 'grid_checkbox') formAnswers[f.label] = {};
                    else formAnswers[f.label] = '';
                });
            }
        } else {
            alert('រកមិនឃើញទម្រង់នេះទេ');
            dispatch('close');
        }
        loading = false;
    }

    $: if (!loading && activeFormData?.id && Object.keys(formAnswers).length > 0) {
        localStorage.setItem(`form_draft_${activeFormData.id}`, JSON.stringify(formAnswers));
    }

    $: if (activeFormData && activeFormData.fields) {
        const visible = new Set();
        let currentIndex = 0;
        const fields = activeFormData.fields;
        
        let iterations = 0;
        while (currentIndex < fields.length && iterations < fields.length + 5) {
            visible.add(currentIndex);
            const field = fields[currentIndex];
            const answer = formAnswers[field.label];
            
            let nextIndex = currentIndex + 1;
            if (field.logic && answer && field.logic[answer]) {
                const target = field.logic[answer];
                if (target === 'submit') nextIndex = fields.length;
                else if (!isNaN(parseInt(target)) && parseInt(target) > currentIndex) nextIndex = parseInt(target);
            }
            currentIndex = nextIndex;
            iterations++;
        }
        visibleFieldIndices = visible;
    }

    function isAnswerCorrect(field) {
        if (!field.enableScore) return null;
        const answer = formAnswers[field.label];
        if (field.type === 'checkbox') {
            const correct = field.correctAnswers || [];
            const userAns = Array.isArray(answer) ? answer : [];
            return userAns.length === correct.length && userAns.every(a => correct.includes(a));
        }
        return answer === field.correctAnswer;
    }

    function getCorrectAnswerText(field) {
        if (field.type === 'checkbox') return (field.correctAnswers || []).join(', ');
        return field.correctAnswer || 'មិនបានកំណត់';
    }

    function calculateFieldScore(field, answer) {
        if (!field.scores) return 0;
        if (field.type === 'checkbox' && Array.isArray(answer)) {
            return answer.reduce((sum, a) => sum + (field.scores[a] || 0), 0);
        }
        return field.scores[answer] || 0;
    }

    function findValueByKey(obj, ...keywords) {
        const keys = Object.keys(obj);
        for (const keyword of keywords) {
            if (obj[keyword]) return obj[keyword];
            const keyCI = keys.find(k => k.toLowerCase() === keyword.toLowerCase());
            if (keyCI) return obj[keyCI];
            const keyPartial = keys.find(k => k.toLowerCase().includes(keyword.toLowerCase()));
            if (keyPartial) return obj[keyPartial];
        }
        return null;
    }

    async function submitForm() {
        if (!activeFormData) return;
        
        let totalScore = 0;
        let hasScoring = false;

        activeFormData.fields.forEach(field => {
            if (field.enableScore && field.scores) {
                hasScoring = true;
                const answer = formAnswers[field.label];
                if (field.type === 'checkbox' && Array.isArray(answer)) {
                    answer.forEach(a => { totalScore += (field.scores[a] || 0); });
                } else if (answer && field.scores[answer]) {
                    totalScore += (field.scores[answer] || 0);
                }
            }
        });

        const { error } = await supabase.from('custom_form_submissions').insert({
            form_id: activeFormData.id,
            data: { ...formAnswers, _score: hasScoring ? totalScore : undefined },
            user_id: currentUser?.id || null
        });

        if (error) {
            alert("បរាជ័យក្នុងការបញ្ជូន: " + error.message);
            return;
        }

        if (selectedMeeting && selectedMeeting.registration_form_id === activeFormData.id) {
            const regData = {
                meeting_id: selectedMeeting.id,
                user_id: currentUser.id,
                name_latin: findValueByKey(formAnswers, 'name_latin', 'name (latin)', 'ឈ្មោះជាអក្សរឡាតាំង', 'latin name', 'name') || currentUser.full_name,
                name_khmer: findValueByKey(formAnswers, 'name_khmer', 'name (khmer)', 'ឈ្មោះជាអក្សរខ្មែរ', 'khmer name', 'ឈ្មោះ') || currentUser.full_name,
                gender: findValueByKey(formAnswers, 'gender', 'sex', 'ភេទ') || currentUser.gender || 'Male',
                phone: findValueByKey(formAnswers, 'phone', 'phone number', 'telephone', 'លេខទូរស័ព្ទ') || currentUser.phone_number,
                position: findValueByKey(formAnswers, 'position', 'role', 'job title', 'តួនាទី', 'មុខតំណែង') || 'N/A',
                workplace: findValueByKey(formAnswers, 'workplace', 'organization', 'company', 'school', 'ទីកន្លែងធ្វើការ', 'អង្គភាព', 'កន្លែងធ្វើការ') || 'N/A',
                province: findValueByKey(formAnswers, 'province', 'city', 'location', 'ខេត្ត', 'រាជធានី') || 'N/A'
            };

            const { error: regError } = await supabase.from('meeting_registrations').insert(regData);
            if (regError) {
                alert("បរាជ័យក្នុងការចុះឈ្មោះប្រជុំ: " + regError.message);
                return;
            }
            alert('បានចុះឈ្មោះប្រជុំជោគជ័យ!');
            dispatch('meetingRegistered', selectedMeeting.id);
        } else if (evaluationFromCourseId) {
            dispatch('evaluationCompleted', evaluationFromCourseId);
        } else {
            if (hasScoring) alert(`បានបញ្ជូនជោគជ័យ! ពិន្ទុរបស់អ្នកគឺ: ${totalScore}`);
            else alert('បានបញ្ជូនជោគជ័យ!');
        }
        
        localStorage.removeItem(`form_draft_${activeFormData.id}`);

        if (!currentUser && !selectedMeeting && !evaluationFromCourseId) {
            localStorage.setItem(`form_submitted_${activeFormData.id}`, JSON.stringify(formAnswers));
            formAlreadySubmitted = true;
        } else {
            if (!selectedMeeting && !evaluationFromCourseId) {
                dispatch('close');
            }
        }
    }

    function clearDraft() {
        if (!confirm("តើអ្នកពិតជាចង់លុបចម្លើយដែលបានរក្សាទុកចោលមែនទេ?")) return;
        localStorage.removeItem(`form_draft_${activeFormData.id}`);
        const newAnswers = {};
        activeFormData.fields.forEach(f => {
            if (f.type === 'checkbox') newAnswers[f.label] = [];
            else if (f.type === 'grid_radio' || f.type === 'grid_checkbox') newAnswers[f.label] = {};
            else newAnswers[f.label] = '';
        });
        formAnswers = newAnswers;
    }

    async function shareCustomForm() {
        if (!activeFormData) return;
        const shareUrl = `${window.location.origin}?form_id=${activeFormData.id}`;
        const shareText = `សូមបំពេញបែបបទ "${activeFormData.title}" តាមរយៈតំណភ្ជាប់នេះ៖ ${shareUrl}`;

        if (navigator.share) {
            try {
                await navigator.share({ title: activeFormData.title, text: shareText, url: shareUrl });
            } catch (err) {
                console.error('Error sharing:', err);
            }
        } else {
            navigator.clipboard.writeText(shareUrl).then(() => alert("បានចម្លងតំណភ្ជាប់បែបបទ!"));
        }
    }
</script>

<div class="screen min-h-screen bg-base-100 p-4 flex justify-center items-start pt-10" in:fade={{ duration: 200 }}>
    <div class="card w-full max-w-lg bg-white shadow-xl relative">
        {#if loading}
            <div class="p-16 flex justify-center items-center">
                <span class="loading loading-spinner loading-lg text-primary"></span>
            </div>
        {:else if activeFormData}
            <div class="absolute right-2 top-2 flex items-center gap-1">
                <button class="rounded-full w-8 h-8 hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none" style="color: #0056b3;" on:click={shareCustomForm} title="ចែករំលែក">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="20" height="20">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                    </svg>
                </button>
                <button class="btn btn-sm btn-circle btn-ghost" on:click={() => dispatch('close')}>✕</button>
            </div>
            <div class="card-body">
            <h2 class="card-title text-2xl text-primary">{activeFormData.title}</h2>
            <p class="text-gray-500 mb-4 whitespace-pre-line">{activeFormData.description || ''}</p>
            
            {#if formAlreadySubmitted}
                <div class="alert alert-success shadow-sm mb-4">
                    <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span>អ្នកបានបំពេញទម្រង់នេះរួចរាល់ហើយ!</span>
                </div>
            {/if}

            <div class="flex flex-col gap-4 {formAlreadySubmitted ? 'pointer-events-none' : ''}">
                {#each activeFormData.fields as field, i}
                    {#if visibleFieldIndices.has(i)}
                    {#if field.type === 'section'}
                        <div class="divider mt-6 mb-2"></div>
                        <h3 class="text-xl font-bold text-primary">{field.label}</h3>
                        {#if field.subtitle}<p class="text-gray-500 mb-4 whitespace-pre-line">{field.subtitle}</p>{/if}
                    {:else}
                    <div class="form-control w-full">
                        <div class="label flex-col items-start gap-2">
                            <span class="label-text font-bold text-lg text-gray-900">
                                {field.label} {#if field.required}<span class="text-red-500">*</span>{/if}
                            </span>
                            {#if field.image_url}<img src={field.image_url} alt={field.label} class="max-h-60 rounded-lg border shadow-sm" />{/if}
                            {#if field.subtitle}<span class="label-text-alt text-gray-500 text-sm">{field.subtitle}</span>{/if}
                        </div>
                        {#if field.type === 'textarea'}
                            <textarea bind:value={formAnswers[field.label]} class="textarea textarea-bordered h-24 bg-white text-gray-900" placeholder="ចម្លើយ..."></textarea>
                        {:else if field.type === 'select'}
                            <select bind:value={formAnswers[field.label]} class="select select-bordered w-full bg-white text-gray-900">
                                <option value="" disabled selected>សូមជ្រើសរើស</option>
                                {#each (field.options || '').split(',') as opt}
                                    <option value={opt.trim()}>{opt.trim()}</option>
                                {/each}
                            </select>
                        {:else if field.type === 'date'}
                            <input type="date" bind:value={formAnswers[field.label]} class="input input-bordered text-gray-900" />
                        {:else if field.type === 'time'}
                            <input type="time" bind:value={formAnswers[field.label]} class="input input-bordered text-gray-900" />
                        {:else if field.type === 'number'}
                            <input type="number" bind:value={formAnswers[field.label]} class="input input-bordered text-gray-900" placeholder="ចម្លើយ..." />
                        {:else if field.type === 'radio'}
                            <div class="flex flex-col gap-2 mt-2">
                                {#each (field.options || '').split(',') as opt}
                                    <label class="label cursor-pointer justify-start gap-2 py-1">
                                        <input type="radio" name={field.label} value={opt.trim()} bind:group={formAnswers[field.label]} class="radio radio-primary radio-sm" />
                                        <span class="label-text text-gray-900">{opt.trim()}</span>
                                    </label>
                                {/each}
                                {#if field.allowOther}
                                    <div class="flex items-center gap-2 mt-1 ml-1">
                                        <label class="cursor-pointer flex items-center gap-2">
                                            <input type="radio" 
                                                name={field.label} 
                                                checked={formAnswers[field.label] && !(field.options || '').split(',').map(o=>o.trim()).includes(formAnswers[field.label])}
                                                on:change={() => formAnswers[field.label] = ''} 
                                                class="radio radio-primary radio-sm" />
                                            <span class="label-text text-gray-900">ផ្សេងៗ (Other):</span>
                                        </label>
                                        {#if formAnswers[field.label] !== undefined && !(field.options || '').split(',').map(o=>o.trim()).includes(formAnswers[field.label])}
                                            <textarea class="textarea textarea-bordered w-full max-w-xs bg-white text-gray-900" placeholder="សូមសរសេរចម្លើយ..." required bind:value={formAnswers[field.label]}></textarea>
                                        {/if}
                                    </div>
                                {/if}
                            </div>
                        {:else if field.type === 'checkbox'}
                            <div class="flex flex-col gap-2 mt-2">
                                {#each (field.options || '').split(',') as opt}
                                    <label class="label cursor-pointer justify-start gap-2 py-1">
                                        <input type="checkbox" value={opt.trim()} bind:group={formAnswers[field.label]} class="checkbox checkbox-primary checkbox-sm" />
                                        <span class="label-text text-gray-900">{opt.trim()}</span>
                                    </label>
                                {/each}
                                {#if field.allowOther}
                                    {@const otherText = (formAnswers[field.label] || []).find(v => !(field.options || '').split(',').map(o=>o.trim()).includes(v))}
                                    <div class="flex items-center gap-2 mt-1 ml-1">
                                        <label class="cursor-pointer flex items-center gap-2">
                                            <input type="checkbox" checked={otherText !== undefined} on:change={(e) => {
                                                    if (e.currentTarget.checked) formAnswers[field.label] = [...(formAnswers[field.label] || []), ''];
                                                    else {
                                                        const opts = (field.options || '').split(',').map(o=>o.trim());
                                                        formAnswers[field.label] = (formAnswers[field.label] || []).filter(v => opts.includes(v));
                                                    }
                                                }} class="checkbox checkbox-primary checkbox-sm" />
                                            <span class="label-text text-gray-900">ផ្សេងៗ (Other):</span>
                                        </label>
                                        {#if otherText !== undefined}
                                            <textarea class="textarea textarea-bordered w-full max-w-xs bg-white text-gray-900" placeholder="សូមសរសេរចម្លើយ..." value={otherText} required on:input={(e) => {
                                                    const newVal = e.currentTarget.value;
                                                    const opts = (field.options || '').split(',').map(o=>o.trim());
                                                    const cleanArr = (formAnswers[field.label] || []).filter(v => opts.includes(v));
                                                    formAnswers[field.label] = [...cleanArr, newVal];
                                                }}></textarea>
                                        {/if}
                                    </div>
                                {/if}
                            </div>
                        {:else if field.type === 'scale'}
                            <div class="flex items-center justify-between gap-2 mt-4 px-2 text-gray-900">
                                <span class="text-sm font-bold">{field.minLabel || '1'}</span>
                                <div class="flex gap-4 sm:gap-8">
                                    {#each Array(5) as _, j}
                                        <div class="flex flex-col items-center">
                                            <span class="text-xs mb-1">{j + 1}</span>
                                            <input type="radio" name={field.label} value={j + 1} bind:group={formAnswers[field.label]} class="radio radio-primary" />
                                        </div>
                                    {/each}
                                </div>
                                <span class="text-sm font-bold">{field.maxLabel || '5'}</span>
                            </div>
                        {:else if field.type === 'rating'}
                            <div class="rating rating-lg mt-2">
                                {#each Array(5) as _, j}
                                    <input type="radio" name={field.label} value={j + 1} bind:group={formAnswers[field.label]} class="mask mask-star-2 bg-orange-400" />
                                {/each}
                            </div>
                        {:else if field.type === 'emoji_rating'}
                            <div class="flex flex-col gap-2 mt-2">
                                {#each ['☺️ ពេញចិត្តខ្លាំង', '😊 ពេញចិត្ត', '😑 អាចទទួលយកបាន', '☹️ មិនពេញចិត្ត', '😡 មិនពេញចិត្តខ្លាំង'] as opt}
                                    <label class="label cursor-pointer justify-start gap-2 py-1">
                                        <input type="radio" name={field.label} value={opt} bind:group={formAnswers[field.label]} class="radio radio-primary radio-sm" />
                                        <span class="label-text text-gray-900">{opt}</span>
                                    </label>
                                {/each}
                            </div>
                        {:else if field.type === 'grid_radio' || field.type === 'grid_checkbox'}
                            <div class="overflow-x-auto mt-2 text-gray-900">
                                <table class="table table-xs">
                                    <thead>
                                        <tr class="text-gray-900">
                                            <th></th>
                                            {#each (field.options || '').split(',') as col}
                                                <th class="text-center">{col.trim()}</th>
                                            {/each}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each (field.rows || '').split(',') as row}
                                            <tr>
                                                <td>{row.trim()}</td>
                                                {#each (field.options || '').split(',') as col}
                                                    <td class="text-center">
                                                        {#if field.type === 'grid_radio'}
                                                            <input type="radio" name={`${field.label}_${row.trim()}`} value={col.trim()} 
                                                                on:change={() => { if (!formAnswers[field.label]) formAnswers[field.label] = {}; formAnswers[field.label][row.trim()] = col.trim(); }}
                                                                checked={formAnswers[field.label]?.[row.trim()] === col.trim()}
                                                                class="radio radio-xs" />
                                                        {:else}
                                                            <input type="checkbox" on:change={(e) => {
                                                                    if (!formAnswers[field.label]) formAnswers[field.label] = {};
                                                                    if (!formAnswers[field.label][row.trim()]) formAnswers[field.label][row.trim()] = [];
                                                                    const arr = formAnswers[field.label][row.trim()];
                                                                    if (e.currentTarget.checked) { if (!arr.includes(col.trim())) arr.push(col.trim()); } 
                                                                    else { const idx = arr.indexOf(col.trim()); if (idx > -1) arr.splice(idx, 1); }
                                                                    formAnswers[field.label][row.trim()] = arr;
                                                                }} class="checkbox checkbox-xs" />
                                                        {/if}
                                                    </td>
                                                {/each}
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>
                        {:else}
                            <input type="text" bind:value={formAnswers[field.label]} class="input input-bordered text-gray-900" placeholder="ចម្លើយ..." />
                        {/if}
                    </div>
                    {#if formAlreadySubmitted && field.enableScore}
                        <div class="p-3 rounded-lg text-sm border {isAnswerCorrect(field) ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}">
                            <div class="font-bold">{isAnswerCorrect(field) ? '✅ ត្រឹមត្រូវ' : '❌ ខុស'}</div>
                            {#if !isAnswerCorrect(field)}<div class="mt-1">ចម្លើយត្រឹមត្រូវគឺ: <span class="font-bold">{getCorrectAnswerText(field)}</span></div>{/if}
                            <div class="mt-1 text-xs opacity-75">ពិន្ទុទទួលបាន: {calculateFieldScore(field, formAnswers[field.label])}</div>
                        </div>
                    {/if}
                    {/if}
                    {/if}
                {/each}
            </div>

            <div class="card-actions justify-end mt-6">
                {#if formAlreadySubmitted}
                    <button on:click={() => dispatch('close')} class="btn btn-primary w-full">{currentUser ? 'ត្រឡប់ទៅទំព័រដើម' : 'ចាកចេញ / បិទ'}</button>
                {:else}
                    <button on:click={submitForm} class="btn btn-primary w-full">បញ្ជូន (Submit)</button>
                    <div class="flex gap-2 w-full mt-2">
                        <button on:click={clearDraft} class="btn btn-outline btn-error flex-1">លុបចម្លើយ</button>
                        <button on:click={() => dispatch('close')} class="btn btn-ghost flex-1">បោះបង់</button>
                    </div>
                {/if}
            </div>
            </div>
        {/if}
    </div>
</div>