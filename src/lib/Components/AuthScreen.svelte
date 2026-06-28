<script>
    import { fade, slide } from 'svelte/transition';
    import { ArrowRightIcon, LogInIcon, UserPlusIcon } from 'lucide-svelte';
    import { createEventDispatcher } from 'svelte';

    export let authStep = 'phone';
    export let tempPhone = '';
    export let loading = false;
    export let errorMsg = '';
    export let currentUser = null;
    export let loginLogoUrl = '';
    export let t; // Translation function
    export let currentLang;
    export let version;
    export let rememberMe = false;
    export let supabase = null;

    const dispatch = createEventDispatcher();

    // Internal state
    let showLoginPin = false;
    let showRegPin = false;
    let pinInputVal = '';
    let localError = '';
    
    // Register form state
    let regName = '';
    let regNameLatin = '';
    let regGender = 'Male';
    let regPin = '';
    let regPosition = '';
    let regPositionOther = '';
    let regWorkplace = '';
    let regWorkplaceOther = '';
    let regLicenseStatus = '';
    let regLicenseNumber = '';
    let regProvince = '';
    let isDuplicateLicense = false;

    function normalizeKhmerNumerals(str) {
        if (!str) return '';
        return str.replace(/[០-៩]/g, d => '0123456789'['០១២៣៤៥៦៧៨៩'.indexOf(d)]);
    }

    function handleCheckPhone() {
        dispatch('checkPhone', { phone: tempPhone });
    }

    function handleLogin() {
        dispatch('login', { pin: pinInputVal });
    }

    async function handleRegister() {
        localError = '';
        isDuplicateLicense = false;
        if (!regName.trim()) { localError = 'សូមបញ្ចូលឈ្មោះពេញ'; return; }
        if (!regNameLatin.trim()) { localError = 'សូមបញ្ចូលឈ្មោះជាអក្សរឡាតាំង'; return; }
        if (!regPosition) { localError = 'សូមជ្រើសរើសមុខតំណែង / កម្រិតជំនាញ'; return; }
        if (regPosition === 'Others' && !regPositionOther.trim()) { localError = 'សូមបញ្ជាក់មុខតំណែង / កម្រិតជំនាញ'; return; }
        if (!regWorkplace) { localError = 'សូមជ្រើសរើសកន្លែងធ្វើការ'; return; }
        // if (regWorkplace === 'Others' && !regWorkplaceOther.trim()) { localError = 'សូមបញ្ជាក់កន្លែងធ្វើការ'; return; }
        if (!regProvince) { localError = 'សូមជ្រើសរើសរាជធានី/ខេត្ត'; return; }
        if (!regLicenseStatus) { localError = 'សូមជ្រើសរើសស្ថានភាពអាជ្ញាប័ណ្ណ'; return; }
        // if (regLicenseStatus === 'មាន' && !regLicenseNumber.trim()) { localError = 'សូមបញ្ចូលលេខអាជ្ញាប័ណ្ណ'; return; }
        if (regPin.length !== 4) { localError = 'លេខកូដសម្ងាត់ត្រូវតែ ៤ ខ្ទង់'; return; }

        // ផ្ទៀងផ្ទាត់កុំឱ្យលេខអាជ្ញាប័ណ្ណស្ទួនគ្នា (Check Duplicate License) មុនពេលបញ្ជូនទិន្នន័យ
        if (regLicenseStatus === 'មាន' && supabase) {
            const lic = regLicenseNumber ? regLicenseNumber.trim() : '';
            if (lic && lic !== 'CCN-LP-') {
                const { data: dupData, error: dupErr } = await supabase
                    .from('users')
                    .select('id')
                    .eq('profile_data->>license_number', lic)
                    .limit(1);
                    
                if (dupErr) { localError = dupErr.message; return; }
                if (dupData && dupData.length > 0) {
                    isDuplicateLicense = true;
                    localError = `លេខអាជ្ញាប័ណ្ណ "${lic}" មានសមាជិកផ្សេងកំពុងប្រើប្រាស់រួចហើយ!`;
                    return;
                }
            }
        }

        dispatch('register', {
            name: regName,
            nameLatin: regNameLatin,
            gender: regGender,
            pin: regPin,
            position: regPosition === 'Others' ? regPositionOther : regPosition,
            workplace: regWorkplace === 'Others' ? 'ផ្សេងៗ' : regWorkplace,
            province: regProvince,
            licenseStatus: regLicenseStatus,
            licenseNumber: (regLicenseStatus === 'មាន' && regLicenseNumber.trim()) ? regLicenseNumber.trim() : ''
        });
    }
</script>

<div class="screen flex flex-col items-center justify-center min-h-screen p-4 bg-base-100 relative overflow-hidden" in:fade={{ duration: 300 }}>
    <!-- Language Switcher -->
    <div class="absolute top-6 right-6 z-50">
        <button class="flex items-center justify-center w-12 h-12 rounded-full bg-white/90 hover:bg-white border border-white/30 shadow-sm transition-transform active:scale-95" on:click={() => dispatch('toggleLanguage')}>
            <img src={currentLang === 'km' ? 'https://flagcdn.com/w40/kh.png' : 'https://flagcdn.com/w40/gb.png'} alt="Language" class="w-8 h-8 object-cover rounded-full shadow-sm" />
        </button>
    </div>

    <!-- Main Card -->
    <div class="card w-full max-w-sm bg-base-100 shadow-2xl relative z-10 overflow-hidden rounded-2xl border border-base-200">
        <div class="card-body items-center text-center p-8 sm:p-10">
            
            <!-- Logo Area -->
            <div class="relative mb-6 group">
                <div class="absolute -inset-1 bg-gradient-to-r from-primary to-secondary rounded-full opacity-20 group-hover:opacity-40 blur transition duration-500"></div>
                <img src={loginLogoUrl || '/logo.png'} alt="Logo" class="relative w-24 h-24 bg-white rounded-full object-cover shadow-sm p-1" />
            </div>
            
            <h1 class="text-2xl font-black text-gray-800 mb-1 tracking-tight">{t('app_title')}</h1>
            <p class="text-sm font-medium text-gray-500 mb-8 uppercase tracking-widest">ការអភិវឌ្ឍវិជ្ជាជីវៈបន្ត</p>

            {#if authStep === 'phone'}
                <div class="w-full space-y-6">
                    <div class="form-control">
                        <label for="phone-number" class="label justify-center pb-1">
                            <span class="label-text font-bold text-gray-700">{t('phone_label')}</span>
                        </label>
                        <input id="phone-number" type="tel" bind:value={tempPhone} on:input={() => tempPhone = normalizeKhmerNumerals(tempPhone)} on:keydown={(e) => e.key === 'Enter' && handleCheckPhone()} class="input input-bordered w-full text-center text-lg h-14 bg-white/50 border-gray-200 focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-2xl transition-colors font-bold tracking-widest placeholder:font-normal placeholder:tracking-normal" placeholder="0XX XXX XXX" />
                    </div>
                    <button on:click={handleCheckPhone} disabled={loading} class="btn btn-primary w-full btn-lg h-14 rounded-2xl text-lg font-bold text-white">
                        {#if loading}<span class="loading loading-spinner"></span>{:else}<ArrowRightIcon class="w-6 h-6 mr-2" />{/if} {t('continue_btn')}
                    </button>
                    <label class="cursor-pointer flex items-center justify-center gap-3 opacity-80 hover:opacity-100 transition-opacity">
                        <input type="checkbox" bind:checked={rememberMe} class="checkbox checkbox-primary checkbox-sm rounded-md" />
                        <span class="label-text text-sm font-medium text-gray-600">ចងចាំខ្ញុំ-remember me</span> 
                    </label>
                </div>
            {:else if authStep === 'login'}
                <div class="w-full">
                    <p class="text-lg text-gray-500 mb-1 font-medium">{t('hello')},</p>
                    <h2 class="text-2xl font-black text-gray-800 mb-8">{currentUser?.full_name}</h2>
                    <div class="relative w-full mb-8 group">
                        {#if showLoginPin}
                            <input type="text" inputmode="numeric" bind:value={pinInputVal} on:input={(e) => { pinInputVal = normalizeKhmerNumerals(e.currentTarget.value).replace(/\D/g, ''); if (pinInputVal.length === 4) handleLogin(); }} on:keydown={(e) => e.key === 'Enter' && handleLogin()} maxlength="4" class="input input-bordered w-full text-center text-3xl tracking-[0.5em] font-bold h-20 text-gray-800 bg-white/50 border-gray-200 focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-2xl pr-12 transition-colors" placeholder="••••" id="pin-input" />
                        {:else}
                            <input type="password" inputmode="numeric" bind:value={pinInputVal} on:input={(e) => { pinInputVal = normalizeKhmerNumerals(e.currentTarget.value).replace(/\D/g, ''); if (pinInputVal.length === 4) handleLogin(); }} on:keydown={(e) => e.key === 'Enter' && handleLogin()} maxlength="4" class="input input-bordered w-full text-center text-3xl tracking-[0.5em] font-bold h-20 text-gray-800 bg-white/50 border-gray-200 focus:border-primary focus:ring-4 focus:ring-primary/10 rounded-2xl pr-12 transition-colors" placeholder="••••" id="pin-input" />
                        {/if}
                        <button class="absolute inset-y-0 right-0 flex items-center px-4 text-gray-400 hover:text-primary transition-colors" on:click={() => showLoginPin = !showLoginPin} type="button" aria-label="បង្ហាញ/លាក់លេខកូដ">
                            {#if showLoginPin}👁️{:else}🙈{/if}
                        </button>
                    </div>
                    <button on:click={handleLogin} disabled={loading || pinInputVal.length !== 4} class="btn btn-primary w-full btn-lg text-xl">
                        {#if loading}<span class="loading loading-spinner"></span>{:else}<LogInIcon class="w-6 h-6 mr-2" />{/if} {t('login_btn')}
                    </button>
                    <div class="flex flex-col items-center mt-8 gap-4">
                        <button on:click={() => dispatch('forgotPin')} class="btn btn-ghost btn-sm text-gray-500 font-normal hover:bg-transparent hover:text-primary hover:underline">ភ្លេចលេខកូដ?</button>
                        <button on:click={() => dispatch('reset')} class="btn btn-ghost btn-sm text-gray-400 font-normal hover:bg-transparent hover:text-gray-600">← ត្រឡប់ក្រោយ</button>
                    </div>
                </div>
            {:else if authStep === 'register'}
                <div class="w-full space-y-4">
                    <h2 class="text-2xl font-black mb-6 text-gray-800">ចុះឈ្មោះសមាជិកថ្មី</h2>
                    <input bind:value={regName} class="input input-bordered w-full h-12 bg-white/50 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10" placeholder="ឈ្មោះពេញជាភាសាខ្មែរ" />
                    <input bind:value={regNameLatin} class="input input-bordered w-full h-12 bg-white/50 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10" placeholder="ឈ្មោះជាអក្សរឡាតាំង (Latin Name)" />
                    <select bind:value={regGender} class="select select-bordered w-full h-12 bg-white/50 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10">
                        <option value="Male">ប្រុស</option>
                        <option value="Female">ស្រី</option>
                    </select>
                    <select bind:value={regPosition} class="select select-bordered w-full h-12 bg-white/50 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10">
                        <option value="" disabled selected>មុខតំណែង / កម្រិតជំនាញ (Position / Qualification)</option>
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
                    {#if regPosition === 'Others'}<input bind:value={regPositionOther} class="input input-bordered w-full h-12 bg-white/50 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 mt-2" placeholder="សូមបញ្ជាក់មុខតំណែង / កម្រិតជំនាញ..." />{/if}
                    <select bind:value={regWorkplace} class="select select-bordered w-full h-12 bg-white/50 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 mt-2">
                        <option value="" disabled selected>បច្ចុប្បន្នបំរើការ (Current Workplace)</option>
                        <option value="ក្រសួងសុខាភិបាល">ក្រសួងសុខាភិបាល</option>
                        <option value="មន្ទីរសុខាភិបាល/OD">មន្ទីរសុខាភិបាល/OD</option>
                        <option value="មន្ទីរពេទ្យរដ្ឋ">មន្ទីរពេទ្យរដ្ឋ</option>
                        <option value="មន្ទីរពេទ្យឯកជន">មន្ទីរពេទ្យឯកជន</option>
                        <option value="អង្គការក្រៅរដ្ឋាភិបាល">អង្គការក្រៅរដ្ឋាភិបាល (NGO)</option>
                        <option value="សាកលវិទ្យាល័យ">សាកលវិទ្យាល័យ</option>
                        <option value="និស្សិត">និស្សិត</option>
                        <option value="Others">ផ្សេងៗ</option>
                    </select>
                   <!--{#if regWorkplace === 'Others'}<input bind:value={regWorkplaceOther} class="input input-bordered w-full h-12 bg-white/50 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 mt-2" placeholder="សូមបញ្ជាក់កន្លែងធ្វើការ..." />{/if}-->
                    <select bind:value={regProvince} class="select select-bordered w-full h-12 bg-white/50 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 mt-2">
                        <option value="" disabled selected>រាជធានី/ខេត្ត</option>
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
                    <select bind:value={regLicenseStatus} on:change={() => { if (regLicenseStatus === 'មាន' && !regLicenseNumber) regLicenseNumber = 'CCN-LP-'; }} class="select select-bordered w-full h-12 bg-white/50 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 mt-2">
                        <option value="" disabled selected>មានអាជ្ញាប័ណ្ណអនុវត្តវិជ្ជាជីវៈ?</option>
                        <option value="មាន">មាន</option>
                        <option value="មិនមាន">មិនមាន</option>
                        <option value="មានតែហួសសុពលភាព">មានតែហួសសុពលភាព</option>
                        <option value="កំពុងបន្ដ">កំពុងបន្ដ</option>
                    </select>
                    {#if regLicenseStatus === 'មាន'}
                        <input bind:value={regLicenseNumber} on:input={() => { regLicenseNumber = normalizeKhmerNumerals(regLicenseNumber); isDuplicateLicense = false; localError = ''; }} class="input input-bordered w-full h-12 transition-colors {isDuplicateLicense ? 'border-error bg-error/10 text-error' : 'bg-white/50 border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/10'} mt-2" placeholder="ឧ. CCN-LP-XXXX (អាចបំពេញពេលក្រោយ បើមិនចាំលេខ)" />
                    {/if}
                    <div class="relative w-full">
                        {#if showRegPin}
                            <input bind:value={regPin} on:input={() => regPin = normalizeKhmerNumerals(regPin).replace(/\D/g, '')} on:keydown={(e) => e.key === 'Enter' && handleRegister()} type="text" inputmode="numeric" maxlength="4" aria-label="លេខកូដសម្ងាត់" class="input input-bordered w-full text-center font-bold text-lg h-12 tracking-widest bg-white/50 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 pr-12 placeholder:text-xs placeholder:font-normal placeholder:tracking-normal" placeholder="សូមបង្តើតលេខកូដសម្ងាត់ (៤ខ្ទង់)" />
                        {:else}
                            <input bind:value={regPin} on:input={() => regPin = normalizeKhmerNumerals(regPin).replace(/\D/g, '')} on:keydown={(e) => e.key === 'Enter' && handleRegister()} type="password" inputmode="numeric" maxlength="4" aria-label="លេខកូដសម្ងាត់" class="input input-bordered w-full text-center font-bold text-lg h-12 tracking-widest bg-white/50 border-gray-200 rounded-xl focus:border-primary focus:ring-2 focus:ring-primary/10 pr-12 placeholder:text-xs placeholder:font-normal placeholder:tracking-normal" placeholder="សូមបង្តើតលេខកូដសម្ងាត់ (៤ខ្ទង់)" />
                        {/if}
                        <button class="absolute inset-y-0 right-0 flex items-center px-4 text-gray-400 hover:text-primary transition-colors" on:click={() => showRegPin = !showRegPin} type="button" aria-label="បង្ហាញ/លាក់លេខកូដ">
                            {#if showRegPin}👁️{:else}🙈{/if}
                        </button>
                    </div>
                    {#if localError}<p class="text-error text-sm font-medium text-left mt-1">{localError}</p>{/if}
                    <div class="pt-2"><button on:click={handleRegister} disabled={loading} class="btn btn-primary w-full btn-lg h-14 rounded-2xl text-lg font-bold text-white">{#if loading}<span class="loading loading-spinner"></span>{:else}<UserPlusIcon class="w-6 h-6 mr-2" />{/if} ចុះឈ្មោះ</button></div>
                    <button on:click={() => dispatch('reset')} class="btn btn-ghost w-full text-gray-500 font-normal hover:bg-transparent hover:text-gray-700">ត្រឡប់ក្រោយ</button>
                </div>
            {/if}
        </div>
    </div>
    {#if errorMsg}
        <div class="toast toast-top toast-center z-50">
            <div class="alert alert-error shadow-lg rounded-xl border-none text-white">
                <span>{errorMsg}</span>
            </div>
        </div>
    {/if}
    <div class="mt-8 text-xs text-gray-400 font-medium relative z-10 flex flex-col items-center gap-1">
        <span>Powered by CCN</span>
        <span class="opacity-60">v{version}</span>
    </div>
</div>