<script>
    import { createEventDispatcher, onMount } from 'svelte';
    import { fade, scale } from 'svelte/transition';
    import { FileDownIcon, FileUpIcon, RefreshCwIcon, PlusIcon, SearchIcon, Trash2Icon, PencilIcon, XIcon } from 'lucide-svelte';
    import UserEditModal from './UserEditModal.svelte';
    import UserSummaryStats from './UserSummaryStats.svelte';
    export let supabase;
    
    export let currentUserRole = 'admin'; // សម្រាប់ទទួល Role របស់អ្នកដែលកំពុង Login
    
    const dispatch = createEventDispatcher();
    
    let users = [];
    let summaryStats = { gender: {}, position: {}, workplace: {}, licenseStatus: {}, province: {} };
    let loading = false;
    let search = '';
    let provinceFilter = '';
    let licenseFilter = '';
    let page = 1;
    const pageSize = 10;
    let totalUsers = 0;
    let sortColumn = 'created_at';
    let sortDirection = 'desc';
    let searchTimer; // Variable សម្រាប់ Debounce

    let searchSuggestions = [];
    let showSearchSuggestions = false;
    let preventNextSuggestion = false;

    let searchInputEl; // អថេរសម្រាប់ចាប់យក DOM Element របស់ប្រអប់ស្វែងរក

    let selectedUsers = new Set();
    $: allPageSelected = users.length > 0 && users.every(u => selectedUsers.has(u.id));

    function toggleSort(column) {
        if (sortColumn === column) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            sortColumn = column;
            sortDirection = 'desc';
        }
        loadUsers();
    }

    // Function ពន្យារពេលស្វែងរក ដើម្បីកុំឱ្យហៅ API ញឹកពេក
    function handleSearch() {
        loading = true; // បង្ហាញ Spinner ភ្លាមៗពេលចាប់ផ្តើមវាយអក្សរ
        preventNextSuggestion = false; // បើកឱ្យលោត Suggestion វិញពេលវាយ
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            page = 1;
            selectedUsers.clear();
            selectedUsers = selectedUsers;
            loadUsers();
        }, 300);
    }

    function clearSearch() {
        search = '';
        showSearchSuggestions = false;
        handleSearch();
        if (searchInputEl) searchInputEl.focus(); // ដាក់ Cursor ចូលប្រអប់វិញ
    }

    function selectSearchSuggestion(user) {
        search = user.phone_number; // ប្តូរប្រអប់ស្វែងរកទៅជាលេខទូរស័ព្ទរបស់គាត់
        preventNextSuggestion = true; // ការពារកុំឱ្យលោត Dropdown មកវិញ
        showSearchSuggestions = false;
        page = 1;
        loadUsers();
    }

    function handleFilterChange() {
        page = 1;
        selectedUsers.clear();
        selectedUsers = selectedUsers;
        loadUsers();
    }

    let showEditModal = false;
    let selectedUserForEdit = null;
    let promotePhone = '';
    let promoteLoading = false;
    let promoteSuggestions = [];
    let showPromoteSuggestions = false;
    let suggestionTimer;
    let promoteInputEl; // អថេរសម្រាប់ចាប់យក DOM Element របស់ប្រអប់តែងតាំង

    // មុខងារស្វែងរកពេលកំពុងវាយអក្សរ (Debounced Auto-suggest)
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
                .limit(5); // បង្ហាញត្រឹម ៥ នាក់ដំបូងដែលស្រដៀងជាងគេ
            
            promoteSuggestions = data || [];
            showPromoteSuggestions = true;
        }, 300);
    }

    function clearPromoteSearch() {
        promotePhone = '';
        showPromoteSuggestions = false;
        if (promoteInputEl) promoteInputEl.focus(); // ដាក់ Cursor ចូលប្រអប់វិញ
    }

    // មុខងារពេលចុចរើសឈ្មោះចេញពី Dropdown
    function selectPromoteSuggestion(user) {
        promotePhone = user.phone_number; // ចាប់យកលេខទូរស័ព្ទមកដាក់ក្នុងប្រអប់
        showPromoteSuggestions = false;
    }

    async function promoteToAdmin() {
        if (!promotePhone.trim()) return alert("សូមបញ្ចូលឈ្មោះ ឬលេខទូរស័ព្ទ!");
        
        promoteLoading = true;
        const searchTerm = promotePhone.trim();
        
        // ១. ស្វែងរកសមាជិកតាមលេខទូរស័ព្ទ ឬឈ្មោះ (ប្រើ ilike ដើម្បីងាយរកឃើញ ទោះវាយមិនពេញក៏ដោយ)
        const { data: searchResults, error: searchError } = await supabase
            .from('users')
            .select('id, full_name, role, phone_number')
            .or(`phone_number.ilike.%${searchTerm}%,full_name.ilike.%${searchTerm}%,name_latin.ilike.%${searchTerm}%`)
            .limit(1);
            
        if (searchError) {
            promoteLoading = false;
            return alert("មានបញ្ហាក្នុងការស្វែងរក: " + searchError.message);
        }
        
        if (!searchResults || searchResults.length === 0) {
            promoteLoading = false;
            return alert(`រកមិនឃើញសមាជិកដែលមានឈ្មោះ ឬលេខទូរស័ព្ទ "${searchTerm}" ទេ!`);
        }
        const userToPromote = searchResults[0];

        if (userToPromote.role === 'owner') {
            promoteLoading = false;
            return alert("ម្ចាស់ប្រព័ន្ធ (Owner) មានសិទ្ធិខ្ពស់បំផុតរួចហើយ!");
        }
        if (userToPromote.role === 'admin') {
            promoteLoading = false;
            return alert(`សមាជិកឈ្មោះ "${userToPromote.full_name}" គឺជាអ្នកគ្រប់គ្រង (Admin) រួចហើយ!`);
        }

        // ២. អាប់ដេត Role
        if (!confirm(`តើអ្នកពិតជាចង់តែងតាំង "${userToPromote.full_name}" (${userToPromote.phone_number}) ជាអ្នកគ្រប់គ្រង (Admin) មែនទេ?`)) {
            promoteLoading = false;
            return;
        }

        const { error: updateError } = await supabase.from('users').update({ role: 'admin' }).eq('id', userToPromote.id);

        if (updateError) {
            alert("បរាជ័យក្នុងការតែងតាំង: " + updateError.message);
        } else {
            alert(`✅ បានតែងតាំង "${userToPromote.full_name}" ជា Admin ជោគជ័យ!`);
            promotePhone = '';
            loadUsers();
            dispatch('refresh');
        }
        promoteLoading = false;
    }

    onMount(() => {
        loadUsers();
    });

    async function loadUsers() {
        loading = true;
        try {
            // Fetch paginated users for table
            let query = supabase.from('users').select('id, phone_number, full_name, name_latin, gender, avatar_url, role, xp, created_at, profile_data', { count: 'exact' });
            if (search) {
                query = query.or(`full_name.ilike.%${search}%,name_latin.ilike.%${search}%,phone_number.ilike.%${search}%,profile_data->>license_number.ilike.%${search}%`);
            }
            if (provinceFilter) {
                query = query.eq('profile_data->>province', provinceFilter);
            }
            if (licenseFilter) {
                query = query.eq('profile_data->>license_status', licenseFilter);
            }
            query = query.order(sortColumn, { ascending: sortDirection === 'asc' });
            const from = (page - 1) * pageSize;
            const to = from + pageSize - 1;
            const { data, count, error } = await query.range(from, to);
            if (error) throw error;
            users = data || [];
            totalUsers = count || 0;

            // ទាញយក ៥នាក់ដំបូង មកធ្វើជា Suggestion បើវាយបាន ២ តួអក្សរឡើង
            if (search.trim().length >= 2 && users.length > 0 && !preventNextSuggestion) {
                searchSuggestions = users.slice(0, 5);
                showSearchSuggestions = true;
            } else {
                searchSuggestions = [];
                showSearchSuggestions = false;
            }
            preventNextSuggestion = false; // សម្រាប់ Reset មកដើមវិញ

            // Fetch Summary Stats efficiently via RPC
            const { data: rpcStats } = await supabase.rpc('get_filtered_user_stats', {
                search_term: search || null,
                prov_filter: provinceFilter || null,
                lic_filter: licenseFilter || null
            });
            
            if (rpcStats) {
                summaryStats = rpcStats;
            }
        } catch (e) {
            console.error("Error loading users:", e);
        } finally {
            loading = false;
        }
    }

    function openEditModal(user) {
        if (currentUserRole !== 'owner' && user.role === 'owner') {
            return alert("អ្នកមិនមានសិទ្ធិកែប្រែទិន្នន័យម្ចាស់ប្រព័ន្ធ (Owner) ទេ!");
        }
        selectedUserForEdit = user;
        showEditModal = true;
    }

    function openCreateModal() {
        selectedUserForEdit = {
            full_name: '', name_latin: '', phone_number: '', gender: 'Male', role: 'member',
            profile_data: { position: '', workplace: '', province: '', license_status: '', license_number: '' }
        };
        showEditModal = true;
    }

    async function hashPin(pin) {
        const normalized = pin.trim();
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            const data = new TextEncoder().encode(normalized);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
            return `sha256:${hashHex}`;
        }
        return normalized;
    }

    async function resetUserPin(user) {
        if (currentUserRole !== 'owner' && user.role === 'owner') {
            return alert("អ្នកមិនមានសិទ្ធិប្តូរលេខកូដម្ចាស់ប្រព័ន្ធ (Owner) ទេ!");
        }
        const inputPin = prompt(`បញ្ចូលលេខកូដ PIN ៤ខ្ទង់ថ្មី សម្រាប់សមាជិក "${user.full_name}":`, "1234");
        if (inputPin === null) return;

        const cleanPin = inputPin.replace(/\D/g, '');
        if (cleanPin.length !== 4) return alert("សូមបញ្ចូលលេខកូដឱ្យបាន ៤ ខ្ទង់គត់!");

        const hashedPin = await hashPin(cleanPin);
        const { error } = await supabase.rpc('change_pin', { user_id: user.id, new_pin: hashedPin });

        if (error) {
            alert("បរាជ័យក្នុងការប្តូរ PIN: " + error.message);
        } else {
            alert(`✅ បានប្តូរ PIN របស់ ${user.full_name} ទៅជា [${cleanPin}] ជោគជ័យ!`);
        }
    }

    async function resetSelectedUsersPin() {
        if (selectedUsers.size === 0) return;
        const inputPin = prompt(`បញ្ចូលលេខកូដ PIN ៤ខ្ទង់ថ្មី សម្រាប់សមាជិកទាំង ${selectedUsers.size} នាក់:`, "1234");
        if (inputPin === null) return;

        const cleanPin = inputPin.replace(/\D/g, '');
        if (cleanPin.length !== 4) return alert("សូមបញ្ចូលលេខកូដឱ្យបាន ៤ ខ្ទង់គត់!");

        if (!confirm(`តើអ្នកពិតជាចង់ប្តូរលេខកូដសម្ងាត់សមាជិកទាំង ${selectedUsers.size} នាក់ ទៅជា [${cleanPin}] មែនទេ?`)) return;

        loading = true;
        const hashedPin = await hashPin(cleanPin);
        const idsToReset = Array.from(selectedUsers);
        let successCount = 0;
        
        await Promise.all(idsToReset.map(async (userId) => {
            const { error } = await supabase.rpc('change_pin', { user_id: userId, new_pin: hashedPin });
            if (!error) successCount++;
        }));
        
        loading = false;
        alert(`✅ បានប្តូរ PIN សមាជិកចំនួន ${successCount} នាក់ ទៅជា [${cleanPin}] ជោគជ័យ!`);
        
        selectedUsers.clear();
        selectedUsers = selectedUsers;
    }

    function toggleUserSelection(id) {
        if (selectedUsers.has(id)) selectedUsers.delete(id);
        else selectedUsers.add(id);
        selectedUsers = selectedUsers;
    }

    function toggleSelectAllUsers(e) {
        if (e.target.checked) {
            users.forEach(u => {
                if (currentUserRole === 'owner' || u.role !== 'owner') selectedUsers.add(u.id);
            });
        } else {
            users.forEach(u => selectedUsers.delete(u.id));
        }
        selectedUsers = selectedUsers;
    }

    async function selectAllFilteredUsers() {
        loading = true;
        let hasMore = true;
        let currentFrom = 0;
        const step = 1000;
        
        while (hasMore) {
            let query = supabase.from('users').select('id, role');
            if (search) query = query.or(`full_name.ilike.%${search}%,name_latin.ilike.%${search}%,phone_number.ilike.%${search}%,profile_data->>license_number.ilike.%${search}%`);
            if (provinceFilter) query = query.eq('profile_data->>province', provinceFilter);
            if (licenseFilter) query = query.eq('profile_data->>license_status', licenseFilter);
            
            const { data, error } = await query.range(currentFrom, currentFrom + step - 1);
            if (error || !data || data.length === 0) break;
            
            data.forEach(u => {
                if (currentUserRole === 'owner' || u.role !== 'owner') selectedUsers.add(u.id);
            });
            currentFrom += step;
            if (data.length < step) hasMore = false;
        }
        selectedUsers = selectedUsers;
        loading = false;
    }

    async function deleteSelectedUsers() {
        if (selectedUsers.size === 0) return;
        if (!confirm(`តើអ្នកពិតជាចង់លុបសមាជិកចំនួន ${selectedUsers.size} នាក់មែនទេ?\nសកម្មភាពនេះមិនអាចត្រឡប់វិញបានទេ។`)) return;

        const idsToDelete = Array.from(selectedUsers);
        const { error } = await supabase.from('users').delete().in('id', idsToDelete);

        if (error) {
            alert("បរាជ័យក្នុងការលុប: " + error.message);
        } else {
            alert("បានលុបសមាជិកដែលបានជ្រើសរើសជោគជ័យ!");
            selectedUsers.clear();
            selectedUsers = selectedUsers;
            loadUsers();
            dispatch('refresh');
        }
    }

    async function deleteUser(user) {
        if (currentUserRole !== 'owner' && user.role === 'owner') {
            return alert("អ្នកមិនមានសិទ្ធិលុបគណនីម្ចាស់ប្រព័ន្ធ (Owner) ទេ!");
        }
        if (!confirm(`តើអ្នកពិតជាចង់លុបសមាជិកឈ្មោះ "${user.full_name}" ចេញពីប្រព័ន្ធមែនទេ?`)) return;

        const { error } = await supabase.from('users').delete().eq('id', user.id);

        if (error) {
            alert("បរាជ័យក្នុងការលុប: " + error.message);
        } else {
            alert("បានលុបសមាជិកជោគជ័យ!");
            loadUsers();
            dispatch('refresh');
        }
    }

    async function exportUsersToExcel() {
        const BOM = "\uFEFF";
        const headers = ['ឈ្មោះ', 'ឈ្មោះ (ឡាតាំង)', 'ភេទ', 'លេខទូរស័ព្ទ', 'មុខតំណែង / កម្រិតជំនាញ (Position / Qualification)', 'កន្លែងធ្វើការ', 'លេខអាជ្ញាប័ណ្ណ', 'តួនាទី (Role)', 'XP', 'កាលបរិច្ឆេទចុះឈ្មោះ'];
        const csvRows = [headers.join(',')];

        let hasMore = true;
        let currentFrom = 0;
        const step = 1000;
        let fetchedCount = 0;

        while (hasMore) {
            let query = supabase.from('users').select('id, phone_number, full_name, name_latin, gender, role, xp, created_at, profile_data');
            if (search) query = query.or(`full_name.ilike.%${search}%,name_latin.ilike.%${search}%,phone_number.ilike.%${search}%,profile_data->>license_number.ilike.%${search}%`);
            if (provinceFilter) query = query.eq('profile_data->>province', provinceFilter);
            if (licenseFilter) query = query.eq('profile_data->>license_status', licenseFilter);
            
            const { data, error } = await query.order('created_at', { ascending: false }).range(currentFrom, currentFrom + step - 1);
            if (error || !data || data.length === 0) break;

            data.forEach(user => {
                const row = [
                    `"${(user.full_name || '').replace(/"/g, '""')}"`,
                    `"${(user.name_latin || '').replace(/"/g, '""')}"`,
                    `"${user.gender === 'Male' ? 'ប្រុស' : 'ស្រី'}"`,
                    `="${(user.phone_number || '').replace(/"/g, '""')}"`,
                    `"${(user.profile_data?.position || '').replace(/"/g, '""')}"`,
                    `"${(user.profile_data?.workplace || '').replace(/"/g, '""')}"`,
                    `"${(user.profile_data?.license_number || '').replace(/"/g, '""')}"`,
                    `"${user.role || ''}"`,
                    `"${user.xp || 0}"`,
                    `"${new Date(user.created_at).toLocaleDateString('km-KH')}"`
                ];
                csvRows.push(row.join(','));
            });

            fetchedCount += data.length;
            currentFrom += step;
            if (data.length < step) hasMore = false;
        }
        
        if (fetchedCount === 0) return alert("គ្មានទិន្នន័យសម្រាប់ Export ទេ");

        const blob = new Blob([BOM + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `users_list_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function importUsersFromExcel(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            const text = event.target.result;
            const lines = text.split('\n');
            let successCount = 0;
            const newUsers = [];
            const defaultPinHash = await hashPin('1234'); // កំណត់ PIN លំនាំដើម 1234

            // រំលង Header (ជួរទី 1)
            let startIndex = 0;
            if (lines.length > 0 && (lines[0].includes('ឈ្មោះ') || lines[0].includes('Name'))) startIndex = 1;

            for (let i = startIndex; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                // Parse CSV (បំបែកដោយសញ្ញាក្បៀស , និងដកសញ្ញា " ចេញ)
                // កែសម្រួល Regex ដើម្បីឱ្យស្គាល់ឈ្មោះដែលមានដកឃ្លា (Space)
                const matches = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g);
                if (matches && matches.length >= 3) {
                    const cols = matches.map(m => m.replace(/^"|"$/g, '').trim());
                    
                    newUsers.push({
                        full_name: cols[0],
                        name_latin: cols[1],
                        gender: cols[2] === 'ប្រុស' ? 'Male' : 'Female',
                        phone_number: cols[3],
                        role: (currentUserRole === 'owner' && ['owner', 'admin'].includes(cols[7])) 
                              ? cols[7] 
                              : 'member',
                        pin_code: defaultPinHash,
                        xp: 0
                    });
                    successCount++;
                }
            }

            if (newUsers.length > 0) {
                const { error } = await supabase.from('users').insert(newUsers);
                if (error) alert("Error importing: " + error.message + "\n(សូមពិនិត្យមើលលេខទូរស័ព្ទស្ទួន)");
                else {
                    alert(`បាននាំចូល ${successCount} នាក់ជោគជ័យ!\n(PIN លំនាំដើមគឺ: 1234)`);
                    loadUsers();
                    dispatch('refresh');
                }
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    }

    $: totalPages = Math.ceil(totalUsers / pageSize);

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
            }
        };
    }
</script>

<div class="card bg-base-100 p-5 shadow-md border border-base-300">
    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
        <div>
            <h3 class="font-bold text-xl text-gray-800">👥 គ្រប់គ្រងអ្នកប្រើប្រាស់</h3>
        </div>
        <div class="flex flex-wrap gap-2 w-full md:w-auto justify-end items-center">
            <button on:click={openCreateModal} class="btn btn-sm btn-primary shadow-sm hover:shadow-md">
                <PlusIcon class="w-4 h-4 mr-1" /> បង្កើតថ្មី
            </button>
            <button on:click={loadUsers} class="btn btn-sm btn-outline shadow-sm hover:shadow-md">
                <RefreshCwIcon class="w-4 h-4 {loading ? 'animate-spin' : ''}" /> Refresh
            </button>
            <div class="flex flex-wrap gap-1 bg-base-200/50 p-1 px-2 rounded-lg border border-base-300 items-center">
                <span class="text-xs font-bold text-gray-500 mr-1 hidden lg:inline-block">ទិន្នន័យ:</span>
                <button on:click={exportUsersToExcel} class="btn btn-xs btn-success text-white shadow-sm" title="ទាញយកបញ្ជីសមាជិក (CSV)">
                    <FileDownIcon class="w-3 h-3 mr-1" /> CSV
                </button>
                <div class="divider divider-horizontal mx-0 w-1"></div>
                <label class="btn btn-xs btn-info text-white shadow-sm cursor-pointer hover:opacity-90" title="នាំចូលសមាជិកពី Excel">
                    <FileUpIcon class="w-3 h-3 mr-1" /> Import
                    <input type="file" accept=".csv" class="hidden" on:change={importUsersFromExcel} />
                </label>
            </div>
        </div>
    </div>

    <!-- 👑 គ្រប់គ្រងអ្នកមានសិទ្ធិ (Admins) - បង្ហាញតែ Owner ប៉ុណ្ណោះ -->
    {#if currentUserRole === 'owner'}
    <div>
        <h4 class="font-bold text-gray-700 mb-2 ml-1">👑 គ្រប់គ្រងអ្នកមានសិទ្ធិ (Admins)</h4>
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
                    class="input input-bordered w-full pr-8"> 
                
                <!-- ប៊ូតុងលុបអក្សរ (X) -->
                {#if promotePhone}
                    <button type="button" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors" on:click={clearPromoteSearch}>
                        <XIcon class="w-4 h-4" />
                    </button>
                {/if}

                <!-- បញ្ជីធ្លាក់ចុះ (Dropdown Suggestions) -->
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
    </div>
    {/if}

    <div class="bg-base-200/50 p-3 border border-base-300 rounded-xl mb-4 flex flex-col xl:flex-row gap-3 items-start xl:items-center justify-between">
        <div class="flex flex-wrap gap-2 w-full xl:w-auto flex-1 items-center">
            <div class="relative w-full sm:w-auto sm:min-w-[200px]">
                {#if loading}
                    <span class="absolute left-2.5 top-1/2 -translate-y-1/2 loading loading-spinner loading-xs text-primary"></span>
                {:else}
                    <SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                {/if}
                <input type="text" 
                    bind:this={searchInputEl}
                    bind:value={search} on:input={handleSearch} 
                    on:focus={() => { if(searchSuggestions.length > 0) showSearchSuggestions = true; }}
                    on:blur={() => setTimeout(() => showSearchSuggestions = false, 200)}
                    placeholder="ស្វែងរកឈ្មោះ/លេខទូរស័ព្ទ..." class="input input-sm input-bordered w-full pl-8 pr-8" />
                
                <!-- ប៊ូតុងលុបអក្សរ (X) -->
                {#if search}
                    <button type="button" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors" on:click={clearSearch}>
                        <XIcon class="w-4 h-4" />
                    </button>
                {/if}

                <!-- បញ្ជីធ្លាក់ចុះ (Dropdown Suggestions) សម្រាប់ប្រអប់ស្វែងរកធំ -->
                {#if showSearchSuggestions && searchSuggestions.length > 0}
                    <ul class="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto bg-base-100 border border-base-300 rounded-box shadow-xl menu menu-sm p-2 top-full left-0">
                        {#each searchSuggestions as u}
                            <li>
                                <button type="button" class="flex flex-col items-start px-3 py-2 text-left" on:click={() => selectSearchSuggestion(u)}>
                                    <span class="font-bold text-sm text-gray-800">{u.full_name} {u.name_latin ? `(${u.name_latin})` : ''}</span>
                                    <div class="flex justify-between w-full mt-1"><span class="text-xs text-gray-500">{u.phone_number}</span><span class="text-[10px] font-bold px-1.5 rounded bg-gray-100 {u.role === 'admin' ? 'text-primary' : u.role === 'owner' ? 'text-warning' : 'text-gray-500'}">{u.role}</span></div>
                                </button>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>
            <select bind:value={licenseFilter} on:change={handleFilterChange} class="select select-sm select-bordered w-full sm:w-auto">
                <option value="">🪪 អាជ្ញាប័ណ្ណទាំងអស់</option>
                <option value="មាន">មាន</option>
                <option value="មិនមាន">មិនមាន</option>
                <option value="មានតែហួសសុពលភាព">មានតែហួសសុពលភាព</option>
                <option value="កំពុងបន្ដ">កំពុងបន្ដ</option>
            </select>
            <select bind:value={provinceFilter} on:change={handleFilterChange} class="select select-sm select-bordered w-full sm:w-auto">
                <option value="">📍 គ្រប់ខេត្តទាំងអស់</option>
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
        {#if selectedUsers.size > 0}
            <div class="flex gap-2 items-center bg-white p-1 px-2 rounded-lg border border-red-200 shadow-sm shrink-0">
                {#if selectedUsers.size < totalUsers}
                    <button on:click={selectAllFilteredUsers} class="btn btn-xs btn-ghost text-primary hover:bg-primary/10">ជ្រើសរើសទាំង {totalUsers}</button>
                {/if}
                <button on:click={resetSelectedUsersPin} class="btn btn-xs btn-warning text-white shadow-sm" title="ប្តូរលេខកូដអ្នកដែលបានជ្រើសរើស">
                    🔑 លេខកូដ ({selectedUsers.size})
                </button>
                <button on:click={deleteSelectedUsers} class="btn btn-xs btn-error text-white shadow-sm animate-pulse">
                    <Trash2Icon class="w-3 h-3 mr-1" /> លុប ({selectedUsers.size})
                </button>
            </div>
        {/if}
    </div>

    <!-- ផ្ទាំងបង្ហាញស្ថិតិសង្ខេប -->
    <UserSummaryStats stats={summaryStats} {totalUsers} />

    <div class="overflow-x-auto bg-base-100 rounded-xl border border-base-300">
        <table class="table table-xs w-full">
            <thead class="bg-white/40 border-b border-white/30 text-black">
                <tr>
                    <th class="w-10 text-center">
                        <label>
                            <input type="checkbox" class="checkbox checkbox-xs border-gray-400" 
                                checked={allPageSelected} 
                                on:change={toggleSelectAllUsers} />
                        </label>
                    </th>
                    <th>ឈ្មោះ (ខ្មែរ/ឡាតាំង)</th>
                    <th>ភេទ</th>
                    <th>លេខទូរស័ព្ទ</th>
                    <th>ការងារ & អាជ្ញាប័ណ្ណ</th>
                    <th>តួនាទី (Role)</th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleSort('xp')}>
                        XP {sortColumn === 'xp' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th class="cursor-pointer hover:bg-gray-200 select-none" on:click={() => toggleSort('created_at')}>
                        កាលបរិច្ឆេទ {sortColumn === 'created_at' ? (sortDirection === 'asc' ? '▲' : '▼') : ''}
                    </th>
                    <th>សកម្មភាព</th>
                </tr>
            </thead>
            <tbody>
                {#if loading}
                    <tr><td colspan="9" class="text-center py-4">កំពុងផ្ទុក...</td></tr>
                {:else if users.length === 0}
                    <tr><td colspan="9" class="text-center py-4 text-gray-500">រកមិនឃើញទិន្នន័យ</td></tr>
                {:else}
                    {#each users as user, i (user.id)}
                        <tr class="hover border-b border-base-200 {selectedUsers.has(user.id) ? 'bg-red-50/40' : ''}" in:fade={{ duration: 200, delay: i * 30 }}>
                            <td class="text-center">
                                <label>
                                    <input type="checkbox" class="checkbox checkbox-xs border-gray-400" 
                                        checked={selectedUsers.has(user.id)} 
                                        disabled={currentUserRole !== 'owner' && user.role === 'owner'}
                                        on:change={() => toggleUserSelection(user.id)} />
                                </label>
                            </td>
                            <td>
                                <div class="flex items-center gap-3">
                                    <div class="avatar">
                                        <div class="w-8 h-8 bg-white/50 border border-white/40 rounded-full overflow-hidden relative glass-reflection transition-all duration-200 ease-out hover:scale-[3.5] hover:z-50 origin-left hover:shadow-xl cursor-pointer">
                                            {#if user.avatar_url}
                                                <img src={user.avatar_url} alt="Avatar" />
                                            {:else}
                                                <span class="flex items-center justify-center h-full w-full font-bold text-gray-400">{user.full_name?.[0]}</span>
                                            {/if}
                                        </div>
                                    </div>
                                    <div>
                                        <div class="font-bold">{user.full_name}</div>
                                        <div class="text-xs opacity-50">{user.name_latin || ''}</div>
                                    </div>
                                </div>
                            </td>
                            <td>{user.gender === 'Male' ? 'ប្រុស' : 'ស្រី'}</td>
                            <td>{user.phone_number}</td>
                            <td>
                                <div class="font-bold text-xs">{user.profile_data?.position || '-'}</div>
                                <div class="text-xs opacity-70">{user.profile_data?.workplace || '-'}</div>
                                {#if user.profile_data?.province}
                                    <div class="text-xs opacity-80 text-gray-600">{user.profile_data.province}</div>
                                {/if}
                                {#if user.profile_data?.license_status}
                                    <div class="text-[10px] mt-1 font-mono font-bold {
                                        user.profile_data.license_status === 'មាន' ? 'text-success' : 
                                        user.profile_data.license_status === 'មានតែហួសសុពលភាព' ? 'text-error' : 
                                        user.profile_data.license_status === 'កំពុងបន្ដ' ? 'text-warning' : 'text-gray-500'
                                    }">
                                        Lic: {user.profile_data.license_status} {user.profile_data.license_number ? `(${user.profile_data.license_number})` : ''}
                                    </div>
                                {/if}
                            </td>
                            <td>
                                <span class="badge badge-sm border border-white/40 rounded-lg {user.role === 'admin' ? 'badge-primary' : user.role === 'owner' ? 'badge-warning' : 'badge-ghost'}">
                                    {user.role}
                                </span>
                            </td>
                            <td>{user.xp || 0}</td>
                            <td class="text-sm">{new Date(user.created_at).toLocaleDateString('km-KH')}</td>
                            <td class="space-x-1">
                                <button on:click={() => resetUserPin(user)} class="btn btn-xs btn-outline btn-warning" title="ប្តូរលេខកូដ (Reset PIN)" disabled={currentUserRole !== 'owner' && user.role === 'owner'}>
                                    🔑
                                </button>
                                <button on:click={() => openEditModal(user)} class="btn btn-xs btn-outline btn-info" title="កែប្រែ" disabled={currentUserRole !== 'owner' && user.role === 'owner'}>
                                    <PencilIcon class="w-3 h-3" />
                                </button>
                                <button on:click={() => deleteUser(user)} class="btn btn-xs btn-outline btn-error" title="លុប" disabled={currentUserRole !== 'owner' && user.role === 'owner'}>
                                    <Trash2Icon class="w-3 h-3" />
                                </button>
                            </td>
                        </tr>
                    {/each}
                {/if}
            </tbody>
        </table>
    </div>

    <div class="flex justify-center mt-4 gap-2">
        <button class="btn btn-sm btn-outline" disabled={page === 1} on:click={() => { page--; loadUsers(); }}>«</button>
        <span class="btn btn-sm btn-ghost">ទំព័រ {page} នៃ {totalPages || 1}</span>
        <button class="btn btn-sm btn-outline" disabled={page >= totalPages} on:click={() => { page++; loadUsers(); }}>»</button>
    </div>
</div>

<UserEditModal
    bind:show={showEditModal}
    user={selectedUserForEdit}
    {supabase}
    {currentUserRole}
    on:saved={() => {
        loadUsers();
        dispatch('refresh');
    }}
/>