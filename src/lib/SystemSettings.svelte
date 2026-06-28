<script>
    import { createEventDispatcher } from 'svelte';
    import { compressImage, handleUpload } from '$lib/utils';

    export let supabase;
    export let loginLogoUrl = '';
    export let faviconUrl = '';
    export let version = '';
    export let currentUser;
    export let evaluationFormUrl = '';

    const dispatch = createEventDispatcher();
    let isFullBackingUp = false;
    let isFullRestoring = false;

    async function updateAppSetting(updates) {
        const { error } = await supabase.from('app_settings').upsert({ id: 1, ...updates });
        if (error) alert("បញ្ហាក្នុងការរក្សាទុកការកំណត់: " + error.message);
        else {
            logAdminAction('Update Settings', `Updated: ${Object.keys(updates).join(', ')}`);
            dispatch('refreshSettings');
        }
    }

    async function logAdminAction(action, details = '') {
        if (!currentUser?.id) return;
        await supabase.from('admin_logs').insert({
            admin_id: currentUser.id,
            action,
            details
        });
    }

    async function triggerFullBackup() {
        if (!confirm("តើអ្នកពិតជាចង់ Export ទិន្នន័យប្រព័ន្ធទាំងមូលមែនទេ?\n⚠️ ប្រតិបត្តិការនេះទាញទិន្នន័យពី 5 តារាង ហើយអាចចំណាយពេល 2-5 នាទី។ សូមមិនបិទ Tab នេះ។")) return;
        isFullBackingUp = true;
        
        try {
            // Helper function ដើម្បីទាញយកទិន្នន័យទាំងអស់ដោយមិនជាប់ Limit (Chunk Pagination)
            const fetchAll = async (table) => {
                let allData = [];
                let hasMore = true;
                let from = 0;
                const step = 1000;
                while (hasMore) {
                    const { data, error } = await supabase.from(table).select('*').range(from, from + step - 1);
                    if (error) throw new Error(`Error fetching ${table}: ${error.message}`);
                    if (data && data.length > 0) {
                        allData = [...allData, ...data];
                        from += step;
                        if (data.length < step) hasMore = false;
                    } else {
                        hasMore = false;
                    }
                }
                return allData;
            };

            // ទាញយកទិន្នន័យពីតារាងសំខាន់ៗទាំងអស់ក្នុងពេលតែមួយ
            const [usersData, coursesData, lessonsData, meetingsData, resultsData] = await Promise.all([
                fetchAll('users'),
                fetchAll('courses'),
                fetchAll('lessons'),
                fetchAll('live_meetings'),
                fetchAll('student_quiz_results')
            ]);

            const fullData = {
                export_date: new Date().toISOString(),
                users: usersData,
                courses: coursesData,
                lessons: lessonsData,
                live_meetings: meetingsData,
                student_quiz_results: resultsData
            };

            const jsonString = JSON.stringify(fullData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ccn-full-database-backup-${new Date().toISOString().slice(0,10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            
            logAdminAction('Full Backup', 'Exported entire system data as JSON');
        } catch (e) {
            console.error("Full Backup Error:", e);
            alert("មានបញ្ហាក្នុងការ Backup ទាំងមូល: " + e.message);
        } finally {
            isFullBackingUp = false;
        }
    }

    async function triggerFullRestore(e) {
        const file = e.target.files[0];
        if (!file) return;

        if (!confirm("តើអ្នកពិតជាចង់ Import ទិន្នន័យប្រព័ន្ធទាំងមូលពីឯកសារ JSON នេះមែនទេ?\nប្រយ័ត្ន៖ ទិន្នន័យដែលមានស្រាប់នឹងត្រូវ Update បើមាន ID ជាន់គ្នា។")) {
            e.target.value = '';
            return;
        }

        isFullRestoring = true;
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target.result);
                
                if (!data.users || !data.courses) {
                    throw new Error("ទម្រង់ឯកសារ JSON មិនត្រឹមត្រូវ!");
                }

                // លំដាប់ Import គឺសំខាន់ (តារាងមេមុន តារាងកូនក្រោយ)
                const tables = [
                    { name: 'users', data: data.users },
                    { name: 'courses', data: data.courses },
                    { name: 'lessons', data: data.lessons },
                    { name: 'live_meetings', data: data.live_meetings },
                    { name: 'student_quiz_results', data: data.student_quiz_results }
                ];

                for (const table of tables) {
                    if (table.data && table.data.length > 0) {
                        for (let i = 0; i < table.data.length; i += 100) {
                            const chunk = table.data.slice(i, i + 100);
                            const { error } = await supabase.from(table.name).upsert(chunk);
                            if (error) throw new Error(`បញ្ហាក្នុងការ Import តារាង ${table.name}: ${error.message}`);
                        }
                    }
                }

                alert("Restore ទិន្នន័យប្រព័ន្ធទាំងមូលជោគជ័យ!");
                logAdminAction('Full Restore', 'Imported entire system data from JSON');
            } catch (err) {
                alert("មិនអាច Import បានទេ៖ " + err.message);
            } finally {
                isFullRestoring = false;
                e.target.value = '';
            }
        };
        reader.readAsText(file);
    }

    async function uploadLoginLogo(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (!['image/jpeg', 'image/png'].includes(file.type)) {
            alert("សូម Upload តែឯកសារប្រភេទ JPG ឬ PNG ប៉ុណ្ណោះ!");
            e.target.value = '';
            return;
        }
        const compressed = await compressImage(file, 300, 0.9);
        const url = await handleUpload(compressed, 'settings');
        if (url) updateAppSetting({ login_logo_url: url });
    }

    async function uploadFavicon(e) {
        const file = e.target.files[0];
        if (!file) return;
        if (!['image/jpeg', 'image/png', 'image/x-icon'].includes(file.type)) {
            alert("សូម Upload តែឯកសារប្រភេទ JPG, PNG ឬ ICO ប៉ុណ្ណោះ!");
            e.target.value = '';
            return;
        }
        const url = await handleUpload(file, 'settings');
        if (url) updateAppSetting({ favicon_url: url });
    }

    function openFilePicker(target) {
        dispatch('openFilePicker', target);
    }
</script>

<div class="p-5 bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
    <h3 class="mb-3 font-bold">ការកំណត់រូបរាង</h3>

    <div class="mb-4">
        <div class="mb-1 text-sm font-semibold">ឡូហ្គោ</div>
        <div class="flex gap-2">
            <input id="login-logo-upload" type="file" on:change={uploadLoginLogo} class="hidden" accept=".jpg,.jpeg,.png" />
            <button type="button" class="btn btn-sm btn-square btn-outline btn-primary border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none" on:click={() => document.getElementById('login-logo-upload').click()}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
            </button>
            <button class="btn btn-sm btn-square btn-outline btn-info border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none" on:click={() => openFilePicker('logo')} title="ជ្រើសរើសពីឃ្លាំង">📂</button>
            {#if loginLogoUrl}
                <button on:click={() => updateAppSetting({ login_logo_url: null })} class="btn btn-sm btn-outline text-error border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none">កំណត់ឡើងវិញ</button>
            {/if}
        </div>
        <img src={loginLogoUrl || '/logo.png'} alt="មើលឡូហ្គោ" class="mt-2 h-20 w-20 rounded-full border-2 border-black object-cover" />
    </div>

    <div>
        <div class="mb-1 text-sm font-semibold">រូបសញ្ញាគេហទំព័រ</div>
        <div class="flex gap-2">
            <input id="favicon-upload" type="file" on:change={uploadFavicon} class="hidden" accept=".jpg,.jpeg,.png,.ico" />
            <button type="button" class="btn btn-sm btn-square btn-outline btn-primary border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none" on:click={() => document.getElementById('favicon-upload').click()}>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
            </button>
            <button class="btn btn-sm btn-square btn-outline btn-info border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none" on:click={() => openFilePicker('favicon')} title="ជ្រើសរើសពីឃ្លាំង">📂</button>
            {#if faviconUrl}
                <button on:click={() => updateAppSetting({ favicon_url: null })} class="btn btn-sm btn-outline text-error border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none">កំណត់ឡើងវិញ</button>
            {/if}
        </div>
        {#if faviconUrl}
            <img src={faviconUrl} alt="មើលរូបសញ្ញាគេហទំព័រ" class="mt-2 h-8 w-8 border-2 border-black object-contain" />
        {/if}
    </div>

    <div class="divider my-6"></div>

    <h3 class="mb-3 font-bold">តំណភ្ជាប់ Form វាយតម្លៃ (Evaluation Form)</h3>
    <div class="mb-4">
        <div class="mb-1 text-sm font-semibold">Google Form URL</div>
        <p class="text-xs text-gray-500 mb-2">បើ URL ត្រូវបានបំពេញ Banner វាយតម្លៃនឹងបង្ហាញនៅ Home Page។ ទុកទទេ ដើម្បីលាក់វា។</p>
        <div class="flex gap-2">
            <input
                type="url"
                class="input input-bordered flex-1 border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                placeholder="https://forms.gle/..."
                bind:value={evaluationFormUrl}
            />
            <button
                class="btn btn-primary border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none"
                on:click={() => updateAppSetting({ evaluation_form_url: evaluationFormUrl.trim() || null })}
            >រក្សាទុក</button>
            {#if evaluationFormUrl}
                <button
                    class="btn btn-outline text-error border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none"
                    on:click={() => { evaluationFormUrl = ''; updateAppSetting({ evaluation_form_url: null }); }}
                >លប់</button>
            {/if}
        </div>
    </div>

    <div class="divider my-6"></div>
    
    <h3 class="mb-3 font-bold">Export និង Import ទិន្នន័យ (Backup/Restore)</h3>
    <div class="bg-base-200 p-4 border-2 border-black">
        <p class="text-sm text-gray-600 mb-3">
            អ្នកអាចទាញយកទិន្នន័យប្រព័ន្ធទាំងមូល (Export) ជាទម្រង់ JSON ឬបញ្ចូលទិន្នន័យពី JSON នោះមកវិញ (Import)។
        </p>
        <div class="flex flex-wrap gap-2">
            <button class="btn btn-error text-white border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none" on:click={triggerFullBackup} disabled={isFullBackingUp}>
                {#if isFullBackingUp}<span class="loading loading-spinner loading-xs"></span>{/if} 💾 Full Backup (JSON)
            </button>
            <div class="relative">
                <input type="file" id="import-full-json" class="hidden" accept=".json" on:change={triggerFullRestore} />
                <button class="btn btn-warning border-2 border-black rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none" disabled={isFullRestoring} on:click={() => document.getElementById('import-full-json').click()}>
                    {#if isFullRestoring}<span class="loading loading-spinner loading-xs"></span>{/if} 📂 Full Restore (JSON)
                </button>
            </div>
        </div>
    </div>

    <div class="mt-8 text-center text-xs text-gray-400">
        System Version: v{version}
    </div>
</div>