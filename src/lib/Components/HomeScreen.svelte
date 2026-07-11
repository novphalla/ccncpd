<script>
    import { fade, fly, scale } from 'svelte/transition';
    import { elasticOut } from 'svelte/easing';
    import { createEventDispatcher, onMount, tick } from 'svelte';
    import LessonPlayer from './admin/LessonPlayer.svelte';
    import PwaInstallBanner from './PwaInstallBanner.svelte';
    import FloatingAssistant from './FloatingAssistant.svelte';
    import MarqueeFooter from './MarqueeFooter.svelte';
    import TutorialModal from './TutorialModal.svelte';

    export let currentUser;
    export let supabase; // ទទួលយក supabase client
    export let isUploading = false;
    export let unreadCount = 0;
    export let meetings = [];
    export let courses = [];
    export let passedCourses = [];
    export let preTestDoneCourses = [];
    export let postTestAttemptedCourses = [];
    export let registeredMeetingIds = [];
    export let courseCooldowns = {};
    export let evaluationCompletedCourses = [];
    export let evalDismissedCourses = [];
    export let assistantTelegram = '';
    export let tutorials = [];
    export let evaluationFormUrl = '';
    export let t = (key) => key;
    export let currentLang = 'km';

    const dispatch = createEventDispatcher();

    let searchTerm = '';
    let selectedCategory = 'All';
    let currentTime = new Date();
    let now = Date.now();
    let showAllCourses = false;

    let showLessonPlayer = false;
    let selectedCourseForPlayer = null;
    let lessonForPlayer = null; // To hold the specific lesson to play
    let lessonsForPlayer = [];
    let showTutorialModal = false;
    let courseEnrollments = {};
    let enrollmentUserId = null;
    let couponInputs = {};
    let appliedCoupons = {};
    let couponMessages = {};
    let couponLoading = {};
    let courseRegistrationLoading = {};
    let courseActionMessages = {};
    let showPaymentModal = false;
    let selectedPaymentCourse = null;
    let paymentProofFile = null;
    let paymentProofNote = '';
    let paymentProofUploading = false;
    let unlockedCourseIds = new Set();
    let unlockedUserId = null;
    let inviteCodeInput = '';
    let inviteCodeMessage = '';
    let inviteCodeLoading = false;

    const defaultProgramConfig = {
        access_mode: 'open_access',
        pricing_type: 'free',
        price: 0,
        currency: 'KHR',
        capacity: null,
        registration_open_at: null,
        registration_close_at: null,
        learning_start_at: null,
        learning_end_at: null,
        payment_instructions: '',
        payment_provider: 'manual_qr',
        payment_account_name: '',
        payment_account_number: '',
        payment_qr_url: '',
        visibility: 'public',
        private_access_mode: 'invite_code',
        require_payment_approval: true,
        require_attendance: false,
        require_test_pass: true,
        require_evaluation: true,
        certificate_enabled: true
    };

    onMount(() => {
        const interval = setInterval(() => {
            currentTime = new Date();
            now = Date.now();
        }, 1000);
        return () => clearInterval(interval);
    });

    $: if (currentUser?.id && currentUser.id !== enrollmentUserId) {
        loadCourseEnrollments();
    }

    $: if (currentUser?.id && currentUser.id !== unlockedUserId) {
        loadInviteUnlocks();
    }

    $: visibleCourses = courses.filter(course => canViewCourse(course));

    // Extract unique categories from visible courses
    $: categories = ['All', ...new Set(visibleCourses.map(c => c.category).filter(Boolean))];
    
    // Filter courses based on search and category
    $: filteredCourses = visibleCourses.filter(c => {
        const matchesSearch = c.title.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === 'All' || c.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    // Filter for Featured Courses (Home Page)
    $: featuredCourses = visibleCourses.filter(c => c.is_featured);
    $: displayCourses = showAllCourses ? filteredCourses : (featuredCourses.length > 0 ? featuredCourses : visibleCourses.slice(0, 2));

    // Countdown timers — recomputes every second because `now` changes
    $: meetingCountdowns = Object.fromEntries(meetings.map(m => {
        if (!m.join_available_at) return [m.id, null];
        const diff = new Date(m.join_available_at).getTime() - now;
        if (diff <= 0) return [m.id, null];
        return [m.id, {
            days:    Math.floor(diff / 86400000),
            hours:   Math.floor((diff % 86400000) / 3600000),
            minutes: Math.floor((diff % 3600000) / 60000),
            seconds: Math.floor((diff % 60000) / 1000)
        }];
    }));

    function isPassed(courseId) {
        return passedCourses.includes(String(courseId));
    }

    function isEvalCompleted(courseId) {
        return evaluationCompletedCourses.includes(String(courseId));
    }

    function isRegistered(meetingId) {
        return registeredMeetingIds.includes(meetingId);
    }

    function programConfigFor(course) {
        return {
            ...defaultProgramConfig,
            ...(course?.cert_config?.program || {})
        };
    }

    function isPrivateCourse(course) {
        return programConfigFor(course).visibility === 'private';
    }

    function updateInviteCodeInput(value) {
        inviteCodeInput = String(value || '').replace(/\D/g, '').slice(0, 4);
    }

    function canViewCourse(course) {
        if (!isPrivateCourse(course)) return true;
        if (currentUser?.role === 'admin' || currentUser?.role === 'owner') return true;
        return unlockedCourseIds.has(String(course.id)) || Boolean(courseEnrollment(course));
    }

    function enrollmentStorageKey() {
        return currentUser?.id ? `course_enrollments_${currentUser.id}` : null;
    }

    async function loadInviteUnlocks() {
        unlockedUserId = currentUser?.id || null;
        unlockedCourseIds = new Set();
        if (!supabase || !unlockedUserId) return;

        const { data, error } = await supabase
            .from('course_invite_redemptions')
            .select('course_id')
            .eq('user_id', unlockedUserId);

        if (error) {
            if (error.code !== '42P01' && error.code !== 'PGRST205') {
                console.warn('Could not load invite unlocks:', error.message);
            }
            return;
        }
        unlockedCourseIds = new Set((data || []).map(row => String(row.course_id)));
    }

    async function redeemInviteCode() {
        const code = inviteCodeInput.trim();
        inviteCodeMessage = '';
        if (!code) {
            inviteCodeMessage = 'សូមបញ្ចូលលេខកូដវគ្គ';
            return;
        }
        if (!currentUser?.id) {
            inviteCodeMessage = 'សូមចូលគណនីជាមុនសិន';
            return;
        }

        inviteCodeLoading = true;
        try {
            const { data, error } = await supabase.rpc('redeem_course_invite_code', {
                p_invite_code: code
            });
            if (error) throw error;

            const invite = Array.isArray(data) ? data[0] : data;
            if (!invite?.course_id) {
                inviteCodeMessage = 'លេខកូដមិនត្រឹមត្រូវ ឬត្រូវបានបិទ';
                return;
            }

            unlockedCourseIds = new Set([...unlockedCourseIds, String(invite.course_id)]);
            inviteCodeInput = '';
            showAllCourses = true;
            searchTerm = '';
            selectedCategory = 'All';

            const unlockedCourse = courses.find(course => String(course.id) === String(invite.course_id));
            inviteCodeMessage = unlockedCourse
                ? `បានបើកវគ្គ "${unlockedCourse.title}" រួចរាល់`
                : 'បានបើកវគ្គរួចរាល់ សូមទាញ refresh ប្រសិនបើមិនទាន់ឃើញ';

            if (invite.auto_enroll && unlockedCourse && !courseEnrollment(unlockedCourse)) {
                await handleCourseRegistration(unlockedCourse);
            }
        } catch (error) {
            const message = error?.message || '';
            if (message.includes('not open yet')) {
                inviteCodeMessage = 'លេខកូដនេះមិនទាន់បើកប្រើទេ';
            } else if (message.includes('expired')) {
                inviteCodeMessage = 'លេខកូដនេះផុតកំណត់ហើយ';
            } else if (message.includes('usage limit')) {
                inviteCodeMessage = 'លេខកូដនេះប្រើគ្រប់ចំនួនកំណត់ហើយ';
            } else {
                inviteCodeMessage = 'លេខកូដមិនត្រឹមត្រូវ ឬត្រូវបានបិទ';
            }
        } finally {
            inviteCodeLoading = false;
        }
    }

    async function loadCourseEnrollments() {
        enrollmentUserId = currentUser?.id || null;
        if (typeof localStorage === 'undefined' || !enrollmentUserId) {
            courseEnrollments = {};
            return;
        }
        try {
            courseEnrollments = JSON.parse(localStorage.getItem(enrollmentStorageKey()) || '{}');
        } catch {
            courseEnrollments = {};
        }

        if (supabase) {
            const { data, error } = await supabase
                .from('course_enrollments')
                .select('course_id, status, pricing_type, price, original_price, discount_amount, final_price, currency, payment_status, coupon_code, payment_reference, payment_provider, payment_proof_url, payment_note, payment_submitted_at, registered_at')
                .eq('user_id', enrollmentUserId);

            if (!error && data) {
                const fromDb = {};
                data.forEach(row => {
                    fromDb[String(row.course_id)] = row;
                });
                const synced = { ...courseEnrollments };
                courses
                    .filter(course => isProgramEnrollmentCourse(course))
                    .forEach(course => {
                        delete synced[String(course.id)];
                    });
                saveCourseEnrollments({ ...synced, ...fromDb });
            } else if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
                console.warn('Could not load course enrollments:', error.message);
            }
        }
    }

    function saveCourseEnrollments(next) {
        courseEnrollments = next;
        const key = enrollmentStorageKey();
        if (typeof localStorage !== 'undefined' && key) {
            localStorage.setItem(key, JSON.stringify(courseEnrollments));
        }
    }

    function courseEnrollment(course) {
        return courseEnrollments[String(course.id)] || null;
    }

    function isCouponLoading(course) {
        return couponLoading[String(course.id)] === true;
    }

    function isCourseRegistrationLoading(course) {
        return courseRegistrationLoading[String(course.id)] === true;
    }

    function setCourseRegistrationLoading(course, value) {
        courseRegistrationLoading = {
            ...courseRegistrationLoading,
            [String(course.id)]: value
        };
    }

    function setCourseActionMessage(course, message, type = 'success') {
        courseActionMessages = {
            ...courseActionMessages,
            [String(course.id)]: { message, type }
        };
    }

    function courseActionMessage(course) {
        return courseActionMessages[String(course.id)] || null;
    }

    function courseEnrollmentStatus(course) {
        return courseEnrollment(course)?.status || null;
    }

    function isProgramEnrollmentCourse(course) {
        return programConfigFor(course).access_mode === 'program_enrollment';
    }

    function isCourseRegistered(course) {
        const status = courseEnrollmentStatus(course);
        return status === 'registered' || status === 'approved';
    }

    function isCoursePendingPayment(course) {
        return courseEnrollmentStatus(course) === 'pending_payment';
    }

    function isCourseRegistrationClosed(course) {
        const program = programConfigFor(course);
        const closeAt = program.registration_close_at ? new Date(program.registration_close_at).getTime() : null;
        return closeAt && now > closeAt;
    }

    function isCourseRegistrationNotOpen(course) {
        const program = programConfigFor(course);
        const openAt = program.registration_open_at ? new Date(program.registration_open_at).getTime() : null;
        return openAt && now < openAt;
    }

    function isLearningTimeLocked(course) {
        const program = programConfigFor(course);
        const startAt = program.learning_start_at ? new Date(program.learning_start_at).getTime() : null;
        return startAt && now < startAt;
    }

    function isCourseRegistrationRequired(course) {
        return isProgramEnrollmentCourse(course) && !isCourseRegistered(course);
    }

    function formatProgramPrice(program) {
        const amount = Number(program?.price || 0);
        return `${amount.toLocaleString()} ${program?.currency || 'KHR'}`;
    }

    function formatMoney(amount, currency = 'KHR') {
        return `${Number(amount || 0).toLocaleString()} ${currency || 'KHR'}`;
    }

    function couponFor(course) {
        return appliedCoupons[String(course.id)] || null;
    }

    function couponDiscountFor(course, program = programConfigFor(course)) {
        const coupon = couponFor(course);
        if (!coupon || program.pricing_type !== 'paid') return 0;
        const price = Number(program.price || 0);
        const value = Number(coupon.discount_value || 0);
        const discount = coupon.discount_type === 'percent'
            ? price * Math.min(Math.max(value, 0), 100) / 100
            : value;
        return Math.min(price, Math.max(0, discount));
    }

    function finalPriceFor(course, program = programConfigFor(course)) {
        return Math.max(0, Number(program.price || 0) - couponDiscountFor(course, program));
    }

    function generatePaymentReference(course) {
        const coursePart = String(course?.id || 'course').slice(0, 8).toUpperCase();
        const userPart = String(currentUser?.id || 'user').slice(0, 8).toUpperCase();
        const timePart = Date.now().toString(36).toUpperCase();
        return `CPD-${coursePart}-${userPart}-${timePart}`;
    }

    function openPaymentModal(course) {
        selectedPaymentCourse = course;
        const enrollment = courseEnrollment(course);
        paymentProofFile = null;
        paymentProofNote = enrollment?.payment_note || '';
        showPaymentModal = true;
    }

    function closePaymentModal() {
        if (paymentProofUploading) return;
        showPaymentModal = false;
        selectedPaymentCourse = null;
        paymentProofFile = null;
        paymentProofNote = '';
    }

    async function storageAuthHeaders() {
        const headers = { 'X-User-Id': currentUser?.id || '' };
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        return headers;
    }

    async function submitPaymentProof() {
        if (!selectedPaymentCourse || !currentUser?.id || !supabase) return;
        if (!paymentProofFile) return alert('សូម upload រូបបង្កាន់ដៃ ឬ PDF មុនសិន។');

        const enrollment = courseEnrollment(selectedPaymentCourse);
        if (!enrollment) return alert('មិនទាន់មានការចុះឈ្មោះសម្រាប់វគ្គនេះទេ។');

        paymentProofUploading = true;
        try {
            const safeName = paymentProofFile.name.replace(/[^a-zA-Z0-9.-]/g, '_');
            const formData = new FormData();
            formData.append('file', new File([paymentProofFile], safeName, { type: paymentProofFile.type }));
            formData.append('folder', 'payment_proofs');

            const uploadRes = await fetch('/api/storage', {
                method: 'POST',
                headers: await storageAuthHeaders(),
                body: formData
            });
            const uploadData = await uploadRes.json();
            if (!uploadRes.ok) throw new Error(uploadData.error || 'Upload failed');

            const submittedAt = new Date().toISOString();
            const updates = {
                payment_proof_url: uploadData.publicUrl,
                payment_note: paymentProofNote || null,
                payment_submitted_at: submittedAt,
                payment_provider: programConfigFor(selectedPaymentCourse).payment_provider || 'manual_qr',
                updated_at: submittedAt
            };

            const { error } = await supabase
                .from('course_enrollments')
                .update(updates)
                .eq('course_id', selectedPaymentCourse.id)
                .eq('user_id', currentUser.id);

            if (error) throw new Error(error.message);

            saveCourseEnrollments({
                ...courseEnrollments,
                [String(selectedPaymentCourse.id)]: {
                    ...enrollment,
                    ...updates
                }
            });

            setCourseActionMessage(selectedPaymentCourse, 'បានផ្ញើបង្កាន់ដៃរួច។ សូមរង់ចាំ Admin approve។', 'success');
            closePaymentModal();
        } catch (error) {
            alert('មានបញ្ហាក្នុងការ upload បង្កាន់ដៃ: ' + error.message);
        } finally {
            paymentProofUploading = false;
        }
    }

    async function applyCoupon(course) {
        const code = (couponInputs[String(course.id)] || '').trim().toUpperCase();
        const program = programConfigFor(course);
        if (!code) {
            couponMessages = { ...couponMessages, [String(course.id)]: 'សូមបញ្ចូល coupon code' };
            return;
        }
        if (!supabase) {
            couponMessages = { ...couponMessages, [String(course.id)]: 'មិនទាន់ភ្ជាប់ Server សូមព្យាយាមម្ដងទៀត' };
            return;
        }

        couponLoading = { ...couponLoading, [String(course.id)]: true };
        couponMessages = { ...couponMessages, [String(course.id)]: 'កំពុងពិនិត្យ coupon...' };
        try {
            const { data, error } = await supabase
                .from('course_coupons')
                .select('*')
                .eq('code', code)
                .eq('is_active', true)
                .maybeSingle();

            if (error) {
                if (error.code === '42P01' || error.code === 'PGRST205') {
                    couponMessages = { ...couponMessages, [String(course.id)]: 'Coupon មិនទាន់បានបើកប្រើក្នុង database' };
                } else {
                    couponMessages = { ...couponMessages, [String(course.id)]: error.message };
                }
                return;
            }

            const invalid = !data
                || (data.course_id && String(data.course_id) !== String(course.id))
                || (data.currency && data.currency !== program.currency)
                || (data.starts_at && new Date(data.starts_at).getTime() > now)
                || (data.expires_at && new Date(data.expires_at).getTime() < now)
                || (data.max_uses !== null && data.max_uses !== undefined && Number(data.used_count || 0) >= Number(data.max_uses));

            if (invalid) {
                appliedCoupons = { ...appliedCoupons, [String(course.id)]: null };
                couponMessages = { ...couponMessages, [String(course.id)]: 'Coupon មិនត្រឹមត្រូវ ឬផុតកំណត់' };
                return;
            }

            appliedCoupons = { ...appliedCoupons, [String(course.id)]: data };
            couponMessages = {
                ...couponMessages,
                [String(course.id)]: `បានបញ្ចុះ ${formatMoney(couponDiscountFor(course, program), program.currency)}`
            };
        } finally {
            couponLoading = { ...couponLoading, [String(course.id)]: false };
        }
    }

    async function saveCourseEnrollmentToDb(course, enrollment) {
        if (!supabase || !currentUser?.id) return false;

        const { error } = await supabase
            .from('course_enrollments')
            .upsert({
                course_id: course.id,
                user_id: currentUser.id,
                status: enrollment.status,
                pricing_type: enrollment.pricing_type,
                price: enrollment.price,
                original_price: enrollment.original_price,
                discount_amount: enrollment.discount_amount,
                final_price: enrollment.final_price,
                currency: enrollment.currency,
                payment_status: enrollment.payment_status || (enrollment.status === 'pending_payment' ? 'pending' : 'not_required'),
                coupon_id: enrollment.coupon_id || null,
                coupon_code: enrollment.coupon_code || null,
                payment_reference: enrollment.payment_reference || null,
                payment_provider: enrollment.payment_provider || null,
                payment_proof_url: enrollment.payment_proof_url || null,
                payment_note: enrollment.payment_note || null,
                payment_submitted_at: enrollment.payment_submitted_at || null,
                approved_at: enrollment.approved_at || null,
                registered_at: enrollment.registered_at
            }, { onConflict: 'course_id,user_id' });

        if (error) {
            if (error.code !== '42P01' && error.code !== 'PGRST205') {
                console.warn('Could not save course enrollment:', error.message);
            }
            return false;
        }

        return true;
    }

    async function handleCourseRegistration(course) {
        if (!currentUser?.id) {
            return alert('សូមចូលគណនីជាមុនសិន។');
        }
        if (isCourseRegistrationLoading(course)) return;

        const program = programConfigFor(course);
        if (!isProgramEnrollmentCourse(course)) return;

        if (isCourseRegistrationNotOpen(course)) {
            return alert('ការចុះឈ្មោះវគ្គនេះមិនទាន់បើកទេ។');
        }
        if (isCourseRegistrationClosed(course)) {
            return alert('ការចុះឈ្មោះវគ្គនេះបានបិទហើយ។');
        }

        const isPaid = program.pricing_type === 'paid';
        const originalPrice = Number(program.price || 0);
        const discountAmount = isPaid ? couponDiscountFor(course, program) : 0;
        const finalPrice = isPaid ? finalPriceFor(course, program) : 0;
        const coupon = couponFor(course);
        const needsPayment = isPaid && finalPrice > 0 && program.require_payment_approval;
        const autoApprovedPayment = isPaid && !needsPayment;
        const status = needsPayment ? 'pending_payment' : autoApprovedPayment ? 'approved' : 'registered';
        const paymentReference = needsPayment ? generatePaymentReference(course) : null;
        const enrollment = {
            status,
            pricing_type: program.pricing_type,
            price: finalPrice,
            original_price: originalPrice,
            discount_amount: discountAmount,
            final_price: finalPrice,
            currency: program.currency,
            payment_status: needsPayment ? 'pending' : autoApprovedPayment ? 'approved' : 'not_required',
            coupon_id: coupon?.id || null,
            coupon_code: coupon?.code || null,
            payment_reference: paymentReference,
            payment_provider: isPaid ? (program.payment_provider || 'manual_qr') : null,
            approved_at: autoApprovedPayment ? new Date().toISOString() : null,
            registered_at: new Date().toISOString()
        };

        const next = {
            ...courseEnrollments,
            [String(course.id)]: enrollment
        };

        setCourseRegistrationLoading(course, true);
        saveCourseEnrollments(next);
        setCourseActionMessage(course, 'បានចុះឈ្មោះរួច កំពុងរក្សាទុកទៅ Server...', 'info');
        await tick();

        if (status === 'pending_payment') {
            setCourseActionMessage(course, 'បានចុះឈ្មោះរួច សូមបង់ប្រាក់ និង upload បង្កាន់ដៃ', 'success');
            openPaymentModal(course);
        }

        const saved = await saveCourseEnrollmentToDb(course, enrollment);
        if (saved && coupon?.id && supabase) {
            await supabase
                .from('course_coupons')
                .update({ used_count: Number(coupon.used_count || 0) + 1, updated_at: new Date().toISOString() })
                .eq('id', coupon.id);
        }
        setCourseRegistrationLoading(course, false);

        if (!saved) {
            setCourseActionMessage(course, 'បានបង្ហាញថាចុះឈ្មោះរួចក្នុងទូរស័ព្ទនេះ ប៉ុន្តែមិនទាន់រក្សាទុកទៅ Server។ សូមពិនិត្យ internet ឬប្រាប់ Admin។', 'warning');
            return;
        }

        if (status === 'pending_payment') return;
        if (autoApprovedPayment) {
            setCourseActionMessage(course, `បានចុះឈ្មោះ និង approve ការបង់ប្រាក់រួចរាល់។${discountAmount > 0 ? ` បញ្ចុះតម្លៃ: ${formatMoney(discountAmount, program.currency)}` : ''}`, 'success');
        } else {
            setCourseActionMessage(course, 'បានចុះឈ្មោះជោគជ័យ។ អ្នកអាចចូលរៀនបាននៅពេលដល់ថ្ងៃរៀន។', 'success');
        }
    }

    function isJoinAvailable(meeting) {
        // null countdown means no gate set, OR gate has already passed → joinable
        return !meetingCountdowns[meeting.id];
    }

    function courseMeetingsFor(course) {
        return meetings
            .filter(meeting => meeting.course_id && String(meeting.course_id) === String(course.id))
            .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
    }

    function nextCourseMeetingFor(course) {
        const courseMeetings = courseMeetingsFor(course);
        if (!courseMeetings.length) return null;
        const recentWindow = now - (6 * 60 * 60 * 1000);
        return courseMeetings.find(meeting => new Date(meeting.scheduled_at).getTime() >= recentWindow) || courseMeetings[0];
    }

    function openCourseMeeting(meeting) {
        if (!meeting?.meeting_url) return alert('វគ្គនេះមិនទាន់មានតំណ Zoom/Google Meet ទេ។');
        dispatch('recordMeetingAttendance', meeting);
        window.open(meeting.meeting_url, '_blank');
    }

    function getTimeBasedGreeting() {
        const hour = new Date().getHours();
        if (hour < 12) return "អរុណសួស្ដី"; // ព្រឹក (Morning)
        if (hour < 17) return "ទិវាសួស្ដី"; // ថ្ងៃ (Afternoon)
        return "សាយណ្ហសួស្ដី"; // ល្ងាច/យប់ (Evening)
    }

    function getKhmerDate() {
        return new Date().toLocaleDateString('km-KH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }

    function handleFileChange(e, type) {
        dispatch('startCropping', { event: e, type });
    }

    function getRemainingTime(cooldown, current) {
        const end = cooldown?.end || cooldown; // ទទួលយកទាំង Object និងលេខធម្មតា
        const diff = end - current;
        if (diff <= 0) return null;
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        if (h > 0) return `${h}h ${m}m`;
        const s = Math.floor((diff % 60000) / 1000);
        return `${m}m ${s}s`;
    }

    async function logAccessAttempt(courseId, reason) {
        if (!currentUser || !supabase) return;
        const { error } = await supabase.from('access_attempts').insert({
            user_id: currentUser.id,
            course_id: courseId,
            reason: reason
        });
        if (error && error.code !== '42P01' && error.code !== 'PGRST205') {
            console.warn('Could not log access attempt:', error.message);
        }
    }

    async function handleCourseClick(course) {
        if (isLocked(course)) {
            if (isCourseRegistrationRequired(course)) {
                logAccessAttempt(course.id, 'registration_required');
                if (isCoursePendingPayment(course)) return alert('វគ្គនេះកំពុងរង់ចាំ Admin approve ការបង់ប្រាក់។');
                return alert('សូមចុះឈ្មោះវគ្គនេះជាមុនសិន។');
            }
            if (isLearningTimeLocked(course)) {
                logAccessAttempt(course.id, 'learning_not_started');
                const start = new Date(programConfigFor(course).learning_start_at).toLocaleString('km-KH');
                return alert(`វគ្គនេះនឹងបើករៀននៅ ${start}`);
            }
            if (course.has_pre_test && !preTestDoneCourses.includes(String(course.id))) {
                logAccessAttempt(course.id, 'pre_test_required');
                return alert("សូមធ្វើតេស្តដើមវគ្គ (Pre-test) ជាមុនសិន។");
            }
            if (course.has_pre_test && !postTestAttemptedCourses.includes(String(course.id))) {
                logAccessAttempt(course.id, 'post_test_required');
                return alert("សូមធ្វើតេស្តបញ្ចប់ (Post-test) ជាមុនសិន។");
            }
            if (course.lessons_enabled === false) {
                logAccessAttempt(course.id, 'lessons_disabled');
                return alert("មេរៀនត្រូវបានបិទ។");
            }
            return;
        }

        selectedCourseForPlayer = course;

        if (!supabase) {
            console.error("Supabase client is missing. Ensure <HomeScreen supabase={supabase} /> is passed in the parent component.");
            alert("System Error: Database connection missing. Please refresh or contact support.");
            return;
        }

        // Fetch all lessons for the course
        const { data, error } = await supabase
            .from('lessons')
            .select('*')
            .eq('course_id', course.id)
            .order('sort_order', { ascending: true });

        if (error) {
            alert("Error loading lessons: " + error.message);
            return;
        }

        lessonsForPlayer = data || [];

        if (lessonsForPlayer.length === 0 && course.pdf_url) {
            // Fallback to course PDF if no lessons are defined
            lessonsForPlayer = [{ id: 'fallback', title: course.title, url: course.pdf_url, duration: course.duration }];
        } else if (lessonsForPlayer.length === 0) {
            return alert("This course has no lessons yet.");
        }

        lessonForPlayer = lessonsForPlayer[0];
        showLessonPlayer = true;
    }

    function isLocked(course) {
        if (isCourseRegistrationRequired(course)) return true;
        if (isProgramEnrollmentCourse(course) && isLearningTimeLocked(course)) return true;
        if (course.has_pre_test && !preTestDoneCourses.includes(String(course.id))) return true;
        if (course.has_pre_test && !postTestAttemptedCourses.includes(String(course.id))) return true;
        if (course.lessons_enabled === false) return true;
        return false;
    }

    function handleAvatarError(e) {
        e.target.onerror = null;
        e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser?.full_name || 'User')}&background=random`;
    }

    function handleThumbnailError(e) {
        e.target.onerror = null;
        e.target.src = 'https://placehold.co/600x400?text=No+Image';
    }
</script>

{#if showLessonPlayer}
    <LessonPlayer 
        course={selectedCourseForPlayer} 
        lesson={lessonForPlayer}
        lessons={lessonsForPlayer}
        supabase={supabase}
        currentUser={currentUser}
        on:close={() => showLessonPlayer = false}
    />
{/if}

<div class="pb-24 bg-blue-50 min-h-screen">
    <!-- Header / User Stats -->
    <div class="bg-blue-50 p-4 sticky top-0 z-20 shadow-sm border-b border-blue-100">
        <div class="flex justify-between items-center">
            <button class="flex items-center gap-3 cursor-pointer bg-transparent border-0 p-0 text-left hover:opacity-80 transition-opacity" on:click={() => dispatch('openProfileModal')}>
                <div class="avatar placeholder relative">
                    <div class="bg-primary text-white rounded-full w-10 h-10 flex items-center justify-center text-xl font-bold shadow-md ring-2 ring-primary ring-offset-2 overflow-hidden">
                        {#if currentUser && currentUser.avatar_url}
                            <img src={currentUser.avatar_url} alt="Avatar" on:error={handleAvatarError} />
                        {:else}
                            <span>{currentUser?.full_name?.[0] || 'U'}</span>
                        {/if}
                        {#if isUploading}
                            <div class="absolute inset-0 flex items-center justify-center bg-black/40 z-50">
                                <span class="loading loading-spinner loading-xs text-white"></span>
                            </div>
                        {/if}
                    </div>
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <h2 class="font-bold text-lg leading-tight text-base-content">{currentUser?.full_name || 'Guest User'}</h2>
                        <span class="bg-white text-gray-600 text-[10px] px-1.5 py-0.5 rounded border border-gray-300 shadow-sm font-bold flex items-center">
                            ✏️ កែប្រែ
                        </span>
                    </div>
                    {#if currentUser?.name_latin}
                        <div class="text-xs font-medium text-gray-500 mt-0.5">{currentUser.name_latin}</div>
                    {/if}
                    <div class="flex items-center gap-2 text-xs text-base-content/70 mt-0.5">
                        {#if tutorials && tutorials.length > 0}
                            <button on:click|stopPropagation={() => showTutorialModal = true} class="text-blue-600 hover:text-blue-800 bg-blue-100 hover:bg-blue-200 px-2 py-0.5 rounded-full flex items-center gap-1 font-bold transition-colors">
                                💡 របៀបប្រើប្រាស់
                            </button>
                        {/if}
                    </div>
                </div>
            </button>
            <div class="flex gap-1">
                <button class="rounded-full w-8 h-8 bg-white hover:bg-blue-100 shadow-sm flex items-center justify-center cursor-pointer border-0 outline-none" on:click={() => dispatch('toggleLanguage')}>
                    <img src={currentLang === 'km' ? 'https://flagcdn.com/w40/kh.png' : 'https://flagcdn.com/w40/gb.png'} alt="Language" class="w-6 h-6 object-cover rounded-full" on:error={(e) => e.target.style.display = 'none'} />
                    <span class="text-xs font-bold hidden" style="display: none;">{currentLang === 'km' ? 'KH' : 'EN'}</span>
                </button>
                <button class="rounded-full w-8 h-8 hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none" on:click={() => dispatch('shareApp')} title="ចែករំលែក">
                    <span class="text-xl">📢</span>
                </button>
                {#if currentUser?.role === 'admin' || currentUser?.role === 'owner'}
                    <button class="rounded-full w-8 h-8 hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none" on:click={() => dispatch('openAdmin')}>
                        <span class="text-xl">⚙️</span>
                    </button>
                {/if}
            </div>
        </div>

    </div>

    <div class="p-4 space-y-6">
        <!-- Install App Banner -->
        <PwaInstallBanner {t} />

        <!-- Evaluation Form Banner -->
        {#if evaluationFormUrl}
            <a
                href={evaluationFormUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-3 bg-gradient-to-r from-orange-500 to-yellow-400 text-white rounded-2xl p-4 shadow-lg shadow-orange-200 active:scale-95 transition-transform no-underline"
            >
                <div class="flex-shrink-0 w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-2xl">
                    😊
                </div>
                <div class="flex-1 min-w-0">
                    <div class="font-bold text-base leading-tight">ប្រព័ន្ធវាយតម្លៃភាពពេញចិត្ត</div>
                    <div class="text-sm text-white/90 mt-0.5">របស់សមាជិកគណៈគិលានុបដ្ឋាកកម្ពុជា (CCN)</div>
                </div>
                <div class="flex-shrink-0 text-white/80 text-xl">›</div>
            </a>
        {/if}

        <div class="bg-white border border-blue-100 rounded-2xl p-3 shadow-sm">
            <div class="flex flex-col sm:flex-row sm:items-center gap-2">
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-black text-gray-800">មានលេខកូដវគ្គសិក្សា?</div>
                    <div class="text-xs text-gray-500 mt-0.5">បញ្ចូលលេខកូដដើម្បីបើកវគ្គ private</div>
                </div>
                <div class="flex gap-2 w-full sm:w-auto">
                    <input
                        value={inviteCodeInput}
                        on:input={(e) => updateInviteCodeInput(e.target.value)}
                        on:keydown={(e) => e.key === 'Enter' && redeemInviteCode()}
                        inputmode="numeric"
                        pattern="[0-9]*"
                        maxlength="4"
                        class="input input-sm input-bordered bg-white flex-1 sm:w-40 font-mono text-lg tracking-widest"
                        placeholder="1234"
                    />
                    <button class="btn btn-sm btn-primary" on:click={redeemInviteCode} disabled={inviteCodeLoading}>
                        {inviteCodeLoading ? '...' : 'បើកវគ្គ'}
                    </button>
                </div>
            </div>
            {#if inviteCodeMessage}
                <div class="text-xs mt-2 {inviteCodeMessage.startsWith('បាន') ? 'text-success' : 'text-error'}">{inviteCodeMessage}</div>
            {/if}
        </div>

        <!-- Courses Section -->
        <div>
            {#if !showAllCourses}
                <div class="flex justify-between items-center mb-4">
                    <h3 class="font-bold text-lg flex items-center gap-2 text-base-content">
                        {t('featured_courses')}
                    </h3>
                    <button class="btn btn-sm btn-ghost text-primary" on:click={() => showAllCourses = true}>
                        {t('view_all')} ({courses.length}) →
                    </button>
                </div>
            {:else}
                <div class="flex items-center gap-2 mb-4 cursor-pointer text-base-content" on:click={() => { showAllCourses = false; searchTerm = ''; }}>
                    <button class="btn btn-sm btn-circle btn-ghost">←</button>
                    <h3 class="font-bold text-lg text-gray-800">{t('all_courses')}</h3>
                </div>
            {/if}

            {#if showAllCourses}
            <!-- Search & Filter -->
            <div class="flex flex-col gap-3 mb-6">
                <div class="relative">
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
                    <input 
                        type="text" 
                        bind:value={searchTerm} 
                        placeholder={t('search_placeholder')} 
                        class="input input-bordered w-full pl-10 bg-white shadow-sm focus:ring-2 focus:ring-primary/20" 
                    />
                </div>
                {#if categories.length > 1}
                    <div class="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        {#each categories as cat}
                            <button 
                            class="btn btn-sm rounded-full whitespace-nowrap border-none {selectedCategory === cat ? 'btn-primary shadow-md shadow-primary/30' : 'btn-ghost bg-white shadow-sm text-base-content'}"
                                on:click={() => selectedCategory = cat}
                            >
                                {cat}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
            {/if}

            <!-- Course List -->
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" in:fade>
                {#each displayCourses as course (course.id)}
                    {@const program = programConfigFor(course)}
                    {@const courseMeeting = nextCourseMeetingFor(course)}
                    <div class="card bg-white shadow-sm hover:shadow-lg transition-all duration-200 overflow-hidden group rounded-2xl cursor-pointer border border-gray-200" on:click={() => handleCourseClick(course)}>
                        <figure class="h-44 bg-gray-100 relative overflow-hidden">
                            {#if course.thumbnail_url}
                                <img src={course.thumbnail_url} alt={course.title} loading="lazy" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" on:error={handleThumbnailError} />
                            {:else}
                                <div class="flex items-center justify-center w-full h-full text-5xl bg-primary/5 text-primary">📚</div>
                            {/if}
                            
                            <!-- Lock Overlay -->
                            {#if isLocked(course)}
                                <div class="absolute inset-0 bg-black/40 flex items-center justify-center z-10">
                                    <div class="bg-white p-3 rounded-full shadow-lg">
                                        <span class="text-3xl drop-shadow-md">🔒</span>
                                    </div>
                                </div>
                            {/if}

                            <!-- Status Badges -->
                            <div class="absolute top-2 right-2 flex flex-col gap-1 items-end">
                                {#if !course.is_published}
                                    <div class="badge badge-warning gap-1 shadow-sm font-bold border-none">
                                        {t('draft')}
                                    </div>
                                {/if}
                                {#if isPassed(course.id)}
                                    <div class="badge badge-success gap-1 shadow-sm text-white font-bold border-none">
                                        {t('completed')}
                                    </div>
                                {/if}
                                {#if course.category}
                                    <div class="badge badge-ghost bg-white text-xs shadow-sm">
                                        {course.category}
                                    </div>
                                {/if}
                                {#if isProgramEnrollmentCourse(course)}
                                    <div class="badge {isCourseRegistrationLoading(course) ? 'badge-info text-white' : isCourseRegistered(course) ? 'badge-success text-white' : isCoursePendingPayment(course) ? 'badge-warning' : 'badge-primary'} text-xs shadow-sm border-none">
                                        {#if isCourseRegistrationLoading(course)}
                                            កំពុងរក្សាទុក...
                                        {:else if isCourseRegistered(course)}
                                            បានចុះឈ្មោះ
                                        {:else if isCoursePendingPayment(course)}
                                            រង់ចាំ approve
                                        {:else if program.pricing_type === 'paid'}
                                            {formatProgramPrice(program)}
                                        {:else}
                                            ចុះឈ្មោះ Free
                                        {/if}
                                    </div>
                                {/if}
                            </div>
                            
                            <div class="absolute bottom-2 right-2 badge badge-neutral text-white text-xs">
                                ⏱️ {course.duration || t('duration_not_set')}
                            </div>
                        </figure>
                        
                        <div class="card-body p-4">
                            <div class="flex justify-between items-start gap-2">
                                <h2 class="card-title text-base font-bold line-clamp-2 min-h-[3rem] text-base-content leading-snug">{course.title}</h2>
                            </div>
                            <p class="text-xs text-base-content line-clamp-2 mb-4 h-8">{course.description || t('no_description')}</p>

                            {#if courseMeeting}
                                <div class="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 mb-3 text-xs text-blue-900">
                                    <div class="font-bold flex items-center justify-between gap-2">
                                        <span>កាលវិភាគរៀន</span>
                                        <span class="badge badge-xs badge-info text-white">Zoom/Meet</span>
                                    </div>
                                    <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-blue-800">
                                        <span>🗓️ {new Date(courseMeeting.scheduled_at).toLocaleDateString('km-KH')}</span>
                                        <span>⏰ {new Date(courseMeeting.scheduled_at).toLocaleTimeString('km-KH', {hour: '2-digit', minute:'2-digit'})}</span>
                                    </div>
                                </div>
                            {/if}
                            
                            <div class="card-actions flex-col gap-2 mt-auto">
                                {#if courseActionMessage(course)}
                                    {@const actionMsg = courseActionMessage(course)}
                                    <div class="w-full rounded-xl border px-3 py-2 text-xs font-bold text-center
                                        {actionMsg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : actionMsg.type === 'warning' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : 'bg-blue-50 border-blue-200 text-blue-700'}">
                                        {actionMsg.message}
                                    </div>
                                {/if}

                                {#if courseMeeting && !isCourseRegistrationRequired(course) && !(isProgramEnrollmentCourse(course) && isLearningTimeLocked(course))}
                                    <div class="w-full relative z-10" on:click|stopPropagation>
                                        {#if isJoinAvailable(courseMeeting)}
                                            <button class="btn btn-success btn-sm w-full text-white shadow-md shadow-success/20" on:click={() => openCourseMeeting(courseMeeting)} disabled={!courseMeeting.meeting_url}>
                                                🎥 ចូលរៀន / ចូលប្រជុំ
                                            </button>
                                        {:else if meetingCountdowns[courseMeeting.id]}
                                            {@const cd = meetingCountdowns[courseMeeting.id]}
                                            <button class="btn btn-outline btn-sm w-full bg-gray-100 text-gray-500 border-gray-300" disabled>
                                                🔒 ចូលរៀនបាននៅ {String(cd.days).padStart(2,'0')}ថ្ងៃ {String(cd.hours).padStart(2,'0')}ម៉ោង {String(cd.minutes).padStart(2,'0')}នាទី
                                            </button>
                                        {/if}
                                    </div>
                                {/if}
                                {#if isCourseRegistrationRequired(course)}
                                    <div class="w-full relative z-10" on:click|stopPropagation>
                                        {#if isCoursePendingPayment(course)}
                                            <button class="btn btn-warning btn-sm w-full text-white" on:click={() => openPaymentModal(course)}>
                                                {courseEnrollment(course)?.payment_proof_url ? '📤 មើល QR / ផ្ញើបង្កាន់ដៃម្ដងទៀត' : '💳 បង់ប្រាក់ / Upload បង្កាន់ដៃ'}
                                            </button>
                                            <p class="text-[11px] text-warning mt-1 text-center">
                                                {#if isCourseRegistrationLoading(course)}
                                                    កំពុងរក្សាទុកទៅ Server...
                                                {:else}
                                                    {courseEnrollment(course)?.payment_proof_url ? 'បានផ្ញើបង្កាន់ដៃរួច សូមរង់ចាំការអនុម័ត' : 'ស្កេន QR ហើយ upload បង្កាន់ដៃ'}
                                                {/if}
                                            </p>
                                        {:else if isCourseRegistrationClosed(course)}
                                            <button class="btn btn-outline btn-sm w-full bg-gray-100 text-red-500 border-gray-300" disabled>
                                                ការចុះឈ្មោះបានបិទ
                                            </button>
                                        {:else if isCourseRegistrationNotOpen(course)}
                                            <button class="btn btn-outline btn-sm w-full bg-gray-100 text-gray-500 border-gray-300" disabled>
                                                មិនទាន់បើកចុះឈ្មោះ
                                            </button>
                                        {:else}
                                            {#if program.pricing_type === 'paid'}
                                                <div class="w-full mb-2">
                                                    <div class="flex gap-2">
                                                        <input
                                                            class="input input-bordered input-sm flex-1 bg-white"
                                                            placeholder="Coupon code"
                                                            value={couponInputs[String(course.id)] || ''}
                                                            on:input={(e) => couponInputs = { ...couponInputs, [String(course.id)]: e.target.value }}
                                                        />
                                                        <button class="btn btn-outline btn-sm" on:click={() => applyCoupon(course)} disabled={isCouponLoading(course)}>
                                                            {isCouponLoading(course) ? '...' : 'Apply'}
                                                        </button>
                                                    </div>
                                                    {#if couponMessages[String(course.id)]}
                                                        <p class="text-[11px] mt-1 text-center {couponFor(course) ? 'text-success' : 'text-error'}">
                                                            {couponMessages[String(course.id)]}
                                                        </p>
                                                    {/if}
                                                    {#if couponFor(course)}
                                                        <p class="text-[11px] mt-1 text-center text-gray-500">
                                                            តម្លៃត្រូវបង់: <strong>{formatMoney(finalPriceFor(course, program), program.currency)}</strong>
                                                            <span class="line-through ml-1">{formatProgramPrice(program)}</span>
                                                        </p>
                                                    {/if}
                                                </div>
                                            {/if}
                                            <button class="btn btn-primary btn-sm w-full shadow-md shadow-primary/20" on:click={() => handleCourseRegistration(course)} disabled={isCourseRegistrationLoading(course)}>
                                                {isCourseRegistrationLoading(course) ? 'កំពុងចុះឈ្មោះ...' : program.pricing_type === 'paid' ? `ចុះឈ្មោះ និងបង់ ${formatMoney(finalPriceFor(course, program), program.currency)}` : 'ចុះឈ្មោះ Free'}
                                            </button>
                                        {/if}
                                    </div>
                                {:else if isProgramEnrollmentCourse(course) && isLearningTimeLocked(course)}
                                    <div class="w-full relative z-10" on:click|stopPropagation>
                                        <button class="btn btn-outline btn-sm w-full bg-gray-100 text-gray-500 border-gray-300" disabled>
                                            ⏳ រង់ចាំថ្ងៃរៀន {getRemainingTime(new Date(program.learning_start_at).getTime(), now)}
                                        </button>
                                    </div>
                                {:else if course.has_pre_test && !preTestDoneCourses.includes(String(course.id))}
                                    <!-- បង្ហាញ Pre-test និងបិទមេរៀន -->
                                    <button class="btn btn-primary btn-sm w-full shadow-md shadow-primary/20 relative z-10" on:click|stopPropagation={() => dispatch('startQuiz', {id: course.id, type: 'pre'})}>
                                        {t('take_pre_test')}
                                    </button>
                                    <div class="w-full" on:click|stopPropagation>
                                        <button class="btn btn-outline btn-sm w-full bg-gray-100 text-gray-400 border-gray-300" disabled>
                                            {t('locked_pre_test')}
                                        </button>
                                    </div>
                                {:else}
                                    <!-- បង្ហាញមេរៀន និង Post-test -->
                                    {#if course.lessons_enabled === false}
                                        <div class="w-full" on:click|stopPropagation>
                                            <button class="btn btn-outline btn-sm w-full bg-gray-100 text-gray-400 border-gray-300" disabled>
                                                {t('lessons_disabled')}
                                            </button>
                                        </div>
                                    {:else}
                                        <button class="btn btn-primary btn-sm w-full shadow-md shadow-primary/20 relative z-10" on:click|stopPropagation={() => handleCourseClick(course)}>
                                            {t('start_lesson')}
                                        </button>
                                    {/if}
                                    <div class="w-full">
                                        {#if isPassed(course.id)}
                                            <div class="w-full" on:click|stopPropagation>
                                                <button class="btn btn-disabled btn-sm bg-gray-100 text-gray-400 border-none opacity-50 w-full" disabled>
                                                    {t('passed')}
                                                </button>
                                            </div>
                                            {#if course.evaluation_form_id && !isEvalCompleted(course.id) && !evalDismissedCourses.includes(String(course.id))}
                                                <div class="flex flex-col gap-1 mt-2 relative z-10" on:click|stopPropagation>
                                                    <button class="btn btn-info btn-sm w-full text-white shadow-sm" on:click|stopPropagation={() => { dispatch('dismissEvalCourse', course.id); dispatch('openEvaluationForm', course); }}>
                                                        📝 សូមវាយតម្លៃមុនទាញលិខិតបញ្ជាក់
                                                    </button>
                                                    <button class="btn btn-warning btn-sm w-full text-white shadow-sm opacity-40 cursor-not-allowed" disabled title="សូមបំពេញការវាយតម្លៃជាមុន">
                                                        🔒 {t('get_certificate')}
                                                    </button>
                                                </div>
                                            {:else}
                                                <div class="flex gap-1 mt-2 relative z-10" on:click|stopPropagation>
                                                    <button class="btn btn-warning btn-sm flex-1 text-white shadow-sm" on:click|stopPropagation={() => dispatch('generateCertificate', course)}>
                                                        {t('get_certificate')}
                                                    </button>
                                                    <!-- Share certificate button removed -->
                                                </div>
                                            {/if}
                                        {:else}
                                            {@const cooldown = courseCooldowns[course.id]}
                                            {@const remaining = cooldown ? getRemainingTime(cooldown, now) : null}
                                            <div class="flex gap-2 w-full">
                                                {#if remaining}
                                                    {@const progress = cooldown.total ? Math.min(100, Math.max(0, ((cooldown.end - now) / cooldown.total) * 100)) : 100}
                                                    <div class="flex-1 relative z-10" on:click|stopPropagation>
                                                        <button class="btn btn-sm w-full overflow-hidden border-gray-300 text-gray-700 bg-white" style="cursor: not-allowed;" disabled>
                                                            <!-- Progress Bar (ពណ៌ប្រផេះរត់ថយក្រោយ) -->
                                                            <div class="absolute inset-0 bg-gray-300 origin-left transition-all duration-1000 ease-linear" style="width: {progress}%;"></div>
                                                            <!-- អក្សរ (នៅពីលើ Progress Bar) -->
                                                            <span class="relative z-20 font-mono font-bold text-xs">⏳ {remaining}</span>
                                                        </button>
                                                    </div>
                                                {:else}
                                                    <!-- Post-test Delay Check -->
                                                    {@const fixedDate = course.post_test_fixed_date ? new Date(course.post_test_fixed_date).getTime() : null}
                                                    {@const unlockTime = fixedDate}
                                                    {@const autoCloseDate = course.post_test_auto_close_date ? new Date(course.post_test_auto_close_date).getTime() : null}
                                                    
                                                    {@const postTestLocked = unlockTime > 0 && now < unlockTime}
                                                    {@const postTestClosed = autoCloseDate > 0 && now > autoCloseDate}
                                                    {@const remainingPostTest = postTestLocked ? getRemainingTime(unlockTime, now) : null}

                                                    {#if postTestClosed}
                                                        <div class="flex-1 relative z-10" on:click|stopPropagation>
                                                            <button class="btn btn-outline btn-sm w-full bg-gray-100 text-red-500 border-gray-300 text-xs" disabled>
                                                                {t('closed')}
                                                            </button>
                                                        </div>
                                                    {:else if postTestLocked}
                                                        <div class="flex-1 relative z-10" on:click|stopPropagation>
                                                            <button class="btn btn-outline btn-sm w-full bg-gray-100 text-gray-500 border-gray-300 text-xs" disabled>
                                                                {t('post_test_wait')} {remainingPostTest}
                                                            </button>
                                                        </div>
                                                    {:else}
                                                        <button class="btn btn-outline btn-accent btn-sm flex-1 relative z-10" on:click|stopPropagation={() => dispatch('startQuiz', {id: course.id, type: 'post'})}>
                                                            {t('take_post_test')}
                                                        </button>
                                                    {/if}
                                                {/if}
                                                <button class="btn btn-outline btn-accent btn-sm px-3 relative z-10" on:click|stopPropagation={() => dispatch('shareQuiz', course)} title="ចែករំលែកតេស្ត">
                                                    🔗
                                                </button>
                                            </div>
                                        {/if}
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                {:else}
                    <div class="col-span-full text-center py-16 text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200">
                        <div class="text-5xl mb-3 opacity-50">🔍</div>
                        <p class="font-medium">{t('no_courses_found')}</p>
                        {#if showAllCourses}
                            <button class="btn btn-link btn-sm mt-2" on:click={() => {searchTerm = ''; selectedCategory = 'All';}}>{t('show_all')}</button>
                        {/if}
                    </div>
                {/each}
            </div>
        </div>

        <div class="text-center text-xs text-base-content mt-8">
            Powered by CCN
        </div>
    </div>
</div>

{#if !showLessonPlayer}
    <!-- Scrolling Marquee Footer -->
    <MarqueeFooter />

    <!-- Floating Assistant Button -->
    <FloatingAssistant {assistantTelegram} />
{/if}

<!-- Tutorial Modal -->
<TutorialModal bind:show={showTutorialModal} {tutorials} />

{#if showPaymentModal && selectedPaymentCourse}
    {@const paymentProgram = programConfigFor(selectedPaymentCourse)}
    {@const paymentEnrollment = courseEnrollment(selectedPaymentCourse)}
    <div class="modal modal-open z-[80]">
        <div class="modal-box w-11/12 max-w-2xl bg-white rounded-2xl p-0 overflow-hidden">
            <div class="bg-warning/10 border-b border-warning/20 p-5 flex items-start justify-between gap-4">
                <div>
                    <div class="text-xs font-bold uppercase tracking-wide text-warning">Course Payment</div>
                    <h3 class="text-xl font-black text-gray-900 mt-1">{selectedPaymentCourse.title}</h3>
                    <p class="text-sm text-gray-600 mt-1">ស្កេន QR បង់ប្រាក់ រួច upload បង្កាន់ដៃ ដើម្បីឲ្យ Admin approve។</p>
                </div>
                <button class="btn btn-sm btn-circle btn-ghost" on:click={closePaymentModal} disabled={paymentProofUploading}>✕</button>
            </div>

            <div class="p-5 grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-5">
                <div class="space-y-3">
                    <div class="rounded-2xl border border-gray-200 bg-gray-50 p-3 min-h-60 flex items-center justify-center">
                        {#if paymentProgram.payment_qr_url}
                            <img src={paymentProgram.payment_qr_url} alt="Payment QR" class="max-w-full max-h-56 object-contain rounded-xl bg-white" />
                        {:else}
                            <div class="text-center text-gray-400">
                                <div class="text-4xl mb-2">QR</div>
                                <p class="text-sm">វគ្គនេះមិនទាន់បានដាក់ QR code</p>
                            </div>
                        {/if}
                    </div>
                    {#if paymentProgram.payment_account_name || paymentProgram.payment_account_number}
                        <div class="rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm">
                            {#if paymentProgram.payment_account_name}
                                <div class="flex justify-between gap-3">
                                    <span class="text-gray-500">Account</span>
                                    <strong class="text-right text-gray-800">{paymentProgram.payment_account_name}</strong>
                                </div>
                            {/if}
                            {#if paymentProgram.payment_account_number}
                                <div class="flex justify-between gap-3 mt-1">
                                    <span class="text-gray-500">No.</span>
                                    <strong class="text-right text-gray-800">{paymentProgram.payment_account_number}</strong>
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>

                <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-3">
                        <div class="rounded-xl bg-primary/5 border border-primary/10 p-3">
                            <div class="text-xs text-gray-500">តម្លៃត្រូវបង់</div>
                            <div class="text-xl font-black text-primary mt-1">{formatMoney(paymentEnrollment?.final_price || finalPriceFor(selectedPaymentCourse, paymentProgram), paymentProgram.currency)}</div>
                        </div>
                        <div class="rounded-xl bg-gray-50 border border-gray-200 p-3">
                            <div class="text-xs text-gray-500">Provider</div>
                            <div class="text-lg font-black text-gray-800 mt-1">{paymentProgram.payment_provider || 'manual_qr'}</div>
                        </div>
                    </div>

                    <div class="rounded-xl border border-dashed border-warning/40 bg-warning/5 p-3">
                        <div class="text-xs text-gray-500 mb-1">Payment Reference</div>
                        <div class="font-mono font-black text-gray-900 break-all">{paymentEnrollment?.payment_reference || '-'}</div>
                        <p class="text-[11px] text-gray-500 mt-2">សូមដាក់ reference នេះក្នុង remark/note ពេលផ្ទេរប្រាក់ ប្រសិនបើ app ធនាគារអនុញ្ញាត។</p>
                    </div>

                    {#if paymentProgram.payment_instructions}
                        <div class="rounded-xl bg-blue-50 border border-blue-100 p-3 text-sm text-blue-900 whitespace-pre-line">
                            {paymentProgram.payment_instructions}
                        </div>
                    {/if}

                    {#if paymentEnrollment?.payment_proof_url}
                        <a href={paymentEnrollment.payment_proof_url} target="_blank" rel="noreferrer" class="btn btn-outline btn-sm w-full">
                            មើលបង្កាន់ដៃដែលបានផ្ញើរួច
                        </a>
                    {/if}

                    <div class="space-y-2">
                        <label class="text-sm font-bold text-gray-700">Upload បង្កាន់ដៃ</label>
                        <input type="file" accept="image/*,.pdf" class="file-input file-input-bordered w-full bg-white"
                            on:change={(e) => paymentProofFile = e.target.files?.[0] || null} />
                    </div>

                    <div class="space-y-2">
                        <label class="text-sm font-bold text-gray-700">ចំណាំបន្ថែម</label>
                        <textarea bind:value={paymentProofNote} class="textarea textarea-bordered w-full bg-white h-20"
                            placeholder="ឧ. បានបង់ពី ABA ឈ្មោះ ... ម៉ោង ..."></textarea>
                    </div>

                    <div class="flex gap-2 justify-end pt-2">
                        <button class="btn btn-ghost" on:click={closePaymentModal} disabled={paymentProofUploading}>បិទ</button>
                        <button class="btn btn-warning text-white" on:click={submitPaymentProof} disabled={paymentProofUploading || !paymentProofFile}>
                            {paymentProofUploading ? 'កំពុង Upload...' : 'ផ្ញើបង្កាន់ដៃ'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
        <button class="modal-backdrop" on:click={closePaymentModal} disabled={paymentProofUploading}>close</button>
    </div>
{/if}

<style>
    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }
    .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
</style>
