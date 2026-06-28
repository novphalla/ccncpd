<script>
    import { createEventDispatcher } from 'svelte';
    import { fade, fly, slide } from 'svelte/transition';
    import { LogOutIcon } from 'lucide-svelte';
    import { compressImage, handleUpload, hashPin, normalizeKhmerNumerals } from '$lib/utils';

    export let show = false;
    export let currentUser;
    export let supabase;
    export let profileFormId;
    export let showCPDPoints = false;
    export let forced = false; // true = user must complete before using app
    export let forcedMsg = '';

    const dispatch = createEventDispatcher();

    let profileForm = { full_name: '', name_latin: '', gender: '', pin_code: '', avatar_url: '' };
    let profileAnswers = {};
    let changePinMode = false;
    let showPin = false;
    let tempPositionSelect = '';
    let tempWorkplaceSelect = '';
    let profileFormData = null;
    let visibleProfileFieldIndices = new Set();
    let cpdHistory = [];
    let loadingCpdHistory = false;
    let isUploading = false;
    let isSaving = false;
    let isDuplicateLicense = false;

    // Helpers

    async function deleteFile(url) {
        if (!url) return;
        try {
            const headers = { 'Content-Type': 'application/json' };
            if (currentUser?.id) headers['X-User-Id'] = currentUser.id;
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
            await fetch('/api/storage', {
                method: 'DELETE',
                headers,
                body: JSON.stringify({ url })
            });
        } catch (e) {
            console.error("Failed to delete file:", e);
        }
    }

    function getCPDColor(points) {
        if (!points) return 'text-gray-400';
        if (points >= 60) return 'text-purple-600';
        if (points >= 30) return 'text-red-600';
        if (points >= 20) return 'text-orange-500';
        if (points >= 10) return 'text-yellow-500';
        if (points >= 5) return 'text-blue-500';
        return 'text-primary';
    }

    function getCPDIcon(points) {
        if (!points) return '🌱';
        if (points >= 60) return '👑';
        if (points >= 30) return '💎';
        if (points >= 20) return '🥇';
        if (points >= 10) return '🥈';
        if (points >= 5) return '🥉';
        return '🌱';
    }

    function getNextLevelInfo(points) {
        points = points || 0;
        const levels = [5, 10, 20, 30, 60];
        for (let i = 0; i < levels.length; i++) {
            if (points < levels[i]) {
                const nextLevel = levels[i];
                const prevLevel = i === 0 ? 0 : levels[i-1];
                const needed = nextLevel - points;
                const progress = ((points - prevLevel) / (nextLevel - prevLevel)) * 100;
                return { nextLevel, needed, progress, isMax: false };
            }
        }
        return { nextLevel: null, needed: 0, progress: 100, isMax: true };
    }

    // Initialization logic — only run when modal opens, not on every currentUser mutation
    let _prevShow = false;
    $: {
        if (show && !_prevShow && currentUser) initProfile();
        _prevShow = show;
    }

    async function initProfile() {
        changePinMode = false;
        showPin = false;

        // Re-fetch fresh data from DB to avoid stale in-memory state after app restart / HMR
        const { data: fresh } = await supabase
            .from('users')
            .select('full_name, name_latin, gender, avatar_url, profile_data')
            .eq('id', currentUser.id)
            .maybeSingle();

        const src = fresh || currentUser;

        profileForm = {
            full_name: src.full_name,
            name_latin: src.name_latin || '',
            gender: src.gender,
            pin_code: '',
            avatar_url: src.avatar_url
        };

        profileAnswers = src.profile_data || {};

        // Setup Position Dropdown
        const stdPositions = ['Prof./Associate Prof./Assistant Prof.', 'Lecturer', 'Nurse', 'Midwife', 'Ophthalmic Nurse', 'Nurse Anesthetist', 'Dental Nurse', 'Nursing/Midwife Student'];
        if (stdPositions.includes(profileAnswers.position)) {
            tempPositionSelect = profileAnswers.position;
        } else if (profileAnswers.position) {
            tempPositionSelect = 'Others';
        } else {
            tempPositionSelect = '';
        }

        // Setup Workplace Dropdown
        const stdWorkplaces = ['ក្រសួងសុខាភិបាល', 'មន្ទីរសុខាភិបាល/OD', 'មន្ទីរពេទ្យរដ្ឋ', 'មន្ទីរពេទ្យឯកជន', 'អង្គការក្រៅរដ្ឋាភិបាល', 'សាកលវិទ្យាល័យ', 'និស្សិត'];
        if (stdWorkplaces.includes(profileAnswers.workplace)) {
            tempWorkplaceSelect = profileAnswers.workplace;
        } else if (profileAnswers.workplace) {
            tempWorkplaceSelect = 'Others';
        } else {
            tempWorkplaceSelect = '';
        }

        
        if (profileFormId) {
            const { data } = await supabase.from('custom_forms').select('*').eq('id', profileFormId).maybeSingle();
            if (data) {
                profileFormData = data;
                profileFormData.fields.forEach(f => {
                    if (profileAnswers[f.label] === undefined) {
                        if (f.type === 'checkbox') profileAnswers[f.label] = [];
                        else if (f.type === 'grid_radio' || f.type === 'grid_checkbox') profileAnswers[f.label] = {};
                        else profileAnswers[f.label] = '';
                    }
                });
            }
        }

        if (showCPDPoints) {
            // Refresh CPD total
            const { data: userData } = await supabase.from('users').select('cpd_total').eq('id', currentUser.id).maybeSingle();
            if (userData) {
                // avoid mutating prop (would re-trigger reactive initProfile)
                currentUser = { ...currentUser, cpd_total: userData.cpd_total };
            }

            loadingCpdHistory = true;
            const { data } = await supabase
                .from('student_quiz_results')
                .select('created_at, course_id, courses(title, cpd_points)')
                .eq('user_id', currentUser.id)
                .eq('passed', true)
                .order('created_at', { ascending: false })
                .limit(200);

            if (data) {
                const seen = new Set();
                cpdHistory = [];
                let calculatedTotal = 0;
                for (const item of data) {
                    if (item.courses && item.courses.cpd_points > 0 && !seen.has(item.course_id)) {
                        seen.add(item.course_id);
                        cpdHistory.push(item);
                        calculatedTotal += item.courses.cpd_points;
                    }
                }
            } else {
                cpdHistory = [];
            }
            loadingCpdHistory = false;
        }
    }

    // Logic Jump Calculation
    $: if (profileFormData && profileFormData.fields) {
        const visible = new Set();
        let currentIndex = 0;
        const fields = profileFormData.fields;
        
        let iterations = 0;
        while (currentIndex < fields.length && iterations < fields.length + 5) {
            visible.add(currentIndex);
            const field = fields[currentIndex];
            const answer = profileAnswers[field.label];
            
            let nextIndex = currentIndex + 1;
            if (field.logic && answer && field.logic[answer]) {
                const target = field.logic[answer];
                if (target === 'submit') nextIndex = fields.length;
                else if (!isNaN(parseInt(target)) && parseInt(target) > currentIndex) nextIndex = parseInt(target);
            }
            currentIndex = nextIndex;
            iterations++;
        }
        visibleProfileFieldIndices = visible;
    }

    async function handleImageSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!['image/jpeg', 'image/png'].includes(file.type)) {
            alert("សូម Upload តែឯកសារប្រភេទ JPG ឬ PNG ប៉ុណ្ណោះ!");
            e.target.value = '';
            return;
        }
        
        isUploading = true;
        try {
            const previousTempUrl = profileForm.avatar_url;
            const compressed = await compressImage(file, 300, 0.8);
            const url = await handleUpload(compressed, 'avatars');
            if (url) {
                if (previousTempUrl && previousTempUrl !== currentUser.avatar_url) {
                    await deleteFile(previousTempUrl);
                }
                profileForm.avatar_url = url;
            }
        } catch (error) {
            console.error("Upload error:", error);
            alert("មានបញ្ហាក្នុងការផ្ទុករូបភាព: " + error.message);
        } finally {
            isUploading = false;
            e.target.value = '';
        }
    }

    async function cancel() {
        if (forced) {
            alert('សូមបំពេញព័ត៌មានប្រវត្តិរូបឱ្យបានគ្រប់ជាមុន ដើម្បីប្រើប្រាស់កម្មវិធី!');
            return;
        }
        if (profileForm.avatar_url && profileForm.avatar_url !== currentUser.avatar_url) {
            await deleteFile(profileForm.avatar_url);
        }
        dispatch('close');
    }

    async function save() {
        isDuplicateLicense = false;
        if (!profileForm.full_name?.trim()) return alert("សូមបំពេញឈ្មោះឱ្យបានត្រឹមត្រូវ");
        if (!profileAnswers.position) return alert("សូមជ្រើសរើសមុខតំណែង / កម្រិតជំនាញរបស់អ្នក");
        if (!profileAnswers.workplace) return alert("សូមជ្រើសរើសទីកន្លែងធ្វើការ");
        if (!profileAnswers.license_status) return alert("សូមជ្រើសរើសស្ថានភាពអាជ្ញាប័ណ្ណ");
        isSaving = true;
        try {
            if (profileAnswers.license_status === 'មាន') {
                profileAnswers.license_number = profileAnswers.license_number ? profileAnswers.license_number.trim() : '';
                
                // ផ្ទៀងផ្ទាត់កុំឱ្យលេខអាជ្ញាប័ណ្ណស្ទួនគ្នា (Check Duplicate License)
                const lic = profileAnswers.license_number;
                if (lic && lic !== 'CCN-LP-') {
                    const { data: dupData, error: dupErr } = await supabase
                        .from('users')
                        .select('id')
                        .neq('id', currentUser.id) // មិនរាប់បញ្ចូលគណនីខ្លួនឯង
                        .eq('profile_data->>license_number', lic)
                        .limit(1);
                        
                    if (dupErr) throw dupErr;
                    if (dupData && dupData.length > 0) {
                        isDuplicateLicense = true;
                        return alert(`លេខអាជ្ញាប័ណ្ណ "${lic}" មានសមាជិកផ្សេងកំពុងប្រើប្រាស់រួចហើយ! សូមពិនិត្យមើលម្ដងទៀត។`);
                    }
                }
            } else {
                profileAnswers.license_number = '';
            }

            const updates = {
                full_name: profileForm.full_name,
                name_latin: profileForm.name_latin,
                gender: profileForm.gender,
                avatar_url: profileForm.avatar_url,
                profile_data: profileAnswers
            };

            if (changePinMode) {
                if (!profileForm.pin_code || profileForm.pin_code.length !== 4) return alert("សូមបញ្ចូលលេខកូដ PIN ៤ខ្ទង់ដែលត្រឹមត្រូវ");
                const hashedPin = await hashPin(profileForm.pin_code);
                const { error: pinError } = await supabase.rpc('change_pin', { user_id: currentUser.id, new_pin: hashedPin });
                if (pinError) return alert("បរាជ័យក្នុងការប្តូរ PIN: " + pinError.message);
                await supabase.auth.updateUser({ password: `${profileForm.pin_code}-ccn` });
            }

            const oldAvatarUrl = currentUser.avatar_url;
            const { data, error } = await supabase.from('users').update(updates).eq('id', currentUser.id).select('id, full_name, name_latin, gender, avatar_url, profile_data');

            if (error) alert("ការកែប្រែបរាជ័យ: " + error.message);
            else if (!data || data.length === 0) alert("ការកែប្រែបរាជ័យ: មិនអាចរក្សាទុកទិន្នន័យបានទេ (សូមពិនិត្យមើល RLS Policy)");
            else {
                if (oldAvatarUrl && oldAvatarUrl !== updates.avatar_url) {
                    await deleteFile(oldAvatarUrl);
                }
                alert("បានកែប្រែប្រវត្តិរូបដោយជោគជ័យ!");
                dispatch('save', { ...currentUser, ...updates });
                dispatch('close');
            }
        } finally {
            isSaving = false;
        }
    }
</script>

{#if show}
    <div class="modal modal-open bg-black/60" transition:fade={{ duration: 200 }}>
        <div class="modal-box bg-white w-11/12 max-w-md p-0 overflow-hidden rounded-2xl flex flex-col max-h-[90vh]">
            
            <!-- Header with Background Pattern -->
            <div class="bg-blue-50 p-6 text-center relative shrink-0 border-b border-blue-100">
                {#if forced}
                    <div class="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 text-xs text-amber-800 text-left flex gap-2 items-start">
                        <span class="text-base leading-none mt-0.5">⚠️</span>
                        <span>
                            សូមបំពេញព័ត៌មានខាងក្រោមឱ្យបានគ្រប់ ដើម្បីអាចប្រើប្រាស់កម្មវិធីបានពេញលេញ៖
                            {#if forcedMsg}<br/><span class="text-error font-bold mt-1 inline-block">{forcedMsg}</span>{/if}
                        </span>
                    </div>
                {/if}
                <h3 class="font-bold text-xl text-primary mb-4">កែសម្រួលប្រវត្តិរូប</h3>
                
                <!-- Avatar Section -->
                <div class="relative inline-block">
                    <div class="avatar">
                        <div class="w-24 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2 shadow-lg">
                            {#if profileForm.avatar_url}
                                <img src={profileForm.avatar_url} alt="Profile" class="object-cover" />
                            {:else}
                                <div class="bg-gray-200 text-gray-700 w-full h-full flex items-center justify-center text-3xl font-bold">
                                    {profileForm.full_name ? profileForm.full_name[0] : '?'}
                                </div>
                            {/if}
                        </div>
                    </div>
                    <!-- Upload Button -->
                    <label class="rounded-full bg-white absolute bottom-0 right-0 shadow-sm border border-gray-200 w-6 h-6 flex items-center justify-center cursor-pointer" style="color: #000;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3 h-3">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                        </svg>
                        <input type="file" class="hidden" accept=".jpg,.jpeg,.png" on:change={handleImageSelect} />
                    </label>
                    {#if isUploading}
                        <div class="absolute inset-0 flex items-center justify-center bg-black/30 rounded-full">
                            <span class="loading loading-spinner text-white loading-sm"></span>
                        </div>
                    {/if}
                </div>

                <!-- CPD Points Badge -->
                {#if showCPDPoints}
                <div class="mt-3 flex flex-col items-center w-full px-6">
                    <div class="badge badge-lg gap-2 py-3 px-4 shadow-sm bg-white border-primary/20 text-gray-700 mb-3">
                        <span class="text-xl">{getCPDIcon(currentUser.cpd_total || 0)}</span>
                        <div class="flex flex-col items-start leading-none">
                            <span class="text-[10px] font-bold text-gray-400 uppercase">ពិន្ទុ CPD</span>
                            <span class="font-black text-2xl {getCPDColor(currentUser.cpd_total || 0)}">{currentUser.cpd_total || 0}</span>
                        </div>
                    </div>

                    <!-- Level Progress Bar -->
                    {#if currentUser}
                    {@const levelInfo = getNextLevelInfo(currentUser.cpd_total || 0)}
                    {#if !levelInfo.isMax}
                        <div class="w-full">
                            <div class="flex justify-between text-xs text-gray-600 mb-1 font-medium">
                                <span>កម្រិតបន្ទាប់</span>
                                <span class="text-primary">ខ្វះ {levelInfo.needed} ពិន្ទុ</span>
                            </div>
                            <progress class="progress progress-primary w-full h-2 bg-white/50" value={levelInfo.progress} max="100"></progress>
                            <div class="flex justify-between text-[10px] text-gray-500 mt-1">
                                <span>{currentUser.cpd_total || 0}</span>
                                <span>{levelInfo.nextLevel}</span>
                            </div>
                        </div>
                    {:else}
                        <div class="text-center text-sm font-bold text-purple-600 animate-pulse bg-white/50 px-3 py-1 rounded-full">
                            🎉 កម្រិតកំពូល (Max Level)
                        </div>
                    {/if}
                    {/if}
                </div>
                {/if}
            </div>

            <!-- Scrollable Content -->
            <div class="p-6 space-y-4 overflow-y-auto flex-1">
                <!-- Personal Info Fields -->
                <div class="space-y-3">
                    <div class="form-control w-full">
                        <label for="pm-full-name" class="label py-1"><span class="label-text font-medium {forced && !profileForm.full_name?.trim() ? 'text-error font-bold' : 'text-gray-600'}">ឈ្មោះ (ខ្មែរ)</span></label>
                        <input id="pm-full-name" bind:value={profileForm.full_name} class="input input-bordered w-full transition-colors {forced && !profileForm.full_name?.trim() ? 'border-error bg-error/10' : 'bg-gray-50 focus:bg-white'}" placeholder="ឈ្មោះរបស់អ្នក" />
                    </div>
                    <div class="form-control w-full">
                        <label for="pm-name-latin" class="label py-1"><span class="label-text font-medium text-gray-600">ឈ្មោះ (ឡាតាំង)</span></label>
                        <input id="pm-name-latin" bind:value={profileForm.name_latin} class="input input-bordered w-full bg-gray-50 focus:bg-white transition-colors" placeholder="Latin Name" />
                    </div>
                    <div class="grid grid-cols-2 gap-2">
                        <div class="form-control w-full">
                            <label for="pm-phone" class="label py-1"><span class="label-text font-medium text-gray-600">លេខទូរស័ព្ទ</span></label>
                            <input id="pm-phone" value={currentUser?.phone_number || ''} disabled class="input input-bordered w-full bg-gray-200/50 text-gray-500 cursor-not-allowed border-gray-200 font-mono text-sm" />
                        </div>
                        <div class="form-control w-full">
                            <label class="label py-1"><span class="label-text font-medium text-gray-600">ថ្ងៃខែចុះឈ្មោះ</span></label>
                            <input value={currentUser?.created_at ? new Date(currentUser.created_at).toLocaleDateString('km-KH') : ''} disabled class="input input-bordered w-full bg-gray-200/50 text-gray-500 cursor-not-allowed border-gray-200 font-mono text-center text-sm" />
                        </div>
                    </div>
                    <div class="form-control w-full">
                        <label for="pm-gender" class="label py-1"><span class="label-text font-medium text-gray-600">ភេទ</span></label>
                        <select id="pm-gender" bind:value={profileForm.gender} class="select select-bordered w-full bg-gray-50 focus:bg-white transition-colors">
                            <option value="Male">ប្រុស</option>
                            <option value="Female">ស្រី</option>
                        </select>
                    </div>

                    <!-- Position -->
                    <div class="form-control w-full">
                        <label for="pm-position" class="label py-1"><span class="label-text font-medium {forced && !profileAnswers.position ? 'text-error font-bold' : 'text-gray-600'}">មុខតំណែង / កម្រិតជំនាញ (Position / Qualification)</span></label>
                        <select id="pm-position" bind:value={tempPositionSelect} on:change={() => {
                            if (tempPositionSelect !== 'Others') profileAnswers.position = tempPositionSelect;
                        else if (['Prof./Associate Prof./Assistant Prof.', 'Lecturer', 'Nurse', 'Midwife', 'Ophthalmic Nurse', 'Nurse Anesthetist', 'Dental Nurse', 'Nursing/Midwife Student'].includes(profileAnswers.position)) profileAnswers.position = '';
                        }} class="select select-bordered w-full transition-colors {forced && !profileAnswers.position ? 'border-error bg-error/10' : 'bg-gray-50 focus:bg-white'}">
                            <option value="" disabled selected>សូមជ្រើសរើស</option>
                            <option value="Prof./Associate Prof./Assistant Prof.">សាស្ត្រាចារ្យ/សហសាស្ត្រាចារ្យ/សាស្ត្រាចារ្យជំនួយ (Prof./Associate Prof./Assistant Prof.)</option>
                            <option value="Lecturer">គ្រូបង្រៀន (Lecturer)</option>
                            <option value="Nurse">គិលានុបដ្ឋាក (Nurse)</option>
                            <option value="Midwife">ឆ្មប (Midwife)</option>
                            <option value="Ophthalmic Nurse">ចក្ខុគិលានុបដ្ឋាក (Ophthalmic Nurse)</option>
                            <option value="Nurse Anesthetist">គិលានុបដ្ឋាកឯកទេសសណ្តំ (Nurse Anesthetist)</option>
                            <option value="Dental Nurse">ទន្តគិលានុបដ្ឋាក (Dental Nurse)</option>
                        <option value="Nursing/Midwife Student">និស្សិតគិលានុបដ្ឋាក/ឆ្មប (Nursing/Midwife Student)</option>
                            <option value="Others">ផ្សេងៗ (Others)</option>
                        </select>
                    </div>
                    {#if tempPositionSelect === 'Others'}
                        <div class="form-control w-full">
                            <input bind:value={profileAnswers.position} class="input input-bordered w-full bg-gray-50 focus:bg-white transition-colors" placeholder="សូមបញ្ជាក់មុខតំណែង / កម្រិតជំនាញ..." />
                        </div>
                    {/if}

                    <!-- Workplace -->
                    <div class="form-control w-full">
                        <label for="pm-workplace" class="label py-1"><span class="label-text font-medium {forced && !profileAnswers.workplace ? 'text-error font-bold' : 'text-gray-600'}">ទីកន្លែងធ្វើការ (Workplace)</span></label>
                        <select id="pm-workplace" bind:value={tempWorkplaceSelect} on:change={() => {
                            if (tempWorkplaceSelect !== 'Others') profileAnswers.workplace = tempWorkplaceSelect;
                            else if (['ក្រសួងសុខាភិបាល', 'មន្ទីរសុខាភិបាល/OD', 'មន្ទីរពេទ្យរដ្ឋ', 'មន្ទីរពេទ្យឯកជន', 'អង្គការក្រៅរដ្ឋាភិបាល', 'សាកលវិទ្យាល័យ', 'និស្សិត'].includes(profileAnswers.workplace)) profileAnswers.workplace = '';
                        }} class="select select-bordered w-full transition-colors {forced && !profileAnswers.workplace ? 'border-error bg-error/10' : 'bg-gray-50 focus:bg-white'}">
                            <option value="" disabled selected>សូមជ្រើសរើស</option>
                            <option value="ក្រសួងសុខាភិបាល">ក្រសួងសុខាភិបាល</option>
                            <option value="មន្ទីរសុខាភិបាល/OD">មន្ទីរសុខាភិបាល/OD</option>
                            <option value="មន្ទីរពេទ្យរដ្ឋ">មន្ទីរពេទ្យរដ្ឋ</option>
                            <option value="មន្ទីរពេទ្យឯកជន">មន្ទីរពេទ្យឯកជន</option>
                            <option value="អង្គការក្រៅរដ្ឋាភិបាល">អង្គការក្រៅរដ្ឋាភិបាល (NGO)</option>
                            <option value="សាកលវិទ្យាល័យ">សាកលវិទ្យាល័យ</option>
                            <option value="និស្សិត">និស្សិត</option>
                            <option value="Others">ផ្សេងៗ</option>
                        </select>
                    </div>
                    <!--{#if tempWorkplaceSelect === 'Others'}
                        <div class="form-control w-full">
                            <input bind:value={profileAnswers.workplace} class="input input-bordered w-full bg-gray-50 focus:bg-white transition-colors" placeholder="សូមបញ្ជាក់កន្លែងធ្វើការ..." />
                        </div>
                    {/if}-->

                    <!-- Province -->
                    <div class="form-control w-full">
                        <label for="pm-province" class="label py-1"><span class="label-text font-medium {forced && !profileAnswers.province ? 'text-error font-bold' : 'text-gray-600'}">រាជធានី/ខេត្ត</span></label>
                        <select id="pm-province" bind:value={profileAnswers.province} class="select select-bordered w-full transition-colors {forced && !profileAnswers.province ? 'border-error bg-error/10' : 'bg-gray-50 focus:bg-white'}">
                            <option value="" disabled selected>សូមជ្រើសរើស</option>
                            <option>រាជធានីភ្នំពេញ</option>
                            <option>ខេត្តបន្ទាយមានជ័យ</option>
                            <option>ខេត្តបាត់ដំបង</option>
                            <option>ខេត្តកំពង់ចាម</option>
                            <option>ខេត្តកំពង់ឆ្នាំង</option>
                            <option>ខេត្តកំពង់ស្ពឺ</option>
                            <option>ខេត្តកំពង់ធំ</option>
                            <option>ខេត្តកំពត</option>
                            <option>ខេត្តកណ្ដាល</option>
                            <option>ខេត្តកែប</option>
                            <option>ខេត្តកោះកុង</option>
                            <option>ខេត្តក្រចេះ</option>
                            <option>ខេត្តមណ្ឌលគីរី</option>
                            <option>ខេត្តឧត្ដរមានជ័យ</option>
                            <option>ខេត្តប៉ៃលិន</option>
                            <option>ខេត្តព្រះសីហនុ</option>
                            <option>ខេត្តព្រះវិហារ</option>
                            <option>ខេត្តព្រៃវែង</option>
                            <option>ខេត្តពោធិ៍សាត់</option>
                            <option>ខេត្តរតនគិរី</option>
                            <option>ខេត្តសៀមរាប</option>
                            <option>ខេត្តស្ទឹងត្រែង</option>
                            <option>ខេត្តស្វាយរៀង</option>
                            <option>ខេត្តតាកែវ</option>
                            <option>ខេត្តត្បូងឃ្មុំ</option>
                        </select>
                    </div>
                    <div class="form-control w-full">
                        <label for="pm-license" class="label py-1"><span class="label-text font-medium {forced && !profileAnswers.license_status ? 'text-error font-bold' : 'text-gray-600'}">អាជ្ញាប័ណ្ណ (License)</span></label>
                        <select id="pm-license" bind:value={profileAnswers.license_status} on:change={() => { if (profileAnswers.license_status === 'មាន' && !profileAnswers.license_number) profileAnswers.license_number = 'CCN-LP-'; }} class="select select-bordered w-full transition-colors {forced && !profileAnswers.license_status ? 'border-error bg-error/10' : 'bg-gray-50 focus:bg-white'}">
                            <option value="" disabled selected>ស្ថានភាពអាជ្ញាប័ណ្ណ</option>
                            <option value="មាន">មាន</option>
                            <option value="មិនមាន">មិនមាន</option>
                            <option value="មានតែហួសសុពលភាព">មានតែហួសសុពលភាព</option>
                            <option value="កំពុងបន្ដ">កំពុងបន្ដ</option>
                        </select>
                    </div>
                    {#if profileAnswers.license_status === 'មាន'}
                        <div class="form-control w-full">
                            <input 
                                bind:value={profileAnswers.license_number} 
                                on:input={() => { profileAnswers.license_number = normalizeKhmerNumerals(profileAnswers.license_number); isDuplicateLicense = false; }}
                                class="input input-bordered w-full transition-colors {isDuplicateLicense ? 'border-error bg-error/10 text-error' : 'bg-gray-50 focus:bg-white'}" 
                                placeholder="ឧ. CCN-LP-XXXX (អាចបំពេញពេលក្រោយ បើមិនចាំលេខ)" />
                            {#if isDuplicateLicense}
                                <label class="label py-1"><span class="label-text-alt text-error font-medium">⚠️ លេខអាជ្ញាប័ណ្ណនេះមានសមាជិកផ្សេងកំពុងប្រើប្រាស់រួចហើយ</span></label>
                            {/if}
                        </div>
                    {/if}

                    <!-- Dynamic Profile Fields -->
                    {#if profileFormData && profileFormData.fields}
                        <div class="divider my-2">ព័ត៌មានបន្ថែម</div>
                        {#each profileFormData.fields as field, i}
                            {#if visibleProfileFieldIndices.has(i)}
                                <div class="form-control w-full">
                                    <div class="label py-1">
                                        <span class="label-text font-medium text-gray-600">
                                            {field.label} {#if field.required}<span class="text-red-500">*</span>{/if}
                                        </span>
                                    </div>
                                    
                                    {#if field.type === 'text'}
                                        <input type="text" bind:value={profileAnswers[field.label]} class="input input-bordered w-full bg-gray-50 focus:bg-white transition-colors" placeholder="ចម្លើយ..." />
                                    {:else if field.type === 'textarea'}
                                        <textarea bind:value={profileAnswers[field.label]} class="textarea textarea-bordered h-20 bg-gray-50 focus:bg-white transition-colors" placeholder="ចម្លើយ..."></textarea>
                                    {:else if field.type === 'select'}
                                        <select bind:value={profileAnswers[field.label]} class="select select-bordered w-full bg-gray-50 focus:bg-white transition-colors">
                                            <option value="" disabled selected>សូមជ្រើសរើស</option>
                                            {#each (field.options || '').split(',') as opt}
                                                <option value={opt.trim()}>{opt.trim()}</option>
                                            {/each}
                                        </select>
                                    {:else if field.type === 'radio'}
                                        <div class="flex flex-col gap-2 mt-1">
                                            {#each (field.options || '').split(',') as opt}
                                                <label class="label cursor-pointer justify-start gap-2 py-0">
                                                    <input type="radio" name={`profile_${field.label}`} value={opt.trim()} bind:group={profileAnswers[field.label]} class="radio radio-primary radio-sm" />
                                                    <span class="label-text text-gray-700">{opt.trim()}</span>
                                                </label>
                                            {/each}
                                            {#if field.allowOther}
                                                <div class="flex items-center gap-2 mt-1 ml-1">
                                                    <label class="cursor-pointer flex items-center gap-2">
                                                        <input type="radio" 
                                                            name={`profile_${field.label}`} 
                                                            checked={profileAnswers[field.label] && !(field.options || '').split(',').map(o=>o.trim()).includes(profileAnswers[field.label])}
                                                            on:change={() => profileAnswers[field.label] = ''} 
                                                            class="radio radio-primary radio-sm" />
                                                        <span class="label-text text-gray-700">ផ្សេងៗ:</span>
                                                    </label>
                                                    {#if profileAnswers[field.label] !== undefined && !(field.options || '').split(',').map(o=>o.trim()).includes(profileAnswers[field.label])}
                                                        <input 
                                                            class="input input-bordered input-sm w-full max-w-xs bg-gray-50" 
                                                            placeholder="សូមបញ្ជាក់..." 
                                                            bind:value={profileAnswers[field.label]} />
                                                    {/if}
                                                </div>
                                            {/if}
                                        </div>
                                    {:else if field.type === 'checkbox'}
                                        <div class="flex flex-col gap-2 mt-1">
                                            {#each (field.options || '').split(',') as opt}
                                                <label class="label cursor-pointer justify-start gap-2 py-0">
                                                    <input type="checkbox" value={opt.trim()} bind:group={profileAnswers[field.label]} class="checkbox checkbox-primary checkbox-sm" />
                                                    <span class="label-text text-gray-700">{opt.trim()}</span>
                                                </label>
                                            {/each}
                                            {#if field.allowOther}
                                                {@const otherText = (profileAnswers[field.label] || []).find(v => !(field.options || '').split(',').map(o=>o.trim()).includes(v))}
                                                <div class="flex items-center gap-2 mt-1 ml-1">
                                                    <label class="cursor-pointer flex items-center gap-2">
                                                        <input type="checkbox" 
                                                            checked={otherText !== undefined} 
                                                            on:change={(e) => {
                                                                if (e.currentTarget.checked) profileAnswers[field.label] = [...(profileAnswers[field.label] || []), ''];
                                                                else {
                                                                    const opts = (field.options || '').split(',').map(o=>o.trim());
                                                                    profileAnswers[field.label] = (profileAnswers[field.label] || []).filter(v => opts.includes(v));
                                                                }
                                                            }}
                                                            class="checkbox checkbox-primary checkbox-sm" />
                                                        <span class="label-text text-gray-700">ផ្សេងៗ:</span>
                                                    </label>
                                                    {#if otherText !== undefined}
                                                        <input 
                                                            class="input input-bordered input-sm w-full max-w-xs bg-gray-50" 
                                                            placeholder="សូមបញ្ជាក់..." 
                                                            value={otherText}
                                                            on:input={(e) => {
                                                                const newVal = e.currentTarget.value;
                                                                const opts = (field.options || '').split(',').map(o=>o.trim());
                                                                const cleanArr = (profileAnswers[field.label] || []).filter(v => opts.includes(v));
                                                                profileAnswers[field.label] = [...cleanArr, newVal];
                                                            }} />
                                                    {/if}
                                                </div>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        {/each}
                    {/if}
                </div>

                <!-- CPD History Accordion -->
                {#if showCPDPoints}
                <div class="collapse collapse-arrow border border-gray-100 bg-white rounded-xl shadow-sm">
                    <input type="checkbox" /> 
                    <div class="collapse-title text-sm font-bold text-gray-700 flex items-center gap-2">
                        <span>📜</span> ប្រវត្តិពិន្ទុ (CPD History)
                    </div>
                    <div class="collapse-content px-0"> 
                        <div class="max-h-40 overflow-y-auto px-4">
                            {#if loadingCpdHistory}
                                <div class="text-center p-4"><span class="loading loading-spinner loading-sm text-primary"></span></div>
                            {:else if cpdHistory.length === 0}
                                <div class="text-center text-gray-400 text-xs py-4 italic">មិនទាន់មានប្រវត្តិពិន្ទុទេ</div>
                            {:else}
                                <table class="table table-xs w-full">
                                    <tbody>
                                        {#each cpdHistory as item}
                                            <tr class="border-b border-gray-50 last:border-none">
                                                <td class="py-2 pl-0">
                                                    <div class="font-bold text-xs text-gray-800 line-clamp-1">{item.courses.title}</div>
                                                    <div class="text-[10px] text-gray-400">{new Date(item.created_at).toLocaleDateString('km-KH')}</div>
                                                </td>
                                                <td class="text-right font-bold text-primary">+{item.courses.cpd_points}</td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            {/if}
                        </div>
                    </div>
                </div>
                {/if}

                <!-- Security Section -->
                <div class="bg-blue-50 p-4 rounded-xl border border-blue-100">
                    <label class="label cursor-pointer justify-between p-0">
                        <span class="label-text font-bold text-gray-700 flex items-center gap-2">
                            🔐 ប្តូរលេខកូដថ្មី PIN (មិនប្តូរក៏បាន)
                        </span>
                        <input type="checkbox" bind:checked={changePinMode} class="toggle toggle-primary toggle-sm" />
                    </label>
                    
                    {#if changePinMode}
                        <div class="mt-3 relative">
                            {#if showPin}
                                <input 
                                    type="text" 
                                    bind:value={profileForm.pin_code} 
                                    on:input={() => profileForm.pin_code = normalizeKhmerNumerals(profileForm.pin_code).replace(/\D/g, '')} 
                                    inputmode="numeric" 
                                    maxlength="4" 
                                    class="input input-bordered w-full text-center font-mono text-lg tracking-widest pr-10" 
                                    placeholder="សូមលេខកូដ៤ខ្ទង់ថ្មី PIN ថ្មី" 
                                />
                            {:else}
                                <input 
                                    type="password" 
                                    bind:value={profileForm.pin_code} 
                                    on:input={() => profileForm.pin_code = normalizeKhmerNumerals(profileForm.pin_code).replace(/\D/g, '')} 
                                    inputmode="numeric" 
                                    maxlength="4" 
                                    class="input input-bordered w-full text-center font-mono text-lg tracking-widest pr-10" 
                                    placeholder="សូមលេខកូដ៤ខ្ទង់ថ្មី PIN ថ្មី" 
                                />
                            {/if}
                            <button class="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-primary transition-colors" on:click={() => showPin = !showPin}>
                                {#if showPin}
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                                {:else}
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                {/if}
                            </button>
                        </div>
                    {/if}
                </div>
            </div>

            <!-- Footer Actions -->
            <div class="bg-blue-50 p-4 flex justify-between items-center border-t border-blue-100 shrink-0">
                <button class="flex items-center h-8 px-2 text-xs rounded hover:bg-red-50 cursor-pointer border-0 outline-none" style="color: #ef4444;" on:click={() => dispatch('logout')}>
                    <LogOutIcon class="w-4 h-4 mr-1" />
                    ចាកចេញ
                </button>
                <div class="flex gap-2">
                    {#if !forced}
                        <button class="btn btn-ghost btn-sm !min-h-0 !h-8 !px-3 !text-xs" on:click={cancel}>បោះបង់</button>
                    {/if}
                    <button class="btn btn-sm text-white shadow-md bg-[#0056b3] hover:bg-[#004494] border-none !min-h-0 !h-8 !px-4 !text-xs" on:click={save} disabled={isSaving}>
                        {#if isSaving}<span class="loading loading-spinner loading-xs"></span>{:else}រក្សាទុក{/if}
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}