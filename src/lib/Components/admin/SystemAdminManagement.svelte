<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    import { XIcon } from 'lucide-svelte';

    export let supabase;
    export let currentUser;

    const dispatch = createEventDispatcher();

    let systemAdmins = [];
    let promotionDates = {};
    let promotePhone = '';
    let promoteLoading = false;
    let promoteSuggestions = [];
    let showPromoteSuggestions = false;
    let suggestionTimer;
    let promoteInputEl;

    onMount(() => {
        loadSystemAdmins();
    });

    async function loadSystemAdmins() {
        if (currentUser?.role !== 'owner') return;
        const { data, error } = await supabase
            .from('users')
            .select('id, phone_number, full_name, name_latin, gender, avatar_url, role, xp, created_at, profile_data')
            .in('role', ['admin', 'owner'])
            .order('role', { ascending: false }); // Owner first
        
        if (error) console.error(error);
        else {
            systemAdmins = data || [];
            
            // ទាញយកប្រវត្តិថ្ងៃតែងតាំងពី Activity Logs
            if (systemAdmins.length > 0) {
                const { data: logs } = await supabase
                    .from('admin_logs')
                    .select('details, created_at')
                    .eq('action', 'Promote Admin')
                    .order('created_at', { ascending: false })
                    .limit(500);
                    
                if (logs) {
                    let tempDates = {};
                    logs.forEach(log => {
                        const match = log.details.match(/user ID: (.*)/);
                        if (match && match[1] && !tempDates[match[1].trim()]) tempDates[match[1].trim()] = log.created_at;
                    });
                    promotionDates = tempDates;
                }
            }
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

    async function handlePromoteInput() {
        clearTimeout(suggestionTimer);
        const searchTerm = promotePhone.trim();
        
        if (searchTerm.length < 2) {
            promoteSuggestions = [];
            showPromoteSuggestions = false;
            return;
        }

        suggestionTimer = setTimeout(async () => {
            const { data } = await supabase
                .from('users')
                .select('id, full_name, name_latin, phone_number, role')
                .or(`phone_number.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%,name_latin.ilike.%${searchTerm}%`)
                .limit(5);
            
            promoteSuggestions = data || [];
            showPromoteSuggestions = true;
        }, 300);
    }

    function clearPromoteSearch() {
        promotePhone = '';
        showPromoteSuggestions = false;
        if (promoteInputEl) promoteInputEl.focus();
    }

    function selectPromoteSuggestion(user) {
        promotePhone = user.phone_number;
        showPromoteSuggestions = false;
    }

    async function promoteToAdmin() {
        if (!promotePhone.trim()) return alert("សូមបញ្ចូលឈ្មោះ ឬលេខទូរស័ព្ទ!");
        
        promoteLoading = true;
        const searchTerm = promotePhone.trim();
        
        const { data: searchResults, error: findError } = await supabase.from('users').select('id, role, full_name, phone_number').or(`phone_number.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%,name_latin.ilike.%${searchTerm}%`).limit(1);
        
        if (findError) { promoteLoading = false; return alert("មានបញ្ហាក្នុងការស្វែងរក: " + findError.message); }
        if (!searchResults || searchResults.length === 0) { promoteLoading = false; return alert(`រកមិនឃើញអ្នកប្រើប្រាស់ដែលមានឈ្មោះ ឬលេខទូរស័ព្ទ "${searchTerm}" ទេ!`); }
        
        const user = searchResults[0];
        if (user.role === 'admin' || user.role === 'owner') { promoteLoading = false; return alert(`គាត់ (${user.full_name}) គឺជា ${user.role} រួចហើយ!`); }

        if (!confirm(`តើអ្នកពិតជាចង់តែងតាំង "${user.full_name}" (${user.phone_number}) ជាអ្នកគ្រប់គ្រង (Admin) មែនទេ?`)) { promoteLoading = false; return; }

        const { error: updateError } = await supabase.from('users').update({ role: 'admin' }).eq('id', user.id);
        
        if (updateError) {
            alert(updateError.message);
        }
        else {
            logAdminAction('Promote Admin', `Promoted user ID: ${user.id}`);
            alert(`បានតែងតាំង ${user.full_name} ជា Admin ជោគជ័យ!`);
            promotePhone = '';
            loadSystemAdmins();
        }
        promoteLoading = false;
    }

    async function demoteAdmin(id) {
        if (!confirm("តើអ្នកពិតជាចង់ដកសិទ្ធិ Admin មែនទេ?")) return;
        const { error } = await supabase.from('users').update({ role: 'member' }).eq('id', id);
        if (error) alert(error.message);
        else {
            logAdminAction('Demote Admin', `Demoted user ID: ${id}`);
            loadSystemAdmins();
        }
    }
</script>

<div class="card bg-base-100 p-5 shadow-md border border-base-300">
    <h3 class="mb-4 font-bold text-lg text-yellow-800">👑 គ្រប់គ្រងអ្នកមានសិទ្ធិ (Admins)</h3>
    
    <div class="flex gap-2 mb-6 p-4 bg-yellow-50/50 rounded-xl border border-yellow-100/50">
        <div class="relative w-full max-w-xs">
            <input type="text" 
                bind:this={promoteInputEl}
                bind:value={promotePhone} 
                on:input={handlePromoteInput}
                on:focus={() => { if(promoteSuggestions.length > 0) showPromoteSuggestions = true; }}
                on:blur={() => setTimeout(() => showPromoteSuggestions = false, 200)}
                on:keydown={(e) => e.key === 'Enter' && promoteToAdmin()} 
                placeholder="បញ្ចូលឈ្មោះ ឬលេខទូរស័ព្ទសមាជិក..." 
                class="input input-bordered w-full pr-8" />
            
            {#if promotePhone}
                <button type="button" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors" on:click={clearPromoteSearch}>
                    <XIcon class="w-4 h-4" />
                </button>
            {/if}

            {#if showPromoteSuggestions && promoteSuggestions.length > 0}
                <ul class="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-base-100 border border-base-300 rounded-box shadow-xl menu menu-sm p-2">
                    {#each promoteSuggestions as u}
                        <li>
                            <button type="button" class="flex flex-col items-start px-3 py-2 text-left" on:click={() => selectPromoteSuggestion(u)}>
                                <span class="font-bold text-sm text-gray-800">{u.full_name} {u.name_latin ? `(${u.name_latin})` : ''}</span>
                                <div class="flex justify-between w-full mt-1"><span class="text-xs text-gray-500">{u.phone_number}</span><span class="text-[10px] font-bold px-1.5 rounded bg-gray-100 {u.role === 'admin' ? 'text-primary' : u.role === 'owner' ? 'text-warning' : 'text-gray-500'}">{u.role}</span></div>
                            </button>
                        </li>
                    {/each}
                </ul>
            {/if}
        </div>
        <button on:click={promoteToAdmin} disabled={promoteLoading} class="btn btn-warning text-white shadow-sm">
            {#if promoteLoading}<span class="loading loading-spinner loading-xs"></span>{/if}
            តែងតាំងជា Admin
        </button>
    </div>

    <div class="overflow-x-auto bg-base-100 rounded-xl border border-base-300">
        <table class="table w-full">
            <thead class="bg-base-200 text-base-content"><tr><th>ឈ្មោះ</th><th>ឈ្មោះ (ឡាតាំង)</th><th>លេខទូរស័ព្ទ</th><th>ការងារ & អាជ្ញាប័ណ្ណ</th><th>តួនាទី</th><th>ថ្ងៃតែងតាំង</th><th>សកម្មភាព</th></tr></thead>
            <tbody>
                {#each systemAdmins as admin, i}
                    <tr class="hover" in:fade={{ duration: 200, delay: i * 30 }}><td><div class="flex items-center gap-3"><div class="avatar"><div class="mask mask-squircle w-10 h-10 bg-base-200 relative transition-all duration-200 ease-out hover:scale-[2.5] hover:z-50 origin-left hover:shadow-xl cursor-pointer">{#if admin.avatar_url}<img src={admin.avatar_url} alt="Avatar" />{:else}<span class="flex items-center justify-center h-full w-full text-lg font-bold text-gray-400">{admin.full_name?.[0]}</span>{/if}</div></div><div><div class="font-bold">{admin.full_name}</div></div></div></td><td>{admin.name_latin || '-'}</td><td>{admin.phone_number}</td><td><div class="font-bold text-xs">{admin.profile_data?.position || '-'}</div><div class="text-xs opacity-70">{admin.profile_data?.workplace || '-'}</div>{#if admin.profile_data?.license_number}<div class="text-[10px] opacity-70 font-mono mt-1">Lic: {admin.profile_data.license_number}</div>{/if}</td><td><span class="badge {admin.role === 'owner' ? 'badge-warning' : 'badge-primary'} font-bold">{admin.role.toUpperCase()}</span></td><td>{#if promotionDates[admin.id]}<div class="text-xs font-bold text-gray-700">{new Date(promotionDates[admin.id]).toLocaleDateString('km-KH')}</div><div class="text-[10px] text-gray-500">{new Date(promotionDates[admin.id]).toLocaleTimeString('km-KH')}</div>{:else}<span class="text-xs text-gray-400">-</span>{/if}</td><td>{#if admin.role !== 'owner' && admin.id !== currentUser.id}<button on:click={() => demoteAdmin(admin.id)} class="btn btn-error btn-xs text-white">ដកសិទ្ធិ</button>{/if}</td></tr>
                {/each}
            </tbody>
        </table>
    </div>
</div>