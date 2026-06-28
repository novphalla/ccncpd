<script context="module">
    export function draggable(node) {
        let startX, startY, initialLeft, initialTop;
        const modalBox = node.closest('.modal-box');
        
        if (!modalBox) return;

        function onMouseDown(e) {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            
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

        return { destroy() { node.removeEventListener('mousedown', onMouseDown); } };
    }
</script>

<script>
    import { createEventDispatcher } from 'svelte';
    import { fade, scale } from 'svelte/transition';

    export let show = false;
    export let user = null;
    export let supabase;
    export let currentUserRole = 'admin'; // ទទួល Role ពី UserManagement មកវិញ

    const dispatch = createEventDispatcher();

    let editingUser = null;
    let newPin = '';
    let tempPositionSelect = '';
    let tempWorkplaceSelect = '';
    let prevUser = null;

    // ដំណើរការតែពេល user ផ្លាស់ប្តូរ (មិនដំណើរការពេលវាយអក្សរ)
    $: if (show && user && user !== prevUser) {
        prevUser = user;
        const eu = JSON.parse(JSON.stringify(user));
        
        eu.profile_data = eu.profile_data || {};
        eu.profile_data.position = eu.profile_data.position || '';
        eu.profile_data.workplace = eu.profile_data.workplace || '';
        eu.profile_data.license_status = eu.profile_data.license_status || '';
        eu.profile_data.license_number = eu.profile_data.license_number || '';
        eu.profile_data.province = eu.profile_data.province || '';

        const stdPositions = ['Prof./Associate Prof./Assistant Prof.', 'Lecturer', 'Nurse', 'Midwife', 'Ophthalmic Nurse', 'Nurse Anesthetist', 'Dental Nurse', 'Nursing/Midwife Student'];
        tempPositionSelect = stdPositions.includes(eu.profile_data.position) ? eu.profile_data.position : (eu.profile_data.position ? 'Others' : '');

        const stdWorkplaces = ['ក្រសួងសុខាភិបាល', 'មន្ទីរសុខាភិបាល/OD', 'មន្ទីរពេទ្យរដ្ឋ', 'មន្ទីរពេទ្យឯកជន', 'អង្គការក្រៅរដ្ឋាភិបាល', 'សាកលវិទ្យាល័យ', 'និស្សិត'];
        tempWorkplaceSelect = stdWorkplaces.includes(eu.profile_data.workplace) ? eu.profile_data.workplace : (eu.profile_data.workplace ? 'Others' : '');

        newPin = '';
        editingUser = eu;
    }

    $: if (!show) {
        prevUser = null;
        editingUser = null;
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

    async function saveUser() {
        if (!editingUser) return;

        const updates = {
            full_name: editingUser.full_name,
            name_latin: editingUser.name_latin,
            phone_number: editingUser.phone_number,
            gender: editingUser.gender,
            profile_data: {
                position: editingUser.profile_data.position,
                workplace: editingUser.profile_data.workplace,
                province: editingUser.profile_data.province,
                license_status: editingUser.profile_data.license_status,
                license_number: editingUser.profile_data.license_number,
            }
        };

        let error;
        
        if (editingUser.id) {
            if (newPin && newPin.length === 4) {
                const hashedPin = await hashPin(newPin);
                const { error: pinError } = await supabase.rpc('change_pin', { user_id: editingUser.id, new_pin: hashedPin });
                if (pinError) return alert("បរាជ័យក្នុងការប្តូរ PIN: " + pinError.message);
            }
            const res = await supabase.from('users').update(updates).eq('id', editingUser.id);
            error = res.error;
        } else {
            updates.pin_code = await hashPin(newPin && newPin.length === 4 ? newPin : '1234');
            updates.xp = 0;
            updates.role = 'member'; // កំណត់ជាសមាជិកធម្មតាដោយស្វ័យប្រវត្តិពេលបង្កើតថ្មី
            const res = await supabase.from('users').insert(updates);
            error = res.error;
        }

        if (error) {
            alert("បរាជ័យ: " + error.message);
        } else {
            alert(editingUser.id ? "បានកែប្រែជោគជ័យ!" : "បានបង្កើតសមាជិកថ្មីជោគជ័យ!");
            show = false;
            dispatch('saved');
        }
    }
</script>

{#if show && editingUser}
    <div class="modal modal-open bg-black/60" transition:fade={{ duration: 200 }}>
        <div class="modal-box max-w-md" transition:scale={{ start: 0.95, duration: 200 }}>
            <h3 class="font-bold text-lg mb-4" use:draggable>{editingUser.id ? 'កែប្រែព័ត៌មានសមាជិក' : 'បង្កើតសមាជិកថ្មី'}</h3>
            
            <div class="form-control w-full mb-2">
                <label for="um-full-name" class="label"><span class="label-text font-bold">ឈ្មោះ</span></label>
                <input id="um-full-name" bind:value={editingUser.full_name} class="input input-bordered w-full bg-white/50 border border-white/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>

            <div class="form-control w-full mb-2">
                <label for="um-name-latin" class="label"><span class="label-text font-bold">ឈ្មោះ (ឡាតាំង)</span></label>
                <input id="um-name-latin" bind:value={editingUser.name_latin} class="input input-bordered w-full bg-white/50 border border-white/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            
            <div class="form-control w-full mb-2">
                <label for="um-phone" class="label"><span class="label-text font-bold">លេខទូរស័ព្ទ</span></label>
                <input id="um-phone" bind:value={editingUser.phone_number} class="input input-bordered w-full bg-white/50 border border-white/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>

            <div class="form-control w-full mb-2">
                <label for="um-gender" class="label"><span class="label-text font-bold">ភេទ</span></label>
                <select id="um-gender" bind:value={editingUser.gender} class="select select-bordered w-full bg-white/50 border border-white/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"><option value="Male">ប្រុស</option><option value="Female">ស្រី</option></select>
            </div>

            <div class="form-control w-full mb-4">
                <div class="label"><span class="label-text font-bold">{editingUser.id ? 'ប្តូរ PIN ថ្មី (ទុកទទេបើមិនប្តូរ)' : 'កំណត់ PIN (ទុកទទេ = 1234)'}</span></div>
                <div class="flex gap-2">
                    <input bind:value={newPin} type="text" maxlength="4" placeholder="PIN 4 ខ្ទង់" class="input input-bordered w-full font-mono" />
                    {#if editingUser.id}
                        <button class="btn btn-warning btn-outline" on:click={() => newPin = '1234'} title="កំណត់ទៅលេខដើម 1234 វិញ">🔄 1234</button>
                    {/if}
                </div>
            </div>

            <div class="divider text-xs">ព័ត៌មានប្រវត្តិរូប</div>
            <div class="form-control w-full mb-2"><label for="um-position" class="label"><span class="label-text font-bold">មុខតំណែង / កម្រិតជំនាញ (Position / Qualification)</span></label><select id="um-position" bind:value={tempPositionSelect} on:change={() => { if (tempPositionSelect !== 'Others') editingUser.profile_data.position = tempPositionSelect; else if (['Prof./Associate Prof./Assistant Prof.', 'Lecturer', 'Nurse', 'Midwife', 'Ophthalmic Nurse', 'Nurse Anesthetist', 'Dental Nurse', 'Nursing/Midwife Student'].includes(editingUser.profile_data.position)) editingUser.profile_data.position = ''; }} class="select select-bordered w-full"><option value="" disabled selected>សូមជ្រើសរើស</option><option value="Prof./Associate Prof./Assistant Prof.">សាស្ត្រាចារ្យ/សហសាស្ត្រាចារ្យ/សាស្ត្រាចារ្យជំនួយ</option><option value="Lecturer">គ្រូបង្រៀន (Lecturer)</option><option value="Nurse">គិលានុបដ្ឋាក (Nurse)</option><option value="Midwife">ឆ្មប (Midwife)</option><option value="Ophthalmic Nurse">ចក្ខុគិលានុបដ្ឋាក (Ophthalmic Nurse)</option><option value="Nurse Anesthetist">គិលានុបដ្ឋាកឯកទេសសណ្តំ (Nurse Anesthetist)</option><option value="Dental Nurse">ទន្តគិលានុបដ្ឋាក (Dental Nurse)</option><option value="Nursing/Midwife Student">និស្សិតគិលានុបដ្ឋាក/ឆ្មប</option><option value="Others">ផ្សេងៗ (Others)</option></select>{#if tempPositionSelect === 'Others'}<input bind:value={editingUser.profile_data.position} class="input input-bordered w-full mt-2" placeholder="សូមបញ្ជាក់មុខតំណែង / កម្រិតជំនាញ..." />{/if}</div>
            <div class="form-control w-full mb-2"><label for="um-workplace" class="label"><span class="label-text font-bold">ទីកន្លែងធ្វើការ (Workplace)</span></label><select id="um-workplace" bind:value={tempWorkplaceSelect} on:change={() => { if (tempWorkplaceSelect !== 'Others') editingUser.profile_data.workplace = tempWorkplaceSelect; else if (['ក្រសួងសុខាភិបាល', 'មន្ទីរសុខាភិបាល/OD', 'មន្ទីរពេទ្យរដ្ឋ', 'មន្ទីរពេទ្យឯកជន', 'អង្គការក្រៅរដ្ឋាភិបាល', 'សាកលវិទ្យាល័យ', 'និស្សិត'].includes(editingUser.profile_data.workplace)) editingUser.profile_data.workplace = ''; }} class="select select-bordered w-full"><option value="" disabled selected>សូមជ្រើសរើស</option><option value="ក្រសួងសុខាភិបាល">ក្រសួងសុខាភិបាល</option><option value="មន្ទីរសុខាភិបាល/OD">មន្ទីរសុខាភិបាល/OD</option><option value="មន្ទីរពេទ្យរដ្ឋ">មន្ទីរពេទ្យរដ្ឋ</option><option value="មន្ទីរពេទ្យឯកជន">មន្ទីរពេទ្យឯកជន</option><option value="អង្គការក្រៅរដ្ឋាភិបាល">អង្គការក្រៅរដ្ឋាភិបាល (NGO)</option><option value="សាកលវិទ្យាល័យ">សាកលវិទ្យាល័យ</option><option value="និស្សិត">និស្សិត</option><option value="Others">ផ្សេងៗ</option></select></div>
            <div class="form-control w-full mb-2"><label for="um-province" class="label"><span class="label-text font-bold">រាជធានី/ខេត្ត</span></label><select id="um-province" bind:value={editingUser.profile_data.province} class="select select-bordered w-full"><option value="">-- មិនបានបញ្ជាក់ --</option><option>រាជធានីភ្នំពេញ</option><option>ខេត្តបន្ទាយមានជ័យ</option><option>ខេត្តបាត់ដំបង</option><option>ខេត្តកំពង់ចាម</option><option>ខេត្តកំពង់ឆ្នាំង</option><option>ខេត្តកំពង់ស្ពឺ</option><option>ខេត្តកំពង់ធំ</option><option>ខេត្តកំពត</option><option>ខេត្តកណ្ដាល</option><option>ខេត្តកែប</option><option>ខេត្តកោះកុង</option><option>ខេត្តក្រចេះ</option><option>ខេត្តមណ្ឌលគីរី</option><option>ខេត្តឧត្ដរមានជ័យ</option><option>ខេត្តប៉ៃលិន</option><option>ខេត្តព្រះសីហនុ</option><option>ខេត្តព្រះវិហារ</option><option>ខេត្តព្រៃវែង</option><option>ខេត្តពោធិ៍សាត់</option><option>ខេត្តរតនគិរី</option><option>ខេត្តសៀមរាប</option><option>ខេត្តស្ទឹងត្រែង</option><option>ខេត្តស្វាយរៀង</option><option>ខេត្តតាកែវ</option><option>ខេត្តត្បូងឃ្មុំ</option></select></div>
            <div class="grid grid-cols-2 gap-2 mb-2">
                <div class="form-control w-full"><label for="um-license-status" class="label"><span class="label-text font-bold">ស្ថានភាពអាជ្ញាប័ណ្ណ</span></label><select id="um-license-status" bind:value={editingUser.profile_data.license_status} class="select select-bordered w-full"><option value="">-- មិនបានបញ្ជាក់ --</option><option value="មាន">មាន</option><option value="មិនមាន">មិនមាន</option><option value="មានតែហួសសុពលភាព">មានតែហួសសុពលភាព</option><option value="កំពុងបន្ដ">កំពុងបន្ដ</option></select></div>
                <div class="form-control w-full"><label for="um-license-number" class="label"><span class="label-text font-bold">លេខអាជ្ញាប័ណ្ណ</span></label><input id="um-license-number" bind:value={editingUser.profile_data.license_number} class="input input-bordered w-full" placeholder="CCN-LP-XXXX" disabled={editingUser.profile_data.license_status !== 'មាន'} /></div>
            </div>
            <div class="modal-action">
                <button class="btn btn-ghost" on:click={() => show = false}>បោះបង់</button>
                <button class="btn btn-primary" on:click={saveUser}>រក្សាទុក</button>
            </div>
        </div>
    </div>
{/if}