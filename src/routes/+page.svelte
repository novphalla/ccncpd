<script>
    import { onMount, tick, onDestroy } from 'svelte';
    import { fade, fly, slide } from 'svelte/transition';
    import { createQuery, useQueryClient } from '@tanstack/svelte-query';
    import { ArrowDownIcon, ArrowRightIcon, LogInIcon, UserPlusIcon, LogOutIcon } from 'lucide-svelte';
    import QuizView from '$lib/Components/QuizView.svelte';
    import HomeScreen from '$lib/Components/HomeScreen.svelte';
    import ReviewView from '$lib/Components/ReviewView.svelte';
    import { compressImage, handleUpload, hashPin, normalizeKhmerNumerals } from '$lib/utils';
    import { drawCertificate } from '$lib/certificate.js';
    import AuthScreen from '$lib/Components/AuthScreen.svelte';
    import ProfileModal from '$lib/Components/ProfileModal.svelte';
    import CustomFormViewer from '$lib/Components/CustomFormViewer.svelte';
    import StatsModal from '$lib/Components/admin/StatsModal.svelte';
    import ShareModal from '$lib/Components/admin/ShareModal.svelte';
    import ForgotPinModal from '$lib/Components/admin/ForgotPinModal.svelte';
    import CertificatePreviewModal from '$lib/Components/admin/CertificatePreviewModal.svelte';
    import WelcomeModal from '$lib/Components/admin/WelcomeModal.svelte';
    import { supabase } from '$lib/supabaseClient';
    import { pushState, replaceState } from '$app/navigation';
    
    // @ts-ignore
    export let params = undefined; // SvelteKit router passes this during hydration
    $: void params;              // mark as used to silence unused-export warning
    // @ts-ignore
    const version = '1.0.1';

    // --- CONFIG ---
    
    const queryClient = useQueryClient();

    // --- APP STATE ---
    let currentScreen = 'auth'; // auth, home, lesson, quiz, cert, review, admin, ai
    let authStep = 'phone'; // phone, login, register
    let code = '';
    let loading = false;
    let sessionChecked = false;
    let adminTab = 'dashboard';
    let AdminDashboard; // សម្រាប់ Lazy Load
    let LessonPlayerComponent; // សម្រាប់ Lazy Load
    let CertificateGeneratorComponent; // សម្រាប់ Lazy Load
    let result = null;
    let errorMsg = '';
    let currentUser = null;
    let tempPhone = '';
    let isNewUser = false;
    let showNewUserWelcomeModal = false;
    let pendingQuizCourse = null;
    let isOffline = false;
    let successToastMsg = '';
    
    // --- DATA STORES ---
    let meetings = [];
    let registeredMeetingIds = [];
    let userQuizAttempts = []; // Store all attempts to calculate cooldowns
    let courseCooldowns = {}; // { courseId: timestamp_end }
    
    // --- UI STATE ---
    let showUpcomingMeetingsOnly = false;
    
    // --- QUIZ STATE ---
    let activeCourseId = null;
    let activeQuizType = 'post';
    let quizKey = 0;
    let userAnswers = [];
    let passedCourses = []; // IDs of passed courses
    let preTestDoneCourses = []; // IDs of courses where pre-test is done
    let postTestAttemptedCourses = []; // IDs of courses where post-test is attempted
    let evaluationCompletedCourses = []; // IDs of courses where evaluation form is submitted
    let evaluationFromCourseId = null;  // Track which course opened the evaluation form
    $: evalDismissedCourses = currentUser?.profile_data?.eval_dismissed || [];
    let quizData = {}; // Store questions per course
    
    let totalUsers = 0;
    let showProfileModal = false;
    let forceProfileComplete = false; // true = old member missing profile data
    let missingProfileMsg = '';

    function isProfileComplete(user) {
        if (!user) return false;
        const pd = user.profile_data || {};
        
        const missing = [];
        if (!user.full_name?.trim()) missing.push('ឈ្មោះពេញ');
        if (!pd.position) missing.push('តួនាទី');
        if (!pd.workplace) missing.push('កន្លែងធ្វើការ');
        if (!pd.province) missing.push('រាជធានី/ខេត្ត');
        if (!pd.license_status) missing.push('ស្ថានភាពអាជ្ញាប័ណ្ណ');
        
        if (missing.length > 0) {
            missingProfileMsg = missing.join(', ');
            return false;
        }
        return true;
    }
    let loginLogoUrl = '';
    let faviconUrl = '';
    let primaryColor = '';
    let borderRadius = '0.5rem';
    let rememberMe = false;
    let showCPDPoints = false;
    let isUploading = false;
    let showShareModal = false;
    let activeShareUrl = '';
    let activeShareTitle = 'ស្កេនដើម្បីចូល';
    let activeShareText = 'ចូលរៀនវគ្គបណ្តុះបណ្តាលតាមរយៈកម្មវិធីនេះ!';
    let showForgotPinModal = false;
    let showLoginPin = false;
    let selectedMeeting = null;
    let showCertificateModal = false;
    let previewCertificateUrl = '';
    let activeCertificateCourse = null;
    let isMaintenanceMode = false;
    let activeFormId = null;
    let profileFormId = null;
    let assistantTelegram = 'https://t.me/DigitalKCN'; // តម្លៃដើម
    let tutorials = [];
    let evaluationFormUrl = '';
    
    let activeCourseLessons = [];
    let activeCourseForPlayer = null;
    let activeLessonForPlayer = null;

    // Reset scroll position when screen changes
    $: if (currentScreen && typeof window !== 'undefined') {
        window.scrollTo(0, 0);
    }

    // --- STATS & CROPPER ---
    let showStatsModal = false;

    function toPublicUser(user) {
        if (!user) return null;
        const { pin_code, ...safeUser } = user;
        return safeUser;
    }

    function base64ToUint8Array(base64) {
        const padding = '='.repeat((4 - (base64.length % 4)) % 4);
        const safeBase64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = atob(safeBase64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
        return outputArray;
    }

    async function restoreSession() {
        loading = true;

        // ប្រើប្រាស់ Supabase Auth ជំនួសអោយ localStorage ទទេ (Option 1)
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        let targetUserId = session?.user?.id;

        // Fallback សម្រាប់អ្នកប្រើប្រាស់ចាស់ ដែលមិនទាន់មាន Session Auth
        if (!targetUserId) {
            targetUserId = localStorage.getItem('sessionUserId');
        }

        if (targetUserId) {
            const { data: userProfile, error: profileError } = await supabase
                .from('users')
                .select('id, phone_number, full_name, name_latin, gender, avatar_url, role, xp, created_at, cpd_total, profile_data')
                .eq('id', targetUserId)
                .maybeSingle();

            if (!profileError && userProfile) {
                currentUser = userProfile;
                await finalizeLogin();
                loading = false;
                sessionChecked = true;
                return;
            }
            // Stale/invalid session — clean up
            localStorage.removeItem('sessionUserId');
            await supabase.auth.signOut();
        }

        loading = false;
        sessionChecked = true;
        checkPublicFormAccess();
    }

    async function checkPublicFormAccess() {
        const params = new URLSearchParams(window.location.search);
        const formId = params.get('form_id');
        if (formId) {
            loading = true;
            // ពិនិត្យមើលថាតើ Form នេះអនុញ្ញាតឱ្យចូលដោយមិន Login ដែរឬទេ
            const { data } = await supabase.from('custom_forms').select('is_public_access').eq('id', formId).maybeSingle();
            
            if (data && data.is_public_access) {
                loadCustomForm(formId);
            }
            loading = false;
        }
    }

    // Maintenance Mode Check: បើបើក Update Mode ហើយមិនមែនជា Admin/Owner ទេ នោះប្តូរទៅផ្ទាំង Maintenance
    $: if (currentUser && isMaintenanceMode && currentUser.role !== 'admin' && currentUser.role !== 'owner') {
        currentScreen = 'maintenance';
    }

    onMount(async () => {
        const saved = localStorage.getItem('savedPhone');
        if (saved) {
            tempPhone = saved;
            rememberMe = true;
        }

        document.documentElement.setAttribute('data-theme', 'light');

        if (typeof navigator !== 'undefined') {
            isOffline = !navigator.onLine;
            window.addEventListener('online', handleOnline);
            window.addEventListener('offline', handleOffline);
        }

        // Restore session if exists (ទាញយកទិន្នន័យអ្នកប្រើប្រាស់មកវិញ បើមាន)
        await restoreSession();

        // Service Worker ត្រូវបានគ្រប់គ្រងដោយ Vite PWA Plugin ដោយស្វ័យប្រវត្តិ
        // មិនចាំបាច់ Register ដោយដៃនៅទីនេះទេ

        // Handle Back Button (ដោះស្រាយបញ្ហាចុច Back លើទូរស័ព្ទ)
        window.addEventListener('popstate', handlePopState);

        loadSystemSettings();

        document.addEventListener('visibilitychange', handleVisibilityChange);
    });

    onDestroy(() => {
        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('popstate', handlePopState);
        }
    });

    function handleVisibilityChange() {
        if (!document.hidden) {
            // Refresh data when app becomes visible again
            loadSystemSettings(); // ពិនិត្យមើលការកំណត់ Update Mode ពេលបើកកម្មវិធីមកវិញ
            loadHomeData();
            queryClient.invalidateQueries({ queryKey: ['courses'] });
        }
    }

    // --- HELPER សម្រាប់បកប្រែ Error ---
    function translateSupabaseError(msg) {
        if (!msg) return "មានបញ្ហាមិនស្គាល់មួយបានកើតឡើង";
        const m = msg.toLowerCase();
        if (m.includes("email signups are disabled")) return "ប្រព័ន្ធមិនទាន់បើកឱ្យចុះឈ្មោះទេ។ សូមទាក់ទងអ្នកគ្រប់គ្រងដើម្បីបើក Email Provider ក្នុង Supabase។";
        if (m.includes("user already registered")) return "លេខទូរស័ព្ទនេះត្រូវបានចុះឈ្មោះរួចហើយ! សូមត្រឡប់ក្រោយហើយចូលប្រព័ន្ធ (Login) វិញ។";
        if (m.includes("invalid login credentials")) return "លេខទូរស័ព្ទ ឬលេខកូដមិនត្រឹមត្រូវ។";
        if (m.includes("fetch") || m.includes("network")) return "មានបញ្ហាបណ្ដាញអ៊ីនធឺណិត។ សូមពិនិត្យមើលការតភ្ជាប់របស់អ្នក។";
        if (m.includes("duplicate key value")) return "ទិន្នន័យនេះមានរួចហើយនៅក្នុងប្រព័ន្ធ។";
        if (m.includes("rate limit")) return "អ្នកបានព្យាយាមច្រើនដងពេកហើយ។ សូមរង់ចាំបន្តិចសិន រួចសាកល្បងម្ដងទៀត។";
        if (m.includes("database error saving new user")) return "មានបញ្ហានៅក្នុង Database (Trigger Error)។ សូមចូលទៅលុប Trigger ចេញពី Supabase។";
        return msg; // បង្ហាញភាសាអង់គ្លេសដដែលបើមិនមានក្នុងបញ្ជី
    }

    // --- I18N ---
    let currentLang = 'km';
    const translations = {
        km: {
            app_title: "CCN-CPD",
            phone_label: "សូមបញ្ចូលលេខទូរស័ព្ទ",
            continue_btn: "សូមចុចបន្ត",
            login_btn: "ចូលប្រព័ន្ធ",
            hello: "ជំរាបសួរ",
            admin_dashboard: "🛡️ ផ្ទាំងគ្រប់គ្រង",
            courses_meetings: "វគ្គសិក្សា និង ការប្រជុំ",
            start_lesson: "📖 ចូលរៀន (អានឯកសារ)",
            start_quiz_btn: "ចាប់ផ្តើមធ្វើតេស្ត",
            next: "បន្ទាប់ →",
            submit_quiz: "បញ្ជូនចម្លើយ",
            retry: "ព្យាយាមម្តងទៀត",
            download_png: "ទាញយក (PNG)",
            send_telegram: "ចែករំលែក",
            ai_assistant: "ជំនួយការ អេអាយ",
            install_app: "ដំឡើងកម្មវិធី",
            easier_to_use: "ប្រើប្រាស់ងាយស្រួលជាងមុន",
            install: "ដំឡើង",
            upcoming_meetings: "📅 ការអភិវឌ្ឍវិជ្ជាជីវៈបន្ត ជិតមកដល់...",
            join_meeting: "🎥 ចូលរួម (Join)",
            register: "📝 បំពេញពត៌មានមុនពេលចូលរួម",
            featured_courses: "📚 វគ្គសិក្សាសំខាន់ៗ",
            view_all: "មើលវគ្គទាំងអស់",
            all_courses: "វគ្គសិក្សាទាំងអស់",
            search_placeholder: "ស្វែងរកមេរៀន...",
            draft: "Draft",
            completed: "✅ បានបញ្ចប់",
            duration_not_set: "មិនកំណត់",
            no_description: "គ្មានការពិពណ៌នា",
            take_pre_test: "📝 ធ្វើតេស្តមុនវគ្គ (Pre-test)",
            locked_pre_test: "🔒 ចូលរៀន (សូមធ្វើតេស្តសិន)",
            lessons_disabled: "🔒 មេរៀនត្រូវបានបិទ",
            passed: "✅ ធ្វើតេស្តជាប់ហើយ",
            get_certificate: "📜 ទទួលលិខិតបញ្ជាក់ការចូលរួម",
            closed: "🚫 តេស្តក្រោយវគ្គបានបិទ",
            post_test_wait: "⏳ រង់ចាំតេស្តក្រោយវគ្គ",
            take_post_test: "📝 ធ្វើតេស្តក្រោយវគ្គ",
            no_courses_found: "រកមិនឃើញវគ្គសិក្សា",
            show_all: "បង្ហាញទាំងអស់វិញ"
        },
        en: {
            app_title: "CCN-CPD",
            phone_label: "Enter Phone Number",
            continue_btn: "Continue",
            login_btn: "Login",
            hello: "Hello",
            admin_dashboard: "🛡️ Dashboard",
            courses_meetings: "Courses & Meetings",
            start_lesson: "📖 Start Lesson",
            start_quiz_btn: "Start Quiz",
            next: "Next →",
            submit_quiz: "Submit",
            retry: "Retry",
            download_png: "Download (PNG)",
            send_telegram: "Share",
            ai_assistant: "AI Assistant",
            install_app: "Install App",
            easier_to_use: "Easier to use",
            install: "Install",
            upcoming_meetings: "📅 Upcoming Meetings",
            join_meeting: "🎥 Join",
            register: "📝 Register",
            featured_courses: "📚 Featured Courses",
            view_all: "View All",
            all_courses: "All Courses",
            search_placeholder: "Search courses...",
            draft: "Draft",
            completed: "✅ Completed",
            duration_not_set: "Not set",
            no_description: "No description",
            take_pre_test: "📝 Take Pre-test",
            locked_pre_test: "🔒 Start Lesson (Take test first)",
            lessons_disabled: "🔒 Lessons Disabled",
            passed: "✅ Passed",
            get_certificate: "📜 Get Certificate",
            closed: "🚫 Closed Post-test",
            post_test_wait: "⏳ Post-test",
            take_post_test: "📝 Take Post-test",
            no_courses_found: "No courses found",
            show_all: "Show All"
        }
    };
    
    $: t = (key) => translations[currentLang][key] || key;

    function toggleLanguage() {
        if (currentLang === 'km') currentLang = 'en';
        else currentLang = 'km';
    }

    // --- AUTH LOGIC ---
    async function checkPhoneNumber() {
        
        // Clean input (remove spaces, dashes)
        const cleanPhone = normalizeKhmerNumerals(tempPhone).replace(/[^0-9]/g, '');
        
        if (!cleanPhone) return errorMsg = "សូមបញ្ចូលលេខទូរស័ព្ទ!";
        if (cleanPhone.length < 9 || cleanPhone.length > 10) return errorMsg = "លេខទូរស័ព្ទមិនត្រឹមត្រូវ (ត្រូវមាន ៩ ឬ ១០ ខ្ទង់)";
        if (!cleanPhone.startsWith('0')) return errorMsg = "លេខទូរស័ព្ទត្រូវផ្តើមដោយលេខ 0";

        tempPhone = cleanPhone; // Update with cleaned number

        loading = true; errorMsg = '';
        
        // Safety timeout (15s) - ការពារកុំឱ្យវិលមិនឈប់
        const timer = setTimeout(() => {
            if (loading) {
                loading = false;
                errorMsg = "ការតភ្ជាប់ចំណាយពេលយូរពេក សូមព្យាយាមម្តងទៀត";
            }
        }, 15000);

        try {
            // ប្រើ maybeSingle() ជំនួស single() ដើម្បីកុំឱ្យចេញ Error 406 ពេលរកមិនឃើញ User
            const { data, error } = await supabase.from('users').select('id, phone_number, full_name, name_latin, gender, avatar_url, role, xp, created_at, cpd_total, profile_data').eq('phone_number', tempPhone).maybeSingle();
            
            clearTimeout(timer); // បោះបង់ timeout ពេលទទួលបានចម្លើយ
            if (error) throw error;

            if (data) {
                currentUser = data;
                authStep = 'login';
                await tick();
                document.getElementById('pin-input')?.focus();
        } else { // User not found
                authStep = 'register';
            // The registration form state is now managed inside AuthScreen.svelte
            // No need to reset variables here.
            }
        } catch (e) {
            clearTimeout(timer);
            console.error("Login Error:", e);
            errorMsg = "បញ្ហាការតភ្ជាប់: " + translateSupabaseError(e.message);
        } finally {
            loading = false;
        }
    }

    async function loginWithPin(pin) {
        if (!pin || pin.length !== 4) return errorMsg = "សូមបញ្ចូលលេខកូដ ៤ខ្ទង់";
        
        loading = true;
        try {
            const normalizedPin = normalizeKhmerNumerals(pin).trim();
            
            const email = `${currentUser.phone_number}@ccn.local`;
            const password = `${normalizedPin}-ccn`;

            // សាកល្បង Login តាមរយៈ Supabase Auth (Secure JWT)
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            let isValid = !authError;

            // បើ Login តាម Auth បរាជ័យ (អាចមកពីគណនីចាស់មិនទាន់មានក្នុង auth.users) យើង Fallback ទៅប្រើ RPC
            if (authError) {
                const hashedPin = await hashPin(normalizedPin);
                const res = await supabase.rpc('verify_pin', {
                    user_id: currentUser.id,
                    pin_hash: hashedPin,
                    pin_plain: normalizedPin
                });
                isValid = res.data;
            }

            if (isValid) {
                if (rememberMe) localStorage.setItem('savedPhone', currentUser.phone_number);
                else localStorage.removeItem('savedPhone');
                localStorage.setItem('sessionUserId', currentUser.id);
                await finalizeLogin();
            } else {
                errorMsg = "លេខកូដមិនត្រឹមត្រូវ!";
                
                // Vibrate device
                if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(200);
                
                // Shake animation
                const input = document.getElementById('pin-input');
                if (input) {
                    input.classList.add('shake');
                    setTimeout(() => input.classList.remove('shake'), 300);
                }
            }
        } catch (e) {
            console.error("Login Error:", e);
            errorMsg = translateSupabaseError(e.message);
        } finally {
            loading = false;
        }
    }

    function forgotPin() {
        showForgotPinModal = true;
    }

    function closeCustomForm() {
        evaluationFromCourseId = null;
        selectedMeeting = null;
        activeFormId = null;
        currentScreen = currentUser ? 'home' : 'auth';
    }

    function openEvaluationForm(course) {
        evaluationFromCourseId = course.id;
        loadCustomForm(course.evaluation_form_id);
    }

    function loadCustomForm(id) {
        activeFormId = id;
        currentScreen = 'custom_form';
        pushState('#form', { screen: 'custom_form' });
    }

    async function dismissEvalCourse(courseId) {
        if (!currentUser) return;
        const existing = currentUser.profile_data?.eval_dismissed || [];
        if (existing.includes(String(courseId))) return;
        const updated = [...existing, String(courseId)];
        currentUser = { ...currentUser, profile_data: { ...currentUser.profile_data, eval_dismissed: updated } };
        await supabase.from('users').update({ profile_data: { ...currentUser.profile_data } }).eq('id', currentUser.id);
    }

    async function registerUser(detail) {
        const { name, nameLatin, gender, pin, position, workplace, province, licenseStatus, licenseNumber } = detail;

        if (!position) return errorMsg = "សូមជ្រើសរើសតួនាទីរបស់អ្នក";
        if (!workplace) return errorMsg = "សូមជ្រើសរើសកន្លែងបំពេញការងារបច្ចុប្បន្ន";
        if (!name || pin.length !== 4) return errorMsg = "សូមបំពេញព័ត៌មានឱ្យបានត្រឹមត្រូវ";

        loading = true;
        
        // Safety timeout
        const timer = setTimeout(() => {
            if (loading) {
                loading = false;
                errorMsg = "ការតភ្ជាប់ចំណាយពេលយូរពេក សូមព្យាយាមម្តងទៀត";
            }
        }, 15000);

        try {
            if (licenseStatus === 'មាន' && licenseNumber) {
                const { data: existingLicense } = await supabase
                    .from('users')
                    .select('id')
                    .eq('profile_data->>license_number', licenseNumber)
                    .maybeSingle();
                if (existingLicense) {
                    clearTimeout(timer);
                    loading = false;
                    errorMsg = 'លេខអាជ្ញាប័ណ្ណ ' + licenseNumber + ' ត្រូវបានប្រើប្រាស់រួចហើយ';
                    return;
                }
            }

            const email = `${tempPhone}@ccn.local`;
            const password = `${pin}-ccn`;

            // ១. បង្កើតគណនីក្នុង Supabase Auth
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password
            });

            if (authError) throw authError;

            const authUserId = authData.user?.id;
            const hashedPin = await hashPin(pin); // នៅតែរក្សាទុកដើម្បី Fallback

            // ២. បញ្ចូលទិន្នន័យទៅតារាង users ដោយប្រើ ID ពី Auth
            const { data, error } = await supabase.from('users').insert([{
                id: authUserId, // ចងភ្ជាប់ ID ពី Auth
                phone_number: tempPhone, full_name: name, name_latin: nameLatin, gender, pin_code: hashedPin, role: 'member', 
                profile_data: {
                    position: position,
                    workplace: workplace,
                    province: province,
                    license_status: licenseStatus,
                    license_number: licenseNumber
                }
            }]).select('id, phone_number, full_name, name_latin, gender, avatar_url, role, xp, created_at, cpd_total, profile_data').single();
            
            clearTimeout(timer);
            if (error) throw error;
            currentUser = data;
            localStorage.setItem('sessionUserId', data.id);
            isNewUser = true;
            await finalizeLogin();
        } catch (e) {
            clearTimeout(timer);
            errorMsg = "ការចុះឈ្មោះបរាជ័យ: " + translateSupabaseError(e.message);
        } finally {
            loading = false;
        }
    }

    async function finalizeLogin() {
        // This function is called after a successful login or session restoration.
        // We no longer need to manually set localStorage. Supabase handles the session.
        // The `toPublicUser` function is good practice if you were passing the full user object to child components.
        // currentUser = toPublicUser(currentUser); // You can keep this if needed
        await loadHomeData(); // Load data BEFORE showing home screen
        currentScreen = 'home';

        // Force old/incomplete profiles to fill in required info
        if (!isProfileComplete(currentUser)) {
            forceProfileComplete = true;
            showProfileModal = true;
            return; // stop deep-link handling until profile is done
        }

        const urlParams = new URLSearchParams(window.location.search);

        // --- បន្ថែម៖ Deep Linking សម្រាប់ Quiz ---
        const quizId = urlParams.get('quiz_id');
        if (quizId) {
            let course = courses.find(c => String(c.id) === String(quizId));
            if (!course) {
                const { data } = await supabase.from('courses').select('*').eq('id', quizId).maybeSingle();
                if (data) course = data;
            }

            if (course) {
                if (isNewUser) {
                    pendingQuizCourse = course;
                    showNewUserWelcomeModal = true;
                    replaceState(window.location.pathname, {});
                    return;
                }
                startQuiz(course.id);
                replaceState(window.location.pathname, {});
                return;
            }
        }

        // --- Deep Linking សម្រាប់លិខិតបញ្ជាក់ ---
        const certCourseId = urlParams.get('cert_course_id');
        if (certCourseId) {
            const certCourse = courses.find(c => String(c.id) === String(certCourseId))
                ?? (await supabase.from('courses').select('*').eq('id', certCourseId).maybeSingle()).data;
            if (certCourse) generateCertificate(certCourse);
            replaceState(window.location.pathname, {});
        }

        // --- បន្ថែម៖ Deep Linking សម្រាប់ការប្រជុំ ---
        const meetingId = urlParams.get('meeting_id');
        if (meetingId) {
            const meeting = meetings.find(m => String(m.id) === String(meetingId));
            if (meeting) {
                openMeetingRegistration(meeting);
                replaceState(window.location.pathname, {});
            } else {
                const { data } = await supabase.from('live_meetings').select('*').eq('id', meetingId).maybeSingle();
                if (data) openMeetingRegistration(data);
            }
        }

        // --- បន្ថែម៖ Deep Linking សម្រាប់ Custom Form ---
        const formId = urlParams.get('form_id');
        if (formId) {
            loadCustomForm(formId);
            replaceState(window.location.pathname, {});
        }
        // -----------------------------------------------------
        // -----------------------------------------------------

        if (currentUser.role === 'admin' || currentUser.role === 'owner') {
            // Admin data is loaded inside AdminDashboard component
        }
    }

    async function logout() {
        // បន្ថែមការបញ្ជាក់មុនពេលចាកចេញ
        if (!confirm("តើអ្នកពិតជាចង់ចាកចេញពីប្រព័ន្ធមែនទេ?")) return;
        
        showProfileModal = false;

        await supabase.auth.signOut();
        localStorage.removeItem('sessionUserId');

        currentUser = null;
        passedCourses = [];
        userQuizAttempts = [];
        courseCooldowns = {};
        preTestDoneCourses = [];
        postTestAttemptedCourses = [];
        evaluationCompletedCourses = [];
        _lastEvalCheckKey = '';
        currentScreen = 'auth';
        authStep = 'phone';
        tempPhone = localStorage.getItem('savedPhone') || ''; // Keep phone if "remember me" was checked
    }

    async function openAdminPanel(e) {
        // ទទួលឈ្មោះ Tab ពី Event (ឧ. 'courses') បើគ្មានទេដាក់ 'dashboard'
        const targetTab = (e && e.detail && typeof e.detail === 'string') ? e.detail : 'dashboard';

        if (!currentUser?.id) return;
        const { data } = await supabase.from('users').select('role').eq('id', currentUser.id).maybeSingle();
        if (data?.role === 'admin' || data?.role === 'owner') {
            currentScreen = 'admin'; // ប្តូរអេក្រង់ភ្លាមៗដើម្បីបង្ហាញ Loading
            pushState('#admin', { screen: 'admin' });
            adminTab = targetTab;

            // Lazy Load: ទាញយក Component តែពេលត្រូវការប៉ុណ្ណោះ
            if (!AdminDashboard) {
                const module = await import('$lib/Components/admin/AdminDashboard.svelte');
                AdminDashboard = module.default;
            }

            // Fetch total users count
            const { count } = await supabase.from('users').select('id', { count: 'exact', head: true });
            totalUsers = count || 0;
            
            return;
        }
        alert('អ្នកមិនមានសិទ្ធិចូលផ្ទាំងគ្រប់គ្រងទេ។');
    }

    async function openCertGen() {
        currentScreen = 'cert_gen';
        if (!CertificateGeneratorComponent) {
            const module = await import('$lib/Components/admin/CertificateGenerator.svelte');
            CertificateGeneratorComponent = module.default;
        }
    }

    // --- SYSTEM SETTINGS ---
    async function loadSystemSettings() {
        // Requires table 'app_settings' with columns: id (int8), login_bg_url (text), login_logo_url (text)
        const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).maybeSingle();
        if (error) {
            console.warn("Settings not loaded (Table might be missing):", error.message);
            return;
        }
        if (data) {
            loginLogoUrl = data.login_logo_url || '';
            faviconUrl = data.favicon_url || '';
            primaryColor = data.primary_color || '';
            borderRadius = data.border_radius || '0.5rem';
            showCPDPoints = data.show_cpd_points === true;
            isMaintenanceMode = data.is_maintenance_mode === true;
            profileFormId = data.profile_form_id;
            if (data.assistant_telegram) assistantTelegram = data.assistant_telegram;
            if (data.tutorials) tutorials = data.tutorials || [];
            evaluationFormUrl = data.evaluation_form_url || '';
        }
    }

    async function updateAppSetting(updates) {
        const { error } = await supabase.from('app_settings').upsert({ id: 1, ...updates });
        if (error) alert("មានបញ្ហាពេលរក្សាទុកការកំណត់: " + error.message);
        return !error;
    }

    // --- DATA LOADING ---
    async function loadHomeData() {
        // Meetings
        // Filter out meetings older than 5 days for users (but keep in DB for admin)
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 5);

        // 1. Load Meetings
        let data = [];
        try {
            let meetingsQuery = supabase.from('live_meetings')
                .select('id, title, scheduled_at, meeting_url, registration_form_id, is_published, join_available_at, course_id').is('deleted_at', null).gte('scheduled_at', cutoffDate.toISOString()).order('scheduled_at', { ascending: false }).limit(20);
            if (currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
                meetingsQuery = meetingsQuery.eq('is_published', true);
            }
            const meetingsRes = await meetingsQuery;
            if (meetingsRes.error && meetingsRes.error.message?.includes('course_id')) {
                let fallbackQuery = supabase.from('live_meetings')
                    .select('id, title, scheduled_at, meeting_url, registration_form_id, is_published, join_available_at').is('deleted_at', null).gte('scheduled_at', cutoffDate.toISOString()).order('scheduled_at', { ascending: false }).limit(20);
                if (currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
                    fallbackQuery = fallbackQuery.eq('is_published', true);
                }
                ({ data } = await fallbackQuery);
            } else {
                data = meetingsRes.data || [];
            }
        } catch (e) {
            console.warn("Error fetching meetings (likely missing deleted_at), falling back...", e);
            let meetingsQuery = supabase.from('live_meetings')
                .select('id, title, scheduled_at, meeting_url, registration_form_id, is_published, join_available_at, course_id').gte('scheduled_at', cutoffDate.toISOString()).order('scheduled_at', { ascending: false }).limit(20);
            if (currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
                meetingsQuery = meetingsQuery.eq('is_published', true);
            }
            const meetingsRes = await meetingsQuery;
            if (meetingsRes.error && meetingsRes.error.message?.includes('course_id')) {
                let fallbackQuery = supabase.from('live_meetings')
                    .select('id, title, scheduled_at, meeting_url, registration_form_id, is_published, join_available_at').gte('scheduled_at', cutoffDate.toISOString()).order('scheduled_at', { ascending: false }).limit(20);
                if (currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
                    fallbackQuery = fallbackQuery.eq('is_published', true);
                }
                ({ data } = await fallbackQuery);
            } else {
                data = meetingsRes.data || [];
            }
        }

        // Lazy load LessonPlayer component
        if (!LessonPlayerComponent) {
            const module = await import('$lib/Components/admin/LessonPlayer.svelte');
            LessonPlayerComponent = module.default;
        }

        meetings = data || [];

        // Fetch Total Users for Admin
        if (currentUser?.role === 'admin' || currentUser?.role === 'owner') {
            const { count } = await supabase.from('users').select('id', { count: 'exact', head: true });
            totalUsers = count || 0;
        }

        // Load Passed Courses History (ទាញយកប្រវត្តិប្រឡងជាប់)
        if (currentUser) {
            const attemptsPromise = fetch('/api/my-quiz-results', {
                headers: { 'X-User-Id': currentUser.id }
            }).then(async (res) => {
                const payload = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(payload?.error || 'មិនអាចទាញយកប្រវត្តិប្រឡងបានទេ');
                return payload.attempts || [];
            });
            
            const regsPromise = supabase.from('meeting_registrations')
                .select('meeting_id')
                .eq('user_id', currentUser.id)
                .limit(100);

            const [attemptsRes, regsRes] = await Promise.allSettled([attemptsPromise, regsPromise]);

            // 1. Process Quiz History
            if (attemptsRes.status === 'rejected') console.error('Error loading history:', attemptsRes.reason);
            if (attemptsRes.status === 'fulfilled') {
                const attempts = attemptsRes.value;
                userQuizAttempts = attempts;
                // រាប់តែ Post-test ប៉ុណ្ណោះចូលក្នុង passedCourses (ដើម្បីចេញលិខិតបញ្ជាក់ការសិក្សា)
                const dbPassed = attempts.filter(a => a.passed && a.type !== 'pre').map(a => String(a.course_id));
                passedCourses = [...new Set([...passedCourses, ...dbPassed])];
                
                const dbPreDone = attempts.filter(a => a.type === 'pre').map(a => String(a.course_id));
                preTestDoneCourses = [...new Set(dbPreDone)];
                
                const dbPostAttempted = attempts.filter(a => a.type !== 'pre').map(a => String(a.course_id));
                postTestAttemptedCourses = [...new Set(dbPostAttempted)];
                
                // courseCooldowns is recalculated reactively whenever courses or userQuizAttempts change
            }

            // Process Meeting Registrations
            if (regsRes.status === 'fulfilled' && regsRes.value.data) {
                registeredMeetingIds = regsRes.value.data.map(r => r.meeting_id);
            }
        }
    }

    // --- HOME PULL TO REFRESH ---
    let homePullStartY = 0;
    let homePullMoveY = 0;
    let isRefreshingHome = false;
    let isPullTriggered = false; // សម្រាប់ការពារកុំឱ្យរំញ័រច្រើនដង

    async function refreshHome() {
        isRefreshingHome = true;
        try {
            await loadHomeData();
            await queryClient.invalidateQueries({ queryKey: ['courses'] });
        } catch (e) { console.error(e); }
        finally { isRefreshingHome = false; homePullMoveY = 0; }
    }

    function handleHomeTouchStart(e) {
        if (typeof window !== 'undefined' && window.scrollY === 0) {
            homePullStartY = e.touches[0].clientY;
            isPullTriggered = false; // Reset state
        }
    }

    function handleHomeTouchMove(e) {
        if (homePullStartY === 0) return;
        const y = e.touches[0].clientY;
        const diff = y - homePullStartY;
        
        if (diff > 0 && typeof window !== 'undefined' && window.scrollY === 0) {
            homePullMoveY = diff * 0.4; // Resistance

            // Haptic Feedback: រំញ័រពេលទាញដល់កម្រិត (60px)
            if (homePullMoveY > 60 && !isPullTriggered) {
                isPullTriggered = true;
                if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(15); // រំញ័រខ្លី (Light Impact)
            } else if (homePullMoveY < 60 && isPullTriggered) {
                isPullTriggered = false; // Reset បើទាញឡើងវិញ
            }

        } else {
            homePullMoveY = 0;
            homePullStartY = 0;
        }
    }

    function handleHomeTouchEnd() {
        if (homePullMoveY > 60) {
            refreshHome();
        } else {
            homePullMoveY = 0;
        }
        homePullStartY = 0;
    }

    // --- QUIZ LOGIC ---
    async function openLesson(course) {
        // Reset state
        activeCourseForPlayer = course;
        
        // Fetch lessons from DB
        const { data, error } = await supabase.from('lessons').select('*').eq('course_id', course.id).order('sort_order', {ascending: true});
        if (error) console.error("Error loading lessons:", error);
        
        if (data && data.length > 0) {
            activeCourseLessons = data;
            activeLessonForPlayer = data[0];
        } else {
            // Fallback to single course link if no lessons are defined
            activeCourseLessons = [{ id: 'fallback', title: course.title, url: course.pdf_url, duration: course.duration }];
            activeLessonForPlayer = activeCourseLessons[0];
        }

        currentScreen = 'lesson';
        pushState('#lesson', { screen: 'lesson' }); // បន្ថែម History State
    }

    function closeLesson() {
        if (window.location.hash === '#lesson') {
            window.history.back(); // ប្រើ Back របស់ Browser បើមាន
        } else {
            currentScreen = 'home';
        }
    }

    async function startQuiz(courseId, retake = false, type = 'post') {
        activeQuizType = type;
        
        // បើជា Post-test ហើយជាប់ហើយ មិនបាច់ធ្វើទៀតទេ (លើកលែងតែចង់ Retake)
        if (type === 'post' && passedCourses.includes(String(courseId)) && !retake) {
            return alert("អ្នកបានប្រឡងជាប់វគ្គនេះរួចហើយ! (You have already passed this course!)");
        }

        // Get cooldown from course settings (default 60 minutes)
        const course = courses.find(c => String(c.id) === String(courseId));
        if (!course) {
            return alert('រកមិនឃើញវគ្គសិក្សាសម្រាប់តេស្តនេះទេ។ សូមផ្ទុកទំព័រឡើងវិញ។');
        }

        // Enforce the opening time here so buttons, shared links and retries
        // cannot enter the post-test through different paths.
        if (type === 'post' && course.post_test_fixed_date) {
            const opensAt = new Date(course.post_test_fixed_date);
            if (!Number.isNaN(opensAt.getTime()) && opensAt.getTime() > Date.now()) {
                const openingLabel = opensAt.toLocaleString('km-KH', {
                    dateStyle: 'full',
                    timeStyle: 'short',
                    timeZone: 'Asia/Phnom_Penh'
                });
                return alert(`Post-test មិនទាន់បើកទេ។ អាចចូលធ្វើបាននៅ ${openingLabel}។`);
            }
        }
        
        // ពិនិត្យមើលថាតើវគ្គសិក្សាផុតកំណត់ហើយឬនៅ?
        if (course.cert_end_date && new Date(course.cert_end_date) < new Date()) {
            return alert("វគ្គសិក្សានេះបានផុតកំណត់ហើយ! អ្នកមិនអាចធ្វើតេស្តបានទៀតទេ។");
        }
        
        if (type === 'post' && course.post_test_auto_close_date && new Date(course.post_test_auto_close_date) < new Date()) {
            return alert("ការធ្វើតេស្តបានបិទហើយ។");
        }

        const cooldownConfigs = getCooldownConfig(course);

        // --- COOLDOWN CHECK (រង់ចាំ ១ ម៉ោង) ---
        // Use local data instead of fetching again
        const attempts = userQuizAttempts.filter(a => String(a.course_id) === String(courseId));
        const lastAttempt = attempts.length > 0 ? attempts[0] : null;

        if (lastAttempt && !lastAttempt.passed) {
            const lastTime = new Date(lastAttempt.created_at).getTime();
            const failCount = getFailCount(courseId);
            const duration = cooldownConfigs[Math.min(failCount - 1, cooldownConfigs.length - 1)];
            const cooldownMs = duration * 60 * 1000; 
            const diff = Date.now() - lastTime;
            
            if (diff < cooldownMs) {
                const remainingSeconds = Math.ceil((cooldownMs - diff) / 1000);
                const m = Math.floor(remainingSeconds / 60);
                const s = remainingSeconds % 60;
                return alert(`អ្នកទើបតែប្រឡង។ សូមមើលមេរៀនឡើងវិញ ហើយព្យាយាមម្តងទៀតក្នុងរយៈពេល ${m}នាទី ${s}វិនាទី។`);
            }
        }

        activeCourseId = courseId;
        
        // Try fetch from DB, else fallback
        // កែប្រែ៖ ទាញយកសំណួរទាំងអស់ដោយមិនបែងចែក type (Pre/Post ប្រើសំណួរដូចគ្នា)
        const { data, error } = await supabase.from('quiz_questions').select('*').eq('course_id', courseId).order('sort_order', { ascending: true }).order('id', { ascending: true });

        if (error) {
            console.error('Error loading quiz questions:', error);
            return alert('មិនអាចទាញយកសំណួរបានទេ។ សូមព្យាយាមម្តងទៀត។');
        }
        
        if (data && data.length > 0) {
            let questions = data.map(q => ({
                ...q, 
                answer: q.correct_answer,
                answers: Array.isArray(q.correct_answer) ? q.correct_answer : [q.correct_answer]
            }));
            // Shuffle Questions (Fisher-Yates Shuffle)
            for (let i = questions.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [questions[i], questions[j]] = [questions[j], questions[i]];
            }
            quizData[courseId] = questions;
        } else {
            return alert('វគ្គសិក្សានេះមិនទាន់មានសំណួរតេស្តនៅឡើយទេ។');
        }
        
        quizKey++;
        currentScreen = 'quiz';
        pushState('#quiz', { screen: 'quiz' });
    }

    function handleQuizSaved(event) {
        const { attempt, newXp, newCpdTotal } = event.detail || {};
        if (!attempt?.course_id) return;

        userQuizAttempts = [
            attempt,
            ...userQuizAttempts.filter(item => String(item.id) !== String(attempt.id))
        ];

        const courseId = String(attempt.course_id);
        if (attempt.type === 'pre') {
            preTestDoneCourses = [...new Set([...preTestDoneCourses, courseId])];
        } else {
            postTestAttemptedCourses = [...new Set([...postTestAttemptedCourses, courseId])];
            if (attempt.passed) {
                passedCourses = [...new Set([...passedCourses, courseId])];
            }
        }

        if (currentUser) {
            const updates = {};
            if (newXp !== null && newXp !== undefined && Number.isFinite(Number(newXp))) {
                updates.xp = Number(newXp);
            }
            if (newCpdTotal !== null && newCpdTotal !== undefined && Number.isFinite(Number(newCpdTotal))) {
                updates.cpd_total = Number(newCpdTotal);
            }
            currentUser = { ...currentUser, ...updates };
        }
    }

    async function reviewQuiz(courseId) {
        loading = true;
        activeCourseId = courseId;

        // 1. Ensure questions are loaded
        if (!quizData[courseId]) {
             const { data, error } = await supabase.from('quiz_questions').select('*').eq('course_id', courseId);
             if (error) {
                loading = false;
                console.error('Error loading quiz review questions:', error);
                return alert('មិនអាចទាញយកសំណួរបានទេ។ សូមព្យាយាមម្តងទៀត។');
             }
             if (data && data.length > 0) {
                quizData[courseId] = data.map(q => ({...q, answer: q.correct_answer}));
             } else {
                loading = false;
                return alert('វគ្គសិក្សានេះមិនទាន់មានសំណួរតេស្តនៅឡើយទេ។');
             }
        }

        // 2. Fetch answers from latest passed attempt
        const { data } = await supabase.from('student_quiz_results')
            .select('answers')
            .eq('user_id', currentUser.id)
            .eq('course_id', courseId)
            .eq('passed', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        loading = false;
        if (data && data.answers) {
            userAnswers = data.answers;
            currentScreen = 'review';
            pushState('#review', { screen: 'review' });
        } else {
            alert("No review data available for this course.");
        }
    }

    async function updateAvatarInDb(url) {
        const oldAvatarUrl = currentUser.avatar_url;
        const { data, error } = await supabase.from('users').update({ avatar_url: url }).eq('id', currentUser.id).select('avatar_url');
        if (error) {
            alert("បរាជ័យក្នុងការប្តូររូបភាព: " + error.message);
        } else if (!data || data.length === 0) {
            alert("បរាជ័យក្នុងការប្តូររូបភាព: មិនអាចរក្សាទុកទិន្នន័យបានទេ (សូមពិនិត្យមើល RLS Policy)");
        } else {
            if (oldAvatarUrl) await deleteFile(oldAvatarUrl);
            currentUser.avatar_url = url;
            currentUser = { ...currentUser }; // Trigger reactivity (ឱ្យ Svelte ដឹងថាមានការកែប្រែ)
            alert("បានប្តូររូបភាពប្រវត្តិរូប!");
        }
    }

    async function deleteFile(url) {
        if (!url) return;
        try {
            await fetch('/api/storage', {
                method: 'DELETE',
                headers: {
                    'X-User-Id': currentUser?.id || '',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url })
            });
        } catch (e) {
            console.error("Failed to delete file:", e);
        }
    }

    let recordingAttendance = new Set();

    async function recordMeetingAttendance(meeting) {
        // បើគ្មានសិស្ស ឬក៏កំពុងតែដំណើរការកត់ត្រាវត្តមាននេះស្រាប់ មិនបាច់ធ្វើអ្វីទៀតទេ
        if (!currentUser || recordingAttendance.has(meeting.id)) return;

        // កត់ចំណាំថាការប្រជុំនេះកំពុងបញ្ជូនទិន្នន័យ
        recordingAttendance.add(meeting.id);
        recordingAttendance = recordingAttendance; // បញ្ជាឱ្យ Svelte ដឹង

        const { error } = await supabase.from('meeting_attendance').upsert({
            user_id: currentUser.id,
            meeting_id: meeting.id
        }, { onConflict: 'meeting_id, user_id', ignoreDuplicates: true });
        
        if (error) {
            console.error("Error recording attendance:", error);
        } else {
            showSuccessToast("បានកត់ត្រាវត្តមានជោគជ័យ!");
        }

        // ដកការរាំងខ្ទប់ចេញវិញបន្ទាប់ពី ៣ វិនាទី (បើចង់ចុចម្តងទៀត)
        setTimeout(() => { recordingAttendance.delete(meeting.id); recordingAttendance = recordingAttendance; }, 3000);
    }

    async function generateCertificate(course) {
        if (!course.cert_template_url) {
            return alert("វគ្គសិក្សានេះមិនទាន់មានលិខិតបញ្ជាក់ការសិក្សាទេ");
        }
        
        if (course.has_pre_test) {
            const preTestDone = preTestDoneCourses.includes(String(course.id));
            if (!preTestDone) return alert("សូមធ្វើតេស្តដើមវគ្គ (Pre-test) និងបញ្ចប់មេរៀនជាមុនសិន។");
        }

        const now = new Date();
        if (course.cert_start_date && new Date(course.cert_start_date) > now) {
            const startDate = new Date(course.cert_start_date).toLocaleDateString('km-KH');
            return alert(`លិខិតបញ្ជាក់ការសិក្សានេះនឹងបើកឱ្យទាញយកចាប់ពីថ្ងៃទី ${startDate} នេះតទៅ។`);
        }

        loading = true;
        try {
            const canvas = document.createElement('canvas');
            
            let attempt = userQuizAttempts
                .filter(a => String(a.course_id) === String(course.id) && a.passed && a.type !== 'pre')
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

            if (!attempt) {
                const res = await fetch('/api/my-quiz-results', {
                    headers: { 'X-User-Id': currentUser.id }
                });
                const payload = await res.json().catch(() => ({}));
                if (res.ok) {
                    const attempts = payload.attempts || [];
                    userQuizAttempts = attempts;
                    attempt = attempts
                        .filter(a => String(a.course_id) === String(course.id) && a.passed && a.type !== 'pre')
                        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
                }
            }

            const certId = attempt?.id ? `CCN-${String(attempt.id).padStart(3, '0')}` : `ID: ${Date.now().toString().slice(-9)}`;
            const dateVal = attempt?.created_at ? new Date(attempt.created_at) : new Date();
            const dateStr = dateVal.toLocaleDateString('km-KH');
            const qrData = `${window.location.origin}/verify?u=${currentUser.id}&c=${course.id}`;
            const logoUrl = loginLogoUrl || '/ccn-logo.png';

            await drawCertificate(canvas, course, currentUser, certId, dateStr, qrData, logoUrl);

            previewCertificateUrl = canvas.toDataURL('image/jpeg', 0.8);
            activeCertificateCourse = course;
            showCertificateModal = true;
        } catch (e) {
            console.error(e);
            alert("បរាជ័យក្នុងការបង្កើតលិខិតបញ្ជាក់ការសិក្សា: " + e.message);
        } finally {
            loading = false;
        }
    }

    async function shareCertificate(course) {
        const shareUrl = `${window.location.origin}?cert_course_id=${course.id}`;
        const shareText = `ទាញយកលិខិតបញ្ជាក់ការសិក្សាវគ្គ "${course.title}" នៅទីនេះ៖ ${shareUrl}`;
        if (navigator.share) {
            try { await navigator.share({ title: 'CCN-CPD Certificate', text: shareText, url: shareUrl }); } 
            catch (err) { if (err.name !== 'AbortError') copyToClipboard(shareUrl, "បានចម្លងតំណភ្ជាប់ទាញយកលិខិត!"); }
        } else {
            copyToClipboard(shareUrl, "បានចម្លងតំណភ្ជាប់ទាញយកលិខិត!");
        }
    }

    async function shareQuiz(course) {
        const shareUrl = `${window.location.origin}?quiz_id=${course.id}`;
        const shareText = `តោះធ្វើតេស្តវគ្គ "${course.title}" ក្នុងកម្មវិធី CCN-CPD!\n\nចូលធ្វើតេស្តនៅទីនេះ៖ ${shareUrl}`;
        
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'CCN-CPD Quiz - ' + course.title,
                    text: shareText,
                    url: shareUrl
                });
            } catch (err) {
                console.error('Error sharing:', err);
            }
        } else {
            copyToClipboard(shareUrl, "បានចម្លងតំណភ្ជាប់តេស្ត!");
        }
    }

    async function shareMeeting(meeting) {
        const shareUrl = `${window.location.origin}?meeting_id=${meeting.id}`;
        const shareText = `សូមចុះឈ្មោះមុនចូលរួមវគ្គ "${meeting.title}" ក្នុងកម្មវិធី CCN-CPD!\n\nចុះឈ្មោះនិងចូលរួមនៅទីនេះ៖ ${shareUrl}`;
        
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'CCN-CPD - ' + meeting.title,
                    text: shareText,
                    url: shareUrl
                });
            } catch (err) {
                console.error('Error sharing:', err);
            }
        } else {
            copyToClipboard(shareUrl, "បានចម្លងតំណភ្ជាប់ការប្រជុំ!");
        }
    }

    async function shareCustomForm() {
        if (!activeFormData) return;
        const shareUrl = `${window.location.origin}?form_id=${activeFormData.id}`;
        const shareText = `សូមបំពេញបែបបទ "${activeFormData.title}" តាមរយៈតំណភ្ជាប់នេះ៖ ${shareUrl}`;

        if (navigator.share) {
            try {
                await navigator.share({
                    title: activeFormData.title,
                    text: shareText,
                    url: shareUrl
                });
            } catch (err) {
                console.error('Error sharing:', err);
            }
        } else {
            copyToClipboard(shareUrl, "បានចម្លងតំណភ្ជាប់បែបបទ!");
        }
    }

    async function shareQuizResult() {
        const questions = quizData[activeCourseId] || [];
        if (questions.length === 0) return;

        let correctCount = 0;
        questions.forEach((q, i) => {
            if (userAnswers[i] === q.answer) correctCount++;
        });
        
        const percentage = Math.round((correctCount / questions.length) * 100);
        const course = courses.find(c => c.id === activeCourseId);
        const courseTitle = course ? course.title : 'វគ្គសិក្សា';
        
        activeShareUrl = `${window.location.origin}?quiz_id=${activeCourseId}`;
        activeShareTitle = `លទ្ធផលតេស្ត: ${percentage}%`;
        activeShareText = `ខ្ញុំបានបញ្ចប់ការធ្វើតេស្ត "${courseTitle}" ក្នុងកម្មវិធី CCN-CPD ដោយទទួលបានពិន្ទុ ${percentage}%! 🏆\n\nសូមចូលធ្វើតេស្តនេះភ្លាមៗ៖ ${activeShareUrl}`;
        showShareModal = true;
    }

    function findValueByKey(obj, ...keywords) {
        const keys = Object.keys(obj);
        for (const keyword of keywords) {
            // Exact match
            if (obj[keyword]) return obj[keyword];
            
            // Case insensitive match
            const keyCI = keys.find(k => k.toLowerCase() === keyword.toLowerCase());
            if (keyCI) return obj[keyCI];
            
            // Partial match (contains)
            const keyPartial = keys.find(k => k.toLowerCase().includes(keyword.toLowerCase()));
            if (keyPartial) return obj[keyPartial];
        }
        return null;
    }

    async function handleImageSelect(e, type) {
        const file = e.target.files[0];
        if (!file) return;

        if (!['image/jpeg', 'image/png'].includes(file.type)) {
            alert("សូម Upload តែឯកសារប្រភេទ JPG ឬ PNG ប៉ុណ្ណោះ!");
            e.target.value = '';
            return;
        }
        
        isUploading = true;
        try {
            const compressed = await compressImage(file, 300, 0.8); // WebP, 300px
            const url = await handleUpload(compressed, 'avatars');
            if (url) {
                if (type === 'direct') {
                    await updateAvatarInDb(url);
                }
            }
        } catch (error) {
            console.error("Upload error:", error);
            alert("មានបញ្ហាក្នុងការផ្ទុករូបភាព: " + error.message);
            errorMsg = 'មានបញ្ហា: ' + error.message;
        } finally {
            isUploading = false;
            e.target.value = '';
            loading = false;
        }
    }

    function handleOnline() {
        isOffline = false;
        // ព្យាយាមផ្ទុកទិន្នន័យឡើងវិញពេលមានអ៊ីនធឺណិត
        loadHomeData();
    }

    function handleOffline() {
        isOffline = true;
    }

    function handlePopState(event) {
        if (currentScreen === 'lesson') {
            closeLesson();
        } else if (currentScreen !== 'home' && currentScreen !== 'auth') {
            currentScreen = 'home';
            // Clean up the URL hash
            window.history.replaceState({ screen: 'home' }, '', window.location.pathname);
        }
    }

    function copyToClipboard(text, msg) {
        if (!text) return;
        navigator.clipboard.writeText(text).then(() => alert(msg || "បានចម្លងតំណភ្ជាប់ទៅក្ដារតម្បៀតខ្ទាស់!"));
    }

    function getEmbedUrl(url) {
        if (!url) return '';
        // Handle YouTube links to convert watch -> embed
        const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
        const match = url.match(youtubeRegex);
        if (match && match[1]) {
            return `https://www.youtube.com/embed/${match[1]}`;
        }

        // Handle Google Drive links to convert view -> preview
        const driveRegex = /drive\.google\.com\/file\/d\/([^\/?]+)/;
        const driveMatch = url.match(driveRegex);
        if (driveMatch && driveMatch[1]) {
            return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
        }
        return url;
    }

    function shareApp() {
        activeShareUrl = window.location.origin;
        activeShareTitle = 'ស្កេនដើម្បីចូល';
        activeShareText = 'ចូលរៀនវគ្គបណ្តុះបណ្តាលតាមរយៈកម្មវិធីនេះ!';
        showShareModal = true;
    }

    function getContrastColor(hexColor) {
        if (!hexColor) return '#ffffff';
        let hex = hexColor.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        if (hex.length !== 6) return '#ffffff';
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000000' : '#ffffff';
    }

    // --- COOLDOWN LOGIC ---
    function getCooldownConfig(course) {
        if (!course || !course.quiz_cooldown) return [60];
        return String(course.quiz_cooldown).split(',').map(s => parseFloat(s.trim()) || 60);
    }

    function getFailCount(courseId) {
        if (!userQuizAttempts) return 0;
        const attempts = userQuizAttempts.filter(a => String(a.course_id) === String(courseId));
        if (attempts.length === 0) return 0;
        
        // Sort descending
        attempts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        let failCount = 0;
        for (const a of attempts) {
            if (!a.passed) failCount++;
            else break; // Reset count on pass
        }
        return failCount;
    }

    // Reactive Cooldown Calculation — re-runs whenever courses or userQuizAttempts change
    $: if (courses.length > 0 && userQuizAttempts.length > 0) {
        const tempCooldowns = {};
        courses.forEach(c => {
            const attempts = userQuizAttempts.filter(a => String(a.course_id) === String(c.id));
            if (attempts.length > 0 && !attempts[0].passed) {
                const lastTime = new Date(attempts[0].created_at).getTime();
                const failCount = getFailCount(c.id);
                const configs = getCooldownConfig(c);
                const duration = configs[Math.min(failCount - 1, configs.length - 1)] || 60;
                const durationMs = duration * 60 * 1000;
                const endTime = lastTime + durationMs;
                if (endTime > Date.now()) tempCooldowns[c.id] = { end: endTime, total: durationMs };
            }
        });
        courseCooldowns = tempCooldowns;
    }

    function handleGlobalKeydown(e) {
        if (e.key === 'Escape') {
            if (showProfileModal && !forceProfileComplete) showProfileModal = false;
            else if (showStatsModal) showStatsModal = false;
            else if (showShareModal) showShareModal = false;
            else if (showForgotPinModal) showForgotPinModal = false;
            else if (showCertificateModal) showCertificateModal = false;
        }
    }

    async function openMeetingRegistration(meeting) {
        selectedMeeting = meeting;

        // ពិនិត្យមើលថាតើបានចុះឈ្មោះរួចហើយឬនៅ
        const { data } = await supabase.from('meeting_registrations').select('id').eq('user_id', currentUser.id).eq('meeting_id', meeting.id).maybeSingle();
        
        if (data) {
            if (confirm("អ្នកបានចុះឈ្មោះរួចហើយ! តើអ្នកចង់ចូលរួមការប្រជុំឥឡូវនេះទេ?")) {
                window.open(meeting.meeting_url, '_blank');
            }
            return;
        }

        // ពិនិត្យមើលថាតើការប្រជុំនេះមានភ្ជាប់ជាមួយ Custom Form ដែរឬទេ?
        if (meeting.registration_form_id) {
            loadCustomForm(meeting.registration_form_id);
            return;
        }

        alert("ការប្រជុំនេះមិនទាន់មានទម្រង់ចុះឈ្មោះទេ។ សូមទាក់ទងអ្នកគ្រប់គ្រង។");
    }

    $: primaryTextColor = getContrastColor(primaryColor);

    // --- SVELTE QUERY FOR COURSES ---
    $: coursesQuery = createQuery({
        queryKey: ['courses', currentUser?.role], // Refetch when role changes
        queryFn: async () => {
            const courseColumns = 'id, title, description, category, duration, pdf_url, thumbnail_url, is_featured, is_published, created_at, sort_order, cert_template_url, cert_end_date, cert_start_date, post_test_auto_close_date, post_test_fixed_date, quiz_cooldown, has_pre_test, lessons_enabled, evaluation_form_id, cert_config';
            try {
                let query = supabase.from('courses').select(courseColumns).is('deleted_at', null).order('sort_order', {ascending: true}).order('created_at', {ascending: false}).limit(100);
                if (currentUser?.role !== 'admin' && currentUser?.role !== 'owner') {
                    query = query.eq('is_published', true).or(`published_at.is.null,published_at.lte.${new Date().toISOString()}`);
                }
                const { data, error } = await query;
                if (error) throw error;
                return data || [];
            } catch (e) {
                console.warn("Error fetching courses (likely missing deleted_at column), falling back...", e);
                // Fallback: Fetch without deleted_at filter (ករណីមិនទាន់មាន Column deleted_at)
                let query = supabase.from('courses').select(courseColumns).order('sort_order', {ascending: true}).order('created_at', {ascending: false}).limit(100);
                if (currentUser?.role !== 'admin' && currentUser?.role !== 'owner') query = query.eq('is_published', true);
                const { data } = await query;
                return data || [];
            }
        },
        staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    });

    $: courses = $coursesQuery?.data || [];

    // Load which evaluation forms the current user has already submitted
    let _lastEvalCheckKey = '';
    $: if (currentUser?.id && courses.length > 0 && passedCourses.length > 0) loadEvalCompletions();
    async function loadEvalCompletions() {
        const key = `${currentUser.id}|${[...passedCourses].sort().join(',')}`;
        if (key === _lastEvalCheckKey) return;
        _lastEvalCheckKey = key;
        const evalCourses = courses.filter(c => c.evaluation_form_id && passedCourses.includes(String(c.id)));
        if (!evalCourses.length) { evaluationCompletedCourses = []; return; }
        const { data } = await supabase.from('custom_form_submissions')
            .select('form_id').eq('user_id', currentUser.id)
            .in('form_id', evalCourses.map(c => c.evaluation_form_id));
        const submittedIds = new Set((data || []).map(s => s.form_id));
        evaluationCompletedCourses = evalCourses.filter(c => submittedIds.has(c.evaluation_form_id)).map(c => String(c.id));
    }

    function showSuccessToast(msg) {
        successToastMsg = msg;
        setTimeout(() => successToastMsg = '', 5000); // លាក់ទៅវិញក្រោយ ៥ វិនាទី
    }
</script>

<style>
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    :global(.input), :global(.select), :global(.textarea), :global(.file-input), :global(.modal-box), :global(.table), :global(option) {
        background-color: #fff;
        color: #111827;
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-10px); } 75% { transform: translateX(10px); } }
    :global(.shake) { animation: shake 0.3s ease-in-out; }
    
    /* Senior Friendly Global Styles */
    :global(:root) { color-scheme: light; }
    :global(body) { font-size: 18px; line-height: 1.6; }
    :global(.btn) { font-size: 1.2rem; min-height: 3.8rem; padding-left: 1.5rem; padding-right: 1.5rem; }

    /* Fix for Quiz Buttons looking dimmed when disabled */
    :global(.btn:disabled) {
        opacity: 1 !important;
    }
    :global(.btn.bg-white:disabled) {
        background-color: white !important;
        color: #374151 !important;
    }
    :global(.btn.btn-success:disabled) {
        background-color: hsl(var(--su)) !important;
        border-color: hsl(var(--su)) !important;
        color: hsl(var(--suc, var(--nc, black))) !important;
    }
    :global(.btn.btn-error:disabled) {
        background-color: hsl(var(--er)) !important;
        border-color: hsl(var(--er)) !important;
        color: hsl(var(--erc, var(--nc, black))) !important;
    }
    :global(.btn.btn-outline:disabled) {
        background-color: transparent !important;
        border-color: #374151 !important; /* ពណ៌ប្រផេះចាស់ (Border) */
        color: #1f2937 !important; /* ពណ៌ខ្មៅ (Text) */
    }
</style>

<svelte:head>
    {#if faviconUrl}
        <link rel="icon" href={faviconUrl} />
    {/if}
    <link rel="apple-touch-icon" href={loginLogoUrl || '/logo.png'} />
    {#if primaryColor}
        <style>
            :root { 
                --dynamic-primary: {primaryColor}; 
                --dynamic-primary-text: {primaryTextColor};
            }
            .btn-primary:not(.btn-outline) { 
                background-color: var(--dynamic-primary) !important; 
                background-image: linear-gradient(135deg, rgba(255,255,255,0.2) 0%, rgba(0,0,0,0.2) 100%) !important;
                border-color: var(--dynamic-primary) !important; 
                color: var(--dynamic-primary-text) !important; 
            }
            .btn-primary.btn-outline { color: var(--dynamic-primary) !important; border-color: var(--dynamic-primary) !important; background-color: transparent !important; }
            .btn-primary.btn-outline:hover { background-color: var(--dynamic-primary) !important; color: var(--dynamic-primary-text) !important; }
            .text-primary { color: var(--dynamic-primary) !important; }
            .bg-primary { background-color: var(--dynamic-primary) !important; }
            .border-primary { border-color: var(--dynamic-primary) !important; }
            .checkbox-primary:checked { background-color: var(--dynamic-primary) !important; border-color: var(--dynamic-primary) !important; }
            .progress-primary::-moz-progress-bar { background-color: var(--dynamic-primary) !important; }
            .progress-primary::-webkit-progress-value { background-color: var(--dynamic-primary) !important; }
            .progress-primary { color: var(--dynamic-primary) !important; }
            .btn-teal { background-color: var(--dynamic-primary) !important; color: var(--dynamic-primary-text) !important; }
            .bg-teal-600 { background-color: var(--dynamic-primary) !important; }
        </style>
    {/if}
    {#if borderRadius}
        <style>
            :root {
                --rounded-box: {borderRadius};
                --rounded-btn: {borderRadius};
                --rounded-badge: {borderRadius};
            }
        </style>
    {/if}
</svelte:head>

<svelte:window on:keydown={handleGlobalKeydown} />

<!-- ផ្ទាំងលោតសារជោគជ័យ (Success Toast) -->
{#if successToastMsg}
    <div class="toast toast-top toast-center z-[100]" transition:fly={{ y: -20, duration: 300 }}>
        <div class="alert alert-success shadow-lg rounded-xl border-none text-white font-bold px-6">
            <span>✅ {successToastMsg}</span>
        </div>
    </div>
{/if}

<!-- UI STRUCTURE -->
<div class="pb-20 font-sans text-base-content bg-base-100 min-h-screen">
    
    <!-- SESSION RESTORE LOADING GUARD -->
    {#if !sessionChecked}
        <div class="min-h-screen flex items-center justify-center bg-base-100">
            <span class="loading loading-spinner loading-lg text-primary"></span>
        </div>
    {:else}

    <!-- AUTH SCREEN -->
    {#if isOffline}
        <div class="bg-neutral text-neutral-content text-xs p-2 text-center sticky top-0 z-50" transition:slide>
            📶 អ្នកកំពុងប្រើប្រាស់ដោយគ្មានអ៊ីនធឺណិត (Offline Mode)
        </div>
    {/if}

    {#if currentScreen === 'auth'}
        <AuthScreen 
            {authStep}
            bind:tempPhone
            {loading}
            {errorMsg}
            {currentUser}
            {loginLogoUrl}
            {t}
            {currentLang}
            {version}
            bind:rememberMe
            on:toggleLanguage={toggleLanguage}
            on:checkPhone={checkPhoneNumber}
            on:login={(e) => loginWithPin(e.detail.pin)}
            on:register={(e) => registerUser(e.detail)}
            on:forgotPin={forgotPin}
            on:reset={() => { authStep = 'phone'; currentUser = null; }}
        />

    <!-- HOME SCREEN -->
    {:else if currentScreen === 'home'}
        <div in:fade={{ duration: 300 }} class="min-h-screen bg-base-100 relative overflow-hidden"
            on:touchstart={handleHomeTouchStart}
            on:touchmove={handleHomeTouchMove}
            on:touchend={handleHomeTouchEnd}
        >
            {#if homePullMoveY > 0 || isRefreshingHome}
                <div class="w-full flex justify-center items-center overflow-hidden transition-all duration-200 bg-base-200" style="height: {isRefreshingHome ? 60 : Math.min(homePullMoveY, 100)}px;">
                    {#if isRefreshingHome}
                        <span class="loading loading-spinner text-primary"></span>
                    {:else}
                        <div class="flex items-center gap-2 text-gray-500 text-sm">
                            <div class="transition-transform duration-200 {homePullMoveY > 60 ? 'rotate-180' : ''}">
                                <ArrowDownIcon size="20" />
                            </div>
                            <span>{homePullMoveY > 60 ? 'លែងដៃដើម្បីផ្ទុក' : 'ទាញដើម្បីផ្ទុកឡើងវិញ'}</span>
                        </div>
                    {/if}
                </div>
            {/if}
            <HomeScreen
                {supabase}
                {currentUser}
                {isUploading}
                {meetings}
                courses={courses}
                {passedCourses}
                {preTestDoneCourses}
                {postTestAttemptedCourses}
                {registeredMeetingIds}
                {courseCooldowns}
                {evaluationCompletedCourses}
                {evalDismissedCourses}
                {assistantTelegram}
                {tutorials}
                {evaluationFormUrl}
                {t}
                {currentLang}
                on:toggleLanguage={toggleLanguage}
                on:startCropping={(e) => handleImageSelect(e.detail.event, e.detail.type)}
                on:openProfileModal={() => showProfileModal = true}
                on:openAdmin={openAdminPanel}
                on:logout={logout}
                on:openStatsModal={() => showStatsModal = true}
                on:shareApp={() => showShareModal = true}
                on:recordMeetingAttendance={(e) => recordMeetingAttendance(e.detail)}
                on:openLesson={(e) => openLesson(e.detail)}
                on:startQuiz={(e) => {
                    const { id, type } = typeof e.detail === 'object' ? e.detail : { id: e.detail, type: 'post' };
                    startQuiz(id, false, type);
                }}
                on:shareMeeting={(e) => shareMeeting(e.detail)}
                on:openMeetingRegistration={(e) => openMeetingRegistration(e.detail)}
                on:openEvaluationForm={(e) => openEvaluationForm(e.detail)}
                on:dismissEvalCourse={(e) => dismissEvalCourse(e.detail)}
                on:generateCertificate={(e) => generateCertificate(e.detail)}
                on:shareCertificate={(e) => shareCertificate(e.detail)}
                on:shareQuiz={(e) => shareQuiz(e.detail)}
            />
            
        </div>

    <!-- LESSON SCREEN -->
    {:else if currentScreen === 'lesson'}
        <div class="fixed inset-0 z-[60] bg-white" in:fly={{ x: 50, duration: 300 }}>
            {#if LessonPlayerComponent}
                <svelte:component this={LessonPlayerComponent}
                    course={activeCourseForPlayer}
                    bind:lesson={activeLessonForPlayer}
                    lessons={activeCourseLessons}
                    supabase={supabase}
                    currentUser={currentUser}
                    on:close={closeLesson}
                />
            {:else}
                <div class="flex items-center justify-center h-screen">
                    <span class="loading loading-spinner loading-lg text-primary"></span>
                </div>
            {/if}
        </div>

    <!-- QUIZ SCREEN -->
    {:else if currentScreen === 'quiz'}
        <div class="fixed inset-0 z-[60] bg-white" in:fly={{ y: 50, duration: 300 }}>
            {#key quizKey}
            <QuizView 
                questions={quizData[activeCourseId]} 
                courseId={activeCourseId} 
                courseTitle={courses.find(c => c.id === activeCourseId)?.title || ''}
                quizType={activeQuizType}
                passingScore={courses.find(c => c.id === activeCourseId)?.quiz_passing_score || 70}
                cooldownMinutes={(() => {
                    const c = courses.find(x => x.id === activeCourseId);
                    const configs = getCooldownConfig(c);
                    const nextFailCount = getFailCount(activeCourseId) + 1;
                    return configs[Math.min(nextFailCount - 1, configs.length - 1)];
                })()}
                {supabase} 
                {currentUser}
                on:saved={handleQuizSaved}
                on:retry={() => startQuiz(activeCourseId, true)}
                on:review={(e) => {
                    userAnswers = e.detail.answers;
                    currentScreen = 'review';
                    window.history.pushState({ screen: 'review' }, '', '#review');
                }}
                on:close={() => {
                    currentScreen = 'home';
                }}
            />
            {/key}
        </div>

    <!-- REVIEW SCREEN -->
    {:else if currentScreen === 'review'}
        <div class="fixed inset-0 z-[60] bg-white" in:fly={{ x: 50, duration: 300 }}>
            <ReviewView 
                questions={quizData[activeCourseId]} 
                {userAnswers} 
                on:close={() => currentScreen = 'home'} 
                on:share={shareQuizResult}
                on:retry={() => startQuiz(activeCourseId, true)}
            />
        </div>

    <!-- ADMIN SCREEN -->
    {:else if currentScreen === 'admin'}
        <div class="fixed inset-0 z-[60] bg-white overflow-y-auto" in:fly={{ y: -20, duration: 300 }}>
            {#if AdminDashboard}
            <svelte:component this={AdminDashboard}
                {supabase} 
                {currentUser} 
                {courses} 
                {totalUsers}
                {loginLogoUrl}
                {faviconUrl}
                {adminTab}
                {version}
                {showCPDPoints}
                {isMaintenanceMode}
                {profileFormId}
                {assistantTelegram}
                {tutorials}
                {evaluationFormUrl}
                on:close={async () => { await loadHomeData(); currentScreen = 'home'; }}
                on:refresh={() => {
                    loadHomeData();
                    queryClient.invalidateQueries({ queryKey: ['courses'] });
                }}
                on:refreshSettings={loadSystemSettings}
                on:updateSetting={async (e) => {
                    await updateAppSetting(e.detail);
                    await loadSystemSettings();
                }}
                on:openCertGen={openCertGen}
            />
            {:else}
                <div class="flex items-center justify-center h-screen">
                    <span class="loading loading-spinner loading-lg text-primary"></span>
                </div>
            {/if}
        </div>
    
    <!-- CERTIFICATE GENERATOR (EXCEL) -->
    {:else if currentScreen === 'cert_gen'}
        <div class="fixed inset-0 z-50 bg-white overflow-y-auto" in:fly={{ y: 20, duration: 300 }}>
            {#if CertificateGeneratorComponent}
                <svelte:component this={CertificateGeneratorComponent} onClose={() => currentScreen = 'admin'} />
            {:else}
                <div class="flex items-center justify-center h-screen">
                    <span class="loading loading-spinner loading-lg text-primary"></span>
                </div>
            {/if}
        </div>

    <!-- MAINTENANCE SCREEN -->
    {:else if currentScreen === 'maintenance'}
        <div class="screen flex flex-col items-center justify-center min-h-screen p-8 bg-base-100 text-center" in:fade>
            <div class="text-7xl mb-6">🚧</div>
            <h1 class="text-3xl font-bold text-gray-800 mb-4">កំពុងធ្វើបច្ចុប្បន្នភាពប្រព័ន្ធ</h1>
            <p class="text-gray-600 max-w-md text-lg leading-relaxed mb-8">
                សូមអធ្យាស្រ័យ យើងខ្ញុំកំពុងរៀបចំប្រព័ន្ធដើម្បីឱ្យកាន់តែប្រសើរ។<br>
                សូមត្រឡប់មកវិញក្រោយការជូនដំណឹងជាថ្មី។
            </p>
            <button class="btn btn-primary btn-lg rounded-xl shadow-lg" on:click={() => window.location.reload()}>
                ផ្ទុកឡើងវិញ (Refresh)
            </button>
            {#if currentUser}
                 <button class="btn btn-ghost btn-sm mt-8 text-error" on:click={logout}>
                    ចាកចេញ
                </button>
            {/if}
        </div>

    <!-- CUSTOM FORM SCREEN -->
    {:else if currentScreen === 'custom_form' && activeFormId}
        <CustomFormViewer 
            {supabase}
            {currentUser}
            formId={activeFormId}
            {selectedMeeting}
            {evaluationFromCourseId}
            on:close={closeCustomForm}
            on:meetingRegistered={(e) => {
                registeredMeetingIds = [...registeredMeetingIds, e.detail];
                selectedMeeting = null;
                activeFormId = null;
                currentScreen = 'home';
            }}
            on:evaluationCompleted={async (e) => {
                const evalCourseId = e.detail;
                const evalCourse = courses.find(c => String(c.id) === String(evalCourseId));
                evaluationFromCourseId = null;
                activeFormId = null;
                evaluationCompletedCourses = [...evaluationCompletedCourses, String(evalCourseId)];
                currentScreen = 'home';
                if (evalCourse) await generateCertificate(evalCourse);
            }}
        />
    {/if}

    <!-- Profile Modal -->
    <ProfileModal
        bind:show={showProfileModal}
        {currentUser}
        {supabase}
        {profileFormId}
        {showCPDPoints}
        forced={forceProfileComplete}
        forcedMsg={missingProfileMsg}
        on:close={() => { showProfileModal = false; forceProfileComplete = false; }}
        on:save={(e) => { currentUser = toPublicUser(e.detail); forceProfileComplete = false; }}
        on:logout={logout}
    />

    <!-- Modals -->
    <StatsModal bind:show={showStatsModal} {supabase} {currentUser} {courses} {primaryColor} />
    <ShareModal bind:show={showShareModal} {loginLogoUrl} shareUrl={activeShareUrl} shareTitle={activeShareTitle} shareText={activeShareText} />
    <ForgotPinModal bind:show={showForgotPinModal} {assistantTelegram} />
    <CertificatePreviewModal bind:show={showCertificateModal} {previewCertificateUrl} {activeCertificateCourse} />
    <WelcomeModal bind:show={showNewUserWelcomeModal} {pendingQuizCourse} on:startQuiz={() => { if (pendingQuizCourse) startQuiz(pendingQuizCourse.id); }} />

    {/if}<!-- end sessionChecked -->
    </div>

    
