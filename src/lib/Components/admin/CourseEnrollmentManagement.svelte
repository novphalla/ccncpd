<script>
    import { onMount } from 'svelte';
    import { slide } from 'svelte/transition';
    import { CheckCircleIcon, ClockIcon, CreditCardIcon, DownloadIcon, PrinterIcon, RefreshCwIcon, SearchIcon, Trash2Icon, UsersIcon, XCircleIcon } from 'lucide-svelte';

    export let supabase;
    export let currentUser;
    export let courses = [];

    let enrollments = [];
    let loading = false;
    let setupNeeded = false;
    let errorMessage = '';
    let statusFilter = 'all';
    let courseFilter = 'all';
    let searchTerm = '';
    let showSummary = true;
    let showFinance = true;
    let showCouponManager = false;
    let showManualAdd = false;
    let selectedEnrollmentIds = new Set();
    let bulkLoading = false;
    let manualCourseId = '';
    let manualUserSearch = '';
    let manualUserResults = [];
    let manualAddLoading = false;
    let manualAddMode = 'approved';
    let coupons = [];
    let couponLoading = false;
    let couponForm = {
        code: '',
        description: '',
        course_id: '',
        discount_type: 'percent',
        discount_value: 0,
        currency: 'KHR',
        max_uses: '',
        expires_at: ''
    };

    $: courseOptions = Array.from(
        new Map(enrollments.map(row => [row.course_id, row.course?.title || 'មិនមានចំណងជើង'])).entries()
    ).map(([id, title]) => ({ id, title }));
    $: couponCourseOptions = courses?.length
        ? courses.map(course => ({ id: course.id, title: course.title }))
        : courseOptions;
    $: manualCourse = courses?.find(course => String(course.id) === String(manualCourseId));

    $: enrollmentStats = {
        total: enrollments.length,
        pending: enrollments.filter(row => row.status === 'pending_payment' || row.payment_status === 'pending').length,
        approved: enrollments.filter(row => row.status === 'approved').length,
        registered: enrollments.filter(row => row.status === 'registered').length,
        rejected: enrollments.filter(row => row.status === 'rejected').length,
        paid: enrollments.filter(row => row.pricing_type === 'paid').length
    };

    $: filteredEnrollments = enrollments.filter(row => {
        const statusMatches = statusFilter === 'all' || row.status === statusFilter || row.payment_status === statusFilter;
        const courseMatches = courseFilter === 'all' || row.course_id === courseFilter;
        const query = searchTerm.trim().toLowerCase();
        const searchableText = [
            row.member?.full_name,
            row.member?.name_latin,
            row.member?.phone_number,
            row.course?.title,
            row.status,
            row.payment_status
        ].filter(Boolean).join(' ').toLowerCase();

        return statusMatches && courseMatches && (!query || searchableText.includes(query));
    });

    $: filteredStats = {
        total: filteredEnrollments.length,
        pending: filteredEnrollments.filter(row => row.status === 'pending_payment' || row.payment_status === 'pending').length,
        approved: filteredEnrollments.filter(row => row.status === 'approved').length,
        registered: filteredEnrollments.filter(row => row.status === 'registered').length,
        rejected: filteredEnrollments.filter(row => row.status === 'rejected').length,
        paid: filteredEnrollments.filter(row => row.pricing_type === 'paid').length
    };

    $: courseReportRows = buildCourseReportRows(filteredEnrollments);
    $: demographicStats = buildDemographicStats(filteredEnrollments);
    $: financeStats = buildFinanceStats(filteredEnrollments);
    $: courseFinanceRows = buildCourseFinanceRows(filteredEnrollments);
    $: selectedEnrollments = enrollments.filter(row => selectedEnrollmentIds.has(row.id));
    $: selectedCount = selectedEnrollments.length;
    $: allFilteredSelected = filteredEnrollments.length > 0 && filteredEnrollments.every(row => selectedEnrollmentIds.has(row.id));

    onMount(() => {
        loadEnrollments();
        loadCoupons();
    });

    function programConfigFor(course) {
        return {
            access_mode: 'open_access',
            pricing_type: 'free',
            price: 0,
            currency: 'KHR',
            ...(course?.cert_config?.program || {})
        };
    }

    async function loadEnrollments() {
        loading = true;
        setupNeeded = false;
        errorMessage = '';

        const { data, error } = await supabase
            .from('course_enrollments')
            .select(`
                *,
                course:courses!course_enrollments_course_id_fkey(title),
                member:users!course_enrollments_user_id_fkey(full_name, name_latin, phone_number, gender, profile_data, avatar_url),
                approver:users!course_enrollments_approved_by_fkey(full_name, name_latin)
            `)
            .order('registered_at', { ascending: false })
            .limit(300);

        if (error) {
            if (error.code === '42P01' || error.code === 'PGRST205') {
                setupNeeded = true;
            } else {
                errorMessage = error.message;
            }
            enrollments = [];
        } else {
            enrollments = data || [];
        }

        loading = false;
    }

    async function updateEnrollment(row, status) {
        const updates = {
            status,
            payment_status: status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : row.payment_status,
            approved_at: status === 'approved' ? new Date().toISOString() : null,
            approved_by: status === 'approved' ? currentUser?.id : null,
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase
            .from('course_enrollments')
            .update(updates)
            .eq('id', row.id);

        if (error) return alert('Error: ' + error.message);
        await loadEnrollments();
    }

    async function waiveEnrollment(row) {
        const reason = prompt('មូលហេតុលើកលែងការបង់ប្រាក់:', row.waiver_reason || '');
        if (reason === null) return;

        const { error } = await supabase
            .from('course_enrollments')
            .update({
                status: 'approved',
                payment_status: 'waived',
                waiver_reason: reason.trim(),
                waived_at: new Date().toISOString(),
                waived_by: currentUser?.id || null,
                approved_at: new Date().toISOString(),
                approved_by: currentUser?.id || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', row.id);

        if (error) return alert('Error: ' + error.message);
        await loadEnrollments();
    }

    function toggleEnrollmentSelection(id) {
        if (selectedEnrollmentIds.has(id)) {
            selectedEnrollmentIds.delete(id);
        } else {
            selectedEnrollmentIds.add(id);
        }
        selectedEnrollmentIds = new Set(selectedEnrollmentIds);
    }

    function toggleAllFiltered() {
        if (allFilteredSelected) {
            filteredEnrollments.forEach(row => selectedEnrollmentIds.delete(row.id));
        } else {
            filteredEnrollments.forEach(row => selectedEnrollmentIds.add(row.id));
        }
        selectedEnrollmentIds = new Set(selectedEnrollmentIds);
    }

    function clearSelection() {
        selectedEnrollmentIds = new Set();
    }

    async function bulkUpdateEnrollments(status) {
        const ids = selectedEnrollments.map(row => row.id);
        if (ids.length === 0) return;

        const label = status === 'approved' ? 'approve' : 'reject';
        if (!confirm(`តើអ្នកចង់ ${label} ការចុះឈ្មោះចំនួន ${ids.length} មែនទេ?`)) return;

        bulkLoading = true;
        const updates = {
            status,
            payment_status: status === 'approved' ? 'approved' : 'rejected',
            approved_at: status === 'approved' ? new Date().toISOString() : null,
            approved_by: status === 'approved' ? currentUser?.id : null,
            updated_at: new Date().toISOString()
        };

        const { error } = await supabase
            .from('course_enrollments')
            .update(updates)
            .in('id', ids);

        bulkLoading = false;
        if (error) return alert('Error: ' + error.message);
        clearSelection();
        await loadEnrollments();
    }

    async function deleteEnrollment(row) {
        const name = memberName(row);
        const courseTitle = row.course?.title || 'វគ្គសិក្សានេះ';
        if (!confirm(`តើអ្នកពិតជាចង់លុបការចុះឈ្មោះរបស់ "${name}" ចេញពី "${courseTitle}" មែនទេ?\n\nការលុបនេះមិនលុបគណនីសមាជិក ឬវគ្គសិក្សាទេ។`)) return;

        const { error } = await supabase
            .from('course_enrollments')
            .delete()
            .eq('id', row.id);

        if (error) return alert('Error: ' + error.message);
        selectedEnrollmentIds.delete(row.id);
        selectedEnrollmentIds = new Set(selectedEnrollmentIds);
        enrollments = enrollments.filter(item => item.id !== row.id);
    }

    async function bulkDeleteEnrollments() {
        const ids = selectedEnrollments.map(row => row.id);
        if (ids.length === 0) return;
        if (!confirm(`តើអ្នកពិតជាចង់លុបការចុះឈ្មោះចំនួន ${ids.length} មែនទេ?\n\nការលុបនេះមិនលុបគណនីសមាជិក ឬវគ្គសិក្សាទេ។`)) return;

        bulkLoading = true;
        const { error } = await supabase
            .from('course_enrollments')
            .delete()
            .in('id', ids);

        bulkLoading = false;
        if (error) return alert('Error: ' + error.message);
        clearSelection();
        enrollments = enrollments.filter(row => !ids.includes(row.id));
    }

    async function searchManualUsers() {
        const query = manualUserSearch.trim().replace(/[,%]/g, '');
        manualUserResults = [];
        if (query.length < 2) return;

        manualAddLoading = true;
        const { data, error } = await supabase
            .from('users')
            .select('id, full_name, name_latin, phone_number, gender, profile_data')
            .or(`full_name.ilike.%${query}%,name_latin.ilike.%${query}%,phone_number.ilike.%${query}%`)
            .limit(10);

        manualAddLoading = false;
        if (error) return alert('Error: ' + error.message);
        manualUserResults = data || [];
    }

    async function addManualEnrollment(user) {
        if (!manualCourse) return alert('សូមជ្រើសវគ្គសិក្សាជាមុនសិន។');
        if (!user?.id) return;

        const program = programConfigFor(manualCourse);
        const isPaid = program.pricing_type === 'paid';
        const nowIso = new Date().toISOString();
		const status = manualAddMode === 'pending_payment' && isPaid ? 'pending_payment' : 'approved';
        const paymentStatus = !isPaid
            ? 'not_required'
            : manualAddMode === 'waived'
                ? 'waived'
                : manualAddMode === 'pending_payment'
                    ? 'pending'
                    : 'approved';

        const payload = {
            course_id: manualCourse.id,
            user_id: user.id,
            status,
            pricing_type: program.pricing_type || 'free',
            price: Number(program.price || 0),
            original_price: Number(program.price || 0),
            discount_amount: 0,
            final_price: Number(program.price || 0),
            currency: program.currency || 'KHR',
            payment_status: paymentStatus,
            waiver_reason: paymentStatus === 'waived' ? 'បន្ថែមដោយ Admin ក្រោយចូលរៀន/Zoom' : null,
            waived_at: paymentStatus === 'waived' ? nowIso : null,
            waived_by: paymentStatus === 'waived' ? currentUser?.id || null : null,
            approved_at: status === 'approved' ? nowIso : null,
            approved_by: status === 'approved' ? currentUser?.id || null : null,
            registered_at: nowIso,
            updated_at: nowIso
        };

        const { error } = await supabase
            .from('course_enrollments')
            .upsert(payload, { onConflict: 'course_id,user_id' });

        if (error) return alert('Error: ' + error.message);
        alert(`បានបន្ថែម "${user.full_name || user.name_latin || user.phone_number}" ចូលវគ្គ "${manualCourse.title}" រួចរាល់។`);
        manualUserSearch = '';
        manualUserResults = [];
        await loadEnrollments();
    }

    async function loadCoupons() {
        if (!supabase) return;
        couponLoading = true;
        const { data, error } = await supabase
            .from('course_coupons')
            .select('*, course:courses(title)')
            .order('created_at', { ascending: false })
            .limit(100);
        if (!error) coupons = data || [];
        else if (error.code !== '42P01' && error.code !== 'PGRST205') console.warn('Could not load coupons:', error.message);
        couponLoading = false;
    }

    async function saveCoupon() {
        const code = couponForm.code.trim().toUpperCase();
        if (!code) return alert('សូមបញ្ចូល coupon code');
        const payload = {
            code,
            description: couponForm.description || null,
            course_id: couponForm.course_id || null,
            discount_type: couponForm.discount_type,
            discount_value: Number(couponForm.discount_value || 0),
            currency: couponForm.currency || 'KHR',
            max_uses: couponForm.max_uses === '' ? null : Number(couponForm.max_uses),
            expires_at: couponForm.expires_at || null,
            is_active: true,
            created_by: currentUser?.id || null,
            updated_at: new Date().toISOString()
        };
        const { error } = await supabase.from('course_coupons').upsert(payload, { onConflict: 'code' });
        if (error) return alert('Error: ' + error.message);
        couponForm = { code: '', description: '', course_id: '', discount_type: 'percent', discount_value: 0, currency: 'KHR', max_uses: '', expires_at: '' };
        await loadCoupons();
    }

    async function toggleCoupon(coupon) {
        const { error } = await supabase
            .from('course_coupons')
            .update({ is_active: !coupon.is_active, updated_at: new Date().toISOString() })
            .eq('id', coupon.id);
        if (error) return alert('Error: ' + error.message);
        await loadCoupons();
    }

    function memberName(row) {
        return row.member?.full_name || row.member?.name_latin || 'មិនមានឈ្មោះ';
    }

    function memberMeta(row) {
        return [row.member?.phone_number, row.member?.name_latin, row.member?.gender].filter(Boolean).join(' · ');
    }

    function genderLabel(value) {
        if (value === 'Male' || value === 'ប្រុស') return 'ប្រុស';
        if (value === 'Female' || value === 'ស្រី') return 'ស្រី';
        return value || 'មិនបញ្ជាក់';
    }

    function profileValue(row, key) {
        const value = row.member?.profile_data?.[key];
        return value && value !== 'N/A' ? value : 'មិនបញ្ជាក់';
    }

    function statusLabel(row) {
        if (row.status === 'pending_payment') return 'រង់ចាំបង់/approve';
        if (row.payment_status === 'waived') return 'បានលើកលែងបង់ប្រាក់';
        if (row.status === 'approved') return 'បាន approve';
        if (row.status === 'registered') return 'បានចុះឈ្មោះ';
        if (row.status === 'rejected') return 'បានបដិសេធ';
        if (row.status === 'cancelled') return 'បានបោះបង់';
        if (row.status === 'completed') return 'បានបញ្ចប់';
        return row.status || '-';
    }

    function statusClass(row) {
        if (row.payment_status === 'waived') return 'badge-secondary';
        if (row.status === 'approved' || row.status === 'registered' || row.status === 'completed') return 'badge-success';
        if (row.status === 'rejected' || row.status === 'cancelled') return 'badge-error';
        return 'badge-warning';
    }

    function paymentLabel(row) {
        if (row.payment_status === 'waived') return 'Waived';
        if (row.pricing_type !== 'paid') return 'Free';
        const amount = row.final_price ?? row.price ?? 0;
        return `${Number(amount || 0).toLocaleString()} ${row.currency || 'KHR'}`;
    }

    function formatCurrency(amount, currency = 'KHR') {
        return `${Number(amount || 0).toLocaleString()} ${currency || 'KHR'}`;
    }

    function formatDate(value) {
        return value ? new Date(value).toLocaleString('km-KH') : '-';
    }

    function buildCourseReportRows(rows) {
        const grouped = new Map();
        rows.forEach(row => {
            const key = row.course_id || 'unknown';
            if (!grouped.has(key)) {
                grouped.set(key, {
                    course_id: key,
                    title: row.course?.title || 'មិនមានចំណងជើង',
                    total: 0,
                    pending: 0,
                    approved: 0,
                    registered: 0,
                    rejected: 0,
                    paid: 0,
                    free: 0
                });
            }
            const item = grouped.get(key);
            item.total += 1;
            if (row.status === 'pending_payment' || row.payment_status === 'pending') item.pending += 1;
            if (row.status === 'approved') item.approved += 1;
            if (row.status === 'registered') item.registered += 1;
            if (row.status === 'rejected') item.rejected += 1;
            if (row.pricing_type === 'paid') item.paid += 1;
            else item.free += 1;
        });

        return Array.from(grouped.values()).sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));
    }

    function buildDemographicStats(rows) {
        const stats = {
            total: rows.length,
            gender: {},
            position: {},
            workplace: {},
            province: {},
            licenseStatus: {}
        };

        rows.forEach(row => {
            const gender = genderLabel(row.member?.gender);
            stats.gender[gender] = (stats.gender[gender] || 0) + 1;

            const position = profileValue(row, 'position');
            const workplace = profileValue(row, 'workplace');
            const province = profileValue(row, 'province');
            const licenseStatus = profileValue(row, 'license_status');

            stats.position[position] = (stats.position[position] || 0) + 1;
            stats.workplace[workplace] = (stats.workplace[workplace] || 0) + 1;
            stats.province[province] = (stats.province[province] || 0) + 1;
            stats.licenseStatus[licenseStatus] = (stats.licenseStatus[licenseStatus] || 0) + 1;
        });

        return stats;
    }

    function blankFinanceBucket(currency) {
        return {
            currency,
            approvedAmount: 0,
            pendingAmount: 0,
            rejectedAmount: 0,
            waivedAmount: 0,
            discountAmount: 0,
            expectedAmount: 0,
            paidCount: 0,
            approvedCount: 0,
            pendingCount: 0,
            rejectedCount: 0,
            waivedCount: 0
        };
    }

    function buildFinanceStats(rows) {
        const byCurrency = new Map();
        let paidCount = 0;
        let freeCount = 0;

        rows.forEach(row => {
            if (row.pricing_type !== 'paid') {
                freeCount += 1;
                return;
            }

            paidCount += 1;
            const currency = row.currency || 'KHR';
            const amount = Number(row.final_price ?? row.price ?? 0);
            const originalAmount = Number(row.original_price ?? row.price ?? 0);
            const discountAmount = Number(row.discount_amount || 0);
            if (!byCurrency.has(currency)) byCurrency.set(currency, blankFinanceBucket(currency));
            const bucket = byCurrency.get(currency);

            bucket.paidCount += 1;
            bucket.discountAmount += discountAmount;
            if (row.payment_status === 'waived') {
                bucket.waivedAmount += originalAmount;
                bucket.waivedCount += 1;
            } else if (row.payment_status === 'approved' || row.status === 'approved' || (row.payment_status === 'not_required' && row.status === 'registered')) {
                bucket.approvedAmount += amount;
                bucket.expectedAmount += amount;
                bucket.approvedCount += 1;
            } else if (row.payment_status === 'rejected' || row.status === 'rejected') {
                bucket.rejectedAmount += amount;
                bucket.rejectedCount += 1;
            } else {
                bucket.pendingAmount += amount;
                bucket.expectedAmount += amount;
                bucket.pendingCount += 1;
            }
        });

        return {
            paidCount,
            freeCount,
            currencies: Array.from(byCurrency.values()).sort((a, b) => a.currency.localeCompare(b.currency))
        };
    }

    function buildCourseFinanceRows(rows) {
        const grouped = new Map();
        rows.filter(row => row.pricing_type === 'paid').forEach(row => {
            const currency = row.currency || 'KHR';
            const key = `${row.course_id || 'unknown'}|${currency}`;
            if (!grouped.has(key)) {
                grouped.set(key, {
                    course_id: row.course_id || 'unknown',
                    title: row.course?.title || 'មិនមានចំណងជើង',
                    ...blankFinanceBucket(currency)
                });
            }

            const item = grouped.get(key);
            const finalAmount = Number(row.final_price ?? row.price ?? 0);
            const originalAmount = Number(row.original_price ?? row.price ?? 0);
            item.paidCount += 1;
            item.discountAmount += Number(row.discount_amount || 0);
            if (row.payment_status === 'waived') {
                item.waivedAmount += originalAmount;
                item.waivedCount += 1;
            } else if (row.payment_status === 'approved' || row.status === 'approved' || (row.payment_status === 'not_required' && row.status === 'registered')) {
                item.approvedAmount += finalAmount;
                item.expectedAmount += finalAmount;
                item.approvedCount += 1;
            } else if (row.payment_status === 'rejected' || row.status === 'rejected') {
                item.rejectedAmount += finalAmount;
                item.rejectedCount += 1;
            } else {
                item.pendingAmount += finalAmount;
                item.expectedAmount += finalAmount;
                item.pendingCount += 1;
            }
        });

        return Array.from(grouped.values()).sort((a, b) => b.expectedAmount - a.expectedAmount || a.title.localeCompare(b.title));
    }

    function sortedEntries(dataObj) {
        return Object.entries(dataObj || {}).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    }

    function percentWidth(count, total) {
        if (!total) return 0;
        return Math.max(1, Math.round((count / total) * 100));
    }

    function csvEscape(value) {
        const text = value === null || value === undefined ? '' : String(value);
        return `"${text.replace(/"/g, '""')}"`;
    }

    function downloadCsv(filename, headers, rows) {
        const tableRows = headers?.length ? [headers, ...rows] : rows;
        const csv = tableRows.map(row => row.map(csvEscape).join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function exportEnrollmentReportCsv() {
        const headers = [
            'ល.រ', 'ឈ្មោះ', 'ឈ្មោះឡាតាំង', 'លេខទូរស័ព្ទ', 'ភេទ', 'តួនាទី', 'កន្លែងធ្វើការ', 'រាជធានី/ខេត្ត',
            'វគ្គសិក្សា', 'ប្រភេទតម្លៃ', 'តម្លៃ', 'រូបិយប័ណ្ណ', 'Payment Status', 'Payment Reference', 'Payment Proof', 'ស្ថានភាព', 'ថ្ងៃចុះឈ្មោះ', 'ថ្ងៃ Approve', 'Admin Approve'
        ];
        const rows = filteredEnrollments.map((row, index) => [
            index + 1,
            memberName(row),
            row.member?.name_latin || '',
            row.member?.phone_number || '',
            row.member?.gender || '',
            row.member?.profile_data?.position || '',
            row.member?.profile_data?.workplace || '',
            row.member?.profile_data?.province || '',
            row.course?.title || '',
            row.pricing_type || '',
            row.price || 0,
            row.currency || '',
            row.payment_status || '',
            row.payment_reference || '',
            row.payment_proof_url || '',
            statusLabel(row),
            formatDate(row.registered_at),
            formatDate(row.approved_at),
            row.approver?.full_name || row.approver?.name_latin || ''
        ]);

        downloadCsv(`course_enrollments_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    }

    function exportCourseSummaryCsv() {
        const headers = ['វគ្គសិក្សា', 'សរុប', 'រង់ចាំ', 'Approved', 'Free Registered', 'Rejected', 'Paid', 'Free'];
        const rows = courseReportRows.map(row => [
            row.title, row.total, row.pending, row.approved, row.registered, row.rejected, row.paid, row.free
        ]);
        downloadCsv(`course_enrollment_summary_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    }

    function exportFinanceReportCsv() {
        if (financeStats.paidCount === 0) return alert('មិនទាន់មានទិន្នន័យហិរញ្ញវត្ថុសម្រាប់ Export ទេ');

        const rows = [];
        rows.push(['របាយការណ៍ហិរញ្ញវត្ថុវគ្គសិក្សា', '', '', '', '', '', '', '']);
        rows.push(['កាលបរិច្ឆេទ Export', new Date().toLocaleString('km-KH'), '', '', '', '', '', '']);
        rows.push(['Paid សរុប', financeStats.paidCount, 'Free សរុប', financeStats.freeCount, '', '', '', '']);
        rows.push([]);
        rows.push(['សង្ខេបតាមរូបិយប័ណ្ណ', 'Paid Count', 'Approved Count', 'ចំណូលបានបញ្ជាក់', 'Pending Count', 'ប្រាក់រង់ចាំ', 'Waived Count', 'ប្រាក់លើកលែង', 'Discount', 'Rejected Count', 'ប្រាក់ Rejected']);
        financeStats.currencies.forEach(row => {
            rows.push([
                row.currency,
                row.paidCount,
                row.approvedCount,
                row.approvedAmount,
                row.pendingCount,
                row.pendingAmount,
                row.waivedCount,
                row.waivedAmount,
                row.discountAmount,
                row.rejectedCount,
                row.rejectedAmount
            ]);
        });
        rows.push([]);
        rows.push(['វគ្គសិក្សា', 'រូបិយប័ណ្ណ', 'Paid Count', 'Approved Count', 'ចំណូលបានបញ្ជាក់', 'Pending Count', 'ប្រាក់រង់ចាំ', 'Waived Count', 'ប្រាក់លើកលែង', 'Discount', 'Rejected Count', 'ប្រាក់ Rejected', 'ចំណូលរំពឹងទុក']);
        courseFinanceRows.forEach(row => {
            rows.push([
                row.title,
                row.currency,
                row.paidCount,
                row.approvedCount,
                row.approvedAmount,
                row.pendingCount,
                row.pendingAmount,
                row.waivedCount,
                row.waivedAmount,
                row.discountAmount,
                row.rejectedCount,
                row.rejectedAmount,
                row.expectedAmount
            ]);
        });

        downloadCsv(`course_finance_report_${new Date().toISOString().split('T')[0]}.csv`, [], rows);
    }

    function exportEnrollmentSummaryStatsToExcel() {
        if (demographicStats.total === 0) return alert('គ្មានទិន្នន័យសម្រាប់ Export ទេ');

        const rows = [];
        rows.push(['របាយការណ៍សង្ខេបអ្នកចុះឈ្មោះវគ្គសិក្សា', '', '']);
        rows.push(['កាលបរិច្ឆេទ Export', new Date().toLocaleString('km-KH'), '']);
        rows.push(['អ្នកចុះឈ្មោះសរុប', demographicStats.total, '']);
        rows.push([]);

        const appendSection = (title, dataObj) => {
            rows.push([title, 'ចំនួន', 'ភាគរយ']);
            sortedEntries(dataObj).forEach(([label, count]) => {
                rows.push([label, count, `${Math.round((count / demographicStats.total) * 100)}%`]);
            });
            rows.push(['សរុប', demographicStats.total, '100%']);
            rows.push([]);
        };

        appendSection('ភេទ', demographicStats.gender);
        appendSection('មុខតំណែង / កម្រិតជំនាញ', demographicStats.position);
        appendSection('កន្លែងធ្វើការ', demographicStats.workplace);
        appendSection('រាជធានី/ខេត្ត', demographicStats.province);
        appendSection('ស្ថានភាពអាជ្ញាប័ណ្ណ', demographicStats.licenseStatus);

        downloadCsv(`course_enrollment_demographic_summary_${new Date().toISOString().split('T')[0]}.csv`, [], rows);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function printEnrollmentReport() {
        const printWindow = window.open('', '_blank');
        if (!printWindow) return alert('មិនអាចបើកផ្ទាំង print បានទេ។ សូមអនុញ្ញាត pop-up ក្នុង browser។');

        const generatedAt = new Date().toLocaleString('km-KH');
        const filterText = [
            statusFilter !== 'all' ? `Status: ${statusFilter}` : 'Status: ទាំងអស់',
            courseFilter !== 'all' ? `វគ្គ: ${courseOptions.find(c => c.id === courseFilter)?.title || courseFilter}` : 'វគ្គ: ទាំងអស់',
            searchTerm.trim() ? `Search: ${searchTerm.trim()}` : ''
        ].filter(Boolean).join(' | ');

        const summaryRows = courseReportRows.map(row => `
            <tr>
                <td>${escapeHtml(row.title)}</td>
                <td>${row.total}</td>
                <td>${row.pending}</td>
                <td>${row.approved}</td>
                <td>${row.registered}</td>
                <td>${row.rejected}</td>
                <td>${row.paid}</td>
                <td>${row.free}</td>
            </tr>
        `).join('');

        const detailRows = filteredEnrollments.map((row, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>
                    <strong>${escapeHtml(memberName(row))}</strong><br>
                    <span>${escapeHtml(memberMeta(row) || '-')}</span>
                </td>
                <td>${escapeHtml(row.course?.title || '-')}</td>
                <td>${escapeHtml(paymentLabel(row))}<br><span>${escapeHtml(row.payment_status || '-')}</span></td>
                <td>${escapeHtml(statusLabel(row))}</td>
                <td>${escapeHtml(formatDate(row.registered_at))}</td>
            </tr>
        `).join('');

        printWindow.document.write(`
            <!doctype html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <title>Course Enrollment Report</title>
                    <style>
                        body { font-family: Arial, "Khmer OS Battambang", sans-serif; color: #111827; padding: 24px; }
                        h1 { margin: 0 0 4px; font-size: 24px; }
                        h2 { margin: 28px 0 10px; font-size: 18px; }
                        .meta { color: #6b7280; font-size: 12px; margin-bottom: 18px; }
                        .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 18px 0; }
                        .stat { border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; }
                        .stat strong { display: block; font-size: 22px; }
                        .stat span { color: #6b7280; font-size: 12px; }
                        table { width: 100%; border-collapse: collapse; font-size: 12px; }
                        th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
                        th { background: #f3f4f6; }
                        span { color: #6b7280; }
                        @media print { body { padding: 0; } .no-print { display: none; } }
                    </style>
                </head>
                <body>
                    <button class="no-print" onclick="window.print()" style="float:right;padding:8px 12px">Print / Save PDF</button>
                    <h1>របាយការណ៍ចុះឈ្មោះវគ្គសិក្សា</h1>
                    <div class="meta">បង្កើតនៅ: ${escapeHtml(generatedAt)}<br>${escapeHtml(filterText)}</div>
                    <div class="stats">
                        <div class="stat"><strong>${filteredStats.total}</strong><span>សរុប</span></div>
                        <div class="stat"><strong>${filteredStats.pending}</strong><span>រង់ចាំ</span></div>
                        <div class="stat"><strong>${filteredStats.approved}</strong><span>Approved</span></div>
                        <div class="stat"><strong>${filteredStats.registered}</strong><span>Free Registered</span></div>
                        <div class="stat"><strong>${filteredStats.paid}</strong><span>Paid</span></div>
                    </div>

                    <h2>សង្ខេបតាមវគ្គ</h2>
                    <table>
                        <thead>
                            <tr><th>វគ្គសិក្សា</th><th>សរុប</th><th>រង់ចាំ</th><th>Approved</th><th>Free Reg.</th><th>Rejected</th><th>Paid</th><th>Free</th></tr>
                        </thead>
                        <tbody>${summaryRows || '<tr><td colspan="8">មិនមានទិន្នន័យ</td></tr>'}</tbody>
                    </table>

                    <h2>បញ្ជីលម្អិត</h2>
                    <table>
                        <thead>
                            <tr><th>ល.រ</th><th>សមាជិក</th><th>វគ្គសិក្សា</th><th>Payment</th><th>ស្ថានភាព</th><th>ថ្ងៃចុះឈ្មោះ</th></tr>
                        </thead>
                        <tbody>${detailRows || '<tr><td colspan="6">មិនមានទិន្នន័យ</td></tr>'}</tbody>
                    </table>
                    <script>setTimeout(() => window.print(), 500);<\/script>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
    }

    function printEnrollmentSummaryStats() {
        if (demographicStats.total === 0) return alert('គ្មានទិន្នន័យសម្រាប់ Export ទេ');

        const printWindow = window.open('', '_blank');
        if (!printWindow) return alert('មិនអាចបើកផ្ទាំង print បានទេ។ សូមអនុញ្ញាត pop-up ក្នុង browser។');

        const filterText = [
            statusFilter !== 'all' ? `Status: ${statusFilter}` : 'Status: ទាំងអស់',
            courseFilter !== 'all' ? `វគ្គ: ${courseOptions.find(c => c.id === courseFilter)?.title || courseFilter}` : 'វគ្គ: ទាំងអស់',
            searchTerm.trim() ? `Search: ${searchTerm.trim()}` : ''
        ].filter(Boolean).join(' | ');

        const makeTable = (title, dataObj) => {
            const rows = sortedEntries(dataObj).map(([label, count]) => `
                <tr>
                    <td>${escapeHtml(label)}</td>
                    <td>${count}</td>
                    <td>${Math.round((count / demographicStats.total) * 100)}%</td>
                </tr>
            `).join('');

            return `
                <div>
                    <h2>${escapeHtml(title)}</h2>
                    <table>
                        <thead><tr><th>ឈ្មោះ</th><th>ចំនួន</th><th>ភាគរយ</th></tr></thead>
                        <tbody>
                            ${rows}
                            <tr class="total-row"><td>សរុប</td><td>${demographicStats.total}</td><td>100%</td></tr>
                        </tbody>
                    </table>
                </div>
            `;
        };

        const html = `
            <!doctype html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <title>Course Enrollment Summary</title>
                    <style>
                        body { font-family: Arial, "Khmer OS Battambang", sans-serif; padding: 20px; color: #1f2937; }
                        h1 { text-align: center; color: #0d9488; margin-bottom: 10px; }
                        h2 { font-size: 16px; margin-top: 20px; border-bottom: 2px solid #0d9488; padding-bottom: 5px; color: #0f766e; line-height: 1.4; }
                        .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 30px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
                        th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; }
                        th { background-color: #f3f4f6; font-weight: bold; }
                        .total-row { font-weight: bold; background-color: #e5e7eb; }
                        .header-info { text-align: center; margin-bottom: 30px; font-size: 14px; background: #f0fdfa; padding: 15px; border-radius: 10px; border: 1px solid #ccfbf1; }
                        @media print { body { padding: 0; } .header-info { border: 1px solid #ddd; } }
                    </style>
                </head>
                <body>
                    <h1>របាយការណ៍សង្ខេបអ្នកចុះឈ្មោះវគ្គសិក្សា</h1>
                    <div class="header-info">
                        <p style="margin:0 0 5px 0;">កាលបរិច្ឆេទ Export: ${escapeHtml(new Date().toLocaleString('km-KH'))}</p>
                        <p style="margin:0 0 5px 0;">អ្នកចុះឈ្មោះសរុប: <strong>${demographicStats.total}</strong></p>
                        <p style="margin:0;">${escapeHtml(filterText)}</p>
                    </div>
                    <div class="grid">
                        ${makeTable('ភេទ', demographicStats.gender)}
                        ${makeTable('មុខតំណែង / កម្រិតជំនាញ', demographicStats.position)}
                        ${makeTable('កន្លែងធ្វើការ', demographicStats.workplace)}
                        ${makeTable('រាជធានី/ខេត្ត', demographicStats.province)}
                        ${makeTable('ស្ថានភាពអាជ្ញាប័ណ្ណ', demographicStats.licenseStatus)}
                    </div>
                    <script>window.onload=()=>{window.print();}<\/script>
                </body>
            </html>
        `;

        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
    }

    function printFinanceReport() {
        if (financeStats.paidCount === 0) return alert('មិនទាន់មានទិន្នន័យហិរញ្ញវត្ថុសម្រាប់ Print ទេ');

        const printWindow = window.open('', '_blank');
        if (!printWindow) return alert('មិនអាចបើកផ្ទាំង print បានទេ។ សូមអនុញ្ញាត pop-up ក្នុង browser។');

        const filterText = [
            statusFilter !== 'all' ? `Status: ${statusFilter}` : 'Status: ទាំងអស់',
            courseFilter !== 'all' ? `វគ្គ: ${courseOptions.find(c => c.id === courseFilter)?.title || courseFilter}` : 'វគ្គ: ទាំងអស់',
            searchTerm.trim() ? `Search: ${searchTerm.trim()}` : ''
        ].filter(Boolean).join(' | ');

        const currencyRows = financeStats.currencies.map(row => `
            <tr>
                <td>${escapeHtml(row.currency)}</td>
                <td>${row.paidCount}</td>
                <td>${row.approvedCount}</td>
                <td>${escapeHtml(formatCurrency(row.approvedAmount, row.currency))}</td>
                <td>${row.pendingCount}</td>
                <td>${escapeHtml(formatCurrency(row.pendingAmount, row.currency))}</td>
                <td>${row.waivedCount}</td>
                <td>${escapeHtml(formatCurrency(row.waivedAmount, row.currency))}</td>
                <td>${escapeHtml(formatCurrency(row.discountAmount, row.currency))}</td>
                <td>${row.rejectedCount}</td>
                <td>${escapeHtml(formatCurrency(row.rejectedAmount, row.currency))}</td>
            </tr>
        `).join('');

        const courseRows = courseFinanceRows.map(row => `
            <tr>
                <td>${escapeHtml(row.title)}</td>
                <td>${escapeHtml(row.currency)}</td>
                <td>${row.paidCount}</td>
                <td>${row.approvedCount}</td>
                <td>${escapeHtml(formatCurrency(row.approvedAmount, row.currency))}</td>
                <td>${row.pendingCount}</td>
                <td>${escapeHtml(formatCurrency(row.pendingAmount, row.currency))}</td>
                <td>${row.waivedCount}</td>
                <td>${escapeHtml(formatCurrency(row.waivedAmount, row.currency))}</td>
                <td>${escapeHtml(formatCurrency(row.discountAmount, row.currency))}</td>
                <td>${row.rejectedCount}</td>
                <td>${escapeHtml(formatCurrency(row.rejectedAmount, row.currency))}</td>
                <td>${escapeHtml(formatCurrency(row.expectedAmount, row.currency))}</td>
            </tr>
        `).join('');

        printWindow.document.write(`
            <!doctype html>
            <html>
                <head>
                    <meta charset="utf-8">
                    <title>Course Finance Report</title>
                    <style>
                        body { font-family: Arial, "Khmer OS Battambang", sans-serif; color: #111827; padding: 24px; }
                        h1 { margin: 0 0 4px; font-size: 24px; }
                        h2 { margin: 24px 0 10px; font-size: 18px; }
                        .meta { color: #6b7280; font-size: 12px; margin-bottom: 18px; }
                        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 18px 0; }
                        .stat { border: 1px solid #d1d5db; border-radius: 8px; padding: 10px; }
                        .stat strong { display: block; font-size: 22px; }
                        .stat span { color: #6b7280; font-size: 12px; }
                        table { width: 100%; border-collapse: collapse; font-size: 12px; }
                        th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
                        th { background: #f3f4f6; }
                        @media print { body { padding: 0; } .no-print { display: none; } }
                    </style>
                </head>
                <body>
                    <button class="no-print" onclick="window.print()" style="float:right;padding:8px 12px">Print / Save PDF</button>
                    <h1>របាយការណ៍ហិរញ្ញវត្ថុវគ្គសិក្សា</h1>
                    <div class="meta">បង្កើតនៅ: ${escapeHtml(new Date().toLocaleString('km-KH'))}<br>${escapeHtml(filterText)}</div>
                    <div class="stats">
                        <div class="stat"><strong>${financeStats.paidCount}</strong><span>Paid សរុប</span></div>
                        <div class="stat"><strong>${financeStats.freeCount}</strong><span>Free សរុប</span></div>
                        <div class="stat"><strong>${financeStats.currencies.map(row => formatCurrency(row.approvedAmount, row.currency)).join('<br>') || '0'}</strong><span>ចំណូលបានបញ្ជាក់</span></div>
                        <div class="stat"><strong>${financeStats.currencies.map(row => formatCurrency(row.pendingAmount, row.currency)).join('<br>') || '0'}</strong><span>ប្រាក់រង់ចាំ</span></div>
                    </div>

                    <h2>សង្ខេបតាមរូបិយប័ណ្ណ</h2>
                    <table>
                        <thead>
                            <tr><th>រូបិយប័ណ្ណ</th><th>Paid</th><th>Approved</th><th>ចំណូលបានបញ្ជាក់</th><th>Pending</th><th>ប្រាក់រង់ចាំ</th><th>Waived</th><th>ប្រាក់លើកលែង</th><th>Discount</th><th>Rejected</th><th>ប្រាក់ Rejected</th></tr>
                        </thead>
                        <tbody>${currencyRows}</tbody>
                    </table>

                    <h2>សង្ខេបតាមវគ្គ</h2>
                    <table>
                        <thead>
                            <tr><th>វគ្គសិក្សា</th><th>រូបិយប័ណ្ណ</th><th>Paid</th><th>Approved</th><th>ចំណូលបានបញ្ជាក់</th><th>Pending</th><th>ប្រាក់រង់ចាំ</th><th>Waived</th><th>ប្រាក់លើកលែង</th><th>Discount</th><th>Rejected</th><th>ប្រាក់ Rejected</th><th>ចំណូលរំពឹងទុក</th></tr>
                        </thead>
                        <tbody>${courseRows}</tbody>
                    </table>
                    <script>setTimeout(() => window.print(), 500);<\/script>
                </body>
            </html>
        `);
        printWindow.document.close();
        printWindow.focus();
    }
</script>

<div class="space-y-5 mb-6">
    <section class="bg-base-100 border border-base-300 shadow-sm rounded-xl p-5">
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
            <div>
                <div class="flex items-center gap-2 text-primary mb-1">
                    <UsersIcon class="w-5 h-5" />
                    <h3 class="font-bold text-xl text-gray-900">ការចុះឈ្មោះវគ្គសិក្សា</h3>
                </div>
                <p class="text-sm text-gray-500">មើល Free/Paid course registrations និង approve payment នៅទីនេះ</p>
            </div>

            <div class="flex flex-col sm:flex-row gap-2">
                <select bind:value={statusFilter} class="select select-bordered bg-white min-w-44">
                    <option value="all">ស្ថានភាពទាំងអស់</option>
                    <option value="pending_payment">រង់ចាំ payment</option>
                    <option value="registered">បានចុះឈ្មោះ</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="waived">Waived</option>
                </select>
                <button class="btn btn-outline" on:click={loadEnrollments} disabled={loading}>
                    {#if loading}
                        <span class="loading loading-spinner loading-sm"></span>
                    {:else}
                        <RefreshCwIcon class="w-4 h-4" />
                    {/if}
                    Refresh
                </button>
                <button class="btn btn-success text-white" on:click={exportEnrollmentReportCsv} disabled={filteredEnrollments.length === 0 || loading}>
                    <DownloadIcon class="w-4 h-4" />
                    Excel
                </button>
                <button class="btn btn-warning text-white" on:click={printEnrollmentReport} disabled={filteredEnrollments.length === 0 || loading}>
                    <PrinterIcon class="w-4 h-4" />
                    PDF
                </button>
            </div>
        </div>

        {#if !setupNeeded && !errorMessage}
            <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-5">
                <div class="rounded-xl border border-primary/20 bg-primary/5 p-4">
                    <div class="flex items-center justify-between text-primary">
                        <span class="text-xs font-bold">សរុប</span>
                        <UsersIcon class="w-4 h-4" />
                    </div>
                    <div class="text-3xl font-bold text-primary mt-2">{enrollmentStats.total}</div>
                </div>
                <div class="rounded-xl border border-warning/30 bg-warning/10 p-4">
                    <div class="flex items-center justify-between text-warning">
                        <span class="text-xs font-bold">រង់ចាំ</span>
                        <ClockIcon class="w-4 h-4" />
                    </div>
                    <div class="text-3xl font-bold text-warning mt-2">{enrollmentStats.pending}</div>
                </div>
                <div class="rounded-xl border border-success/30 bg-success/10 p-4">
                    <div class="flex items-center justify-between text-success">
                        <span class="text-xs font-bold">Approved</span>
                        <CheckCircleIcon class="w-4 h-4" />
                    </div>
                    <div class="text-3xl font-bold text-success mt-2">{enrollmentStats.approved}</div>
                </div>
                <div class="rounded-xl border border-info/30 bg-info/10 p-4">
                    <div class="flex items-center justify-between text-info">
                        <span class="text-xs font-bold">Free</span>
                        <UsersIcon class="w-4 h-4" />
                    </div>
                    <div class="text-3xl font-bold text-info mt-2">{enrollmentStats.registered}</div>
                </div>
                <div class="rounded-xl border border-secondary/30 bg-secondary/10 p-4">
                    <div class="flex items-center justify-between text-secondary">
                        <span class="text-xs font-bold">Paid</span>
                        <CreditCardIcon class="w-4 h-4" />
                    </div>
                    <div class="text-3xl font-bold text-secondary mt-2">{enrollmentStats.paid}</div>
                </div>
            </div>

            <div class="mt-5">
                <div class="flex items-center justify-between mb-2">
                    <button class="flex items-center gap-2 text-sm font-bold text-gray-600 hover:text-primary transition-colors" on:click={() => showSummary = !showSummary}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 transition-transform {showSummary ? 'rotate-90' : ''}">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                        📊 សង្ខេបទិន្នន័យ ({demographicStats.total} នាក់)
                    </button>
                    {#if showSummary}
                        <div class="flex gap-2">
                            <button class="btn btn-xs btn-square btn-warning text-white shadow-sm text-base" on:click={printEnrollmentSummaryStats} title="ព្រីនតារាងសង្ខេប (Print/PDF)">🖨️</button>
                            <button class="btn btn-xs btn-square btn-success text-white shadow-sm text-base" on:click={exportEnrollmentSummaryStatsToExcel} title="ទាញយកតារាងសង្ខេបជា Excel">📊</button>
                        </div>
                    {/if}
                </div>

                {#if showSummary}
                    <div class="space-y-3" in:slide={{ duration: 200 }}>
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div class="bg-indigo-50 border border-indigo-100 rounded-xl p-3 text-center">
                                <div class="text-2xl font-black text-indigo-700">{demographicStats.total}</div>
                                <div class="text-xs text-indigo-500 font-medium">សរុប</div>
                            </div>
                            {#each sortedEntries(demographicStats.gender) as [gender, count]}
                                <div class="rounded-xl p-3 text-center {gender === 'ប្រុស' ? 'bg-blue-50 border border-blue-100' : gender === 'ស្រី' ? 'bg-pink-50 border border-pink-100' : 'bg-gray-50 border border-gray-100'}">
                                    <div class="text-2xl font-black {gender === 'ប្រុស' ? 'text-blue-700' : gender === 'ស្រី' ? 'text-pink-700' : 'text-gray-700'}">{count}</div>
                                    <div class="text-xs font-medium {gender === 'ប្រុស' ? 'text-blue-500' : gender === 'ស្រី' ? 'text-pink-500' : 'text-gray-500'}">{gender}</div>
                                </div>
                            {/each}
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                            <div class="bg-violet-50 border border-violet-100 rounded-xl p-3">
                                <div class="text-xs font-bold text-violet-700 mb-2">មុខតំណែង / កម្រិតជំនាញ</div>
                                <div class="space-y-1 max-h-48 overflow-y-auto pr-1">
                                    {#each sortedEntries(demographicStats.position) as [label, count]}
                                        <div class="flex justify-between items-center gap-2">
                                            <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                                            <span class="text-xs font-bold text-violet-700 shrink-0">{count}</span>
                                            <div class="w-16 bg-violet-100 rounded-full h-1.5 shrink-0">
                                                <div class="bg-violet-400 h-1.5 rounded-full" style="width:{percentWidth(count, demographicStats.total)}%"></div>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </div>

                            <div class="bg-teal-50 border border-teal-100 rounded-xl p-3">
                                <div class="text-xs font-bold text-teal-700 mb-2">ទីកន្លែងធ្វើការ</div>
                                <div class="space-y-1 max-h-48 overflow-y-auto pr-1">
                                    {#each sortedEntries(demographicStats.workplace) as [label, count]}
                                        <div class="flex justify-between items-center gap-2">
                                            <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                                            <span class="text-xs font-bold text-teal-700 shrink-0">{count}</span>
                                            <div class="w-16 bg-teal-100 rounded-full h-1.5 shrink-0">
                                                <div class="bg-teal-400 h-1.5 rounded-full" style="width:{percentWidth(count, demographicStats.total)}%"></div>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </div>

                            <div class="bg-amber-50 border border-amber-100 rounded-xl p-3">
                                <div class="text-xs font-bold text-amber-700 mb-2">រាជធានី/ខេត្ត</div>
                                <div class="space-y-1 max-h-48 overflow-y-auto pr-1">
                                    {#each sortedEntries(demographicStats.province) as [label, count]}
                                        <div class="flex justify-between items-center gap-2">
                                            <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                                            <span class="text-xs font-bold text-amber-700 shrink-0">{count}</span>
                                            <div class="w-16 bg-amber-100 rounded-full h-1.5 shrink-0">
                                                <div class="bg-amber-400 h-1.5 rounded-full" style="width:{percentWidth(count, demographicStats.total)}%"></div>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </div>

                            <div class="bg-rose-50 border border-rose-100 rounded-xl p-3">
                                <div class="text-xs font-bold text-rose-700 mb-2">ស្ថានភាពអាជ្ញាប័ណ្ណ</div>
                                <div class="space-y-1 max-h-48 overflow-y-auto pr-1">
                                    {#each sortedEntries(demographicStats.licenseStatus) as [label, count]}
                                        <div class="flex justify-between items-center gap-2">
                                            <span class="text-xs text-gray-700 truncate flex-1" title={label}>{label}</span>
                                            <span class="text-xs font-bold text-rose-700 shrink-0">{count}</span>
                                            <div class="w-16 bg-rose-100 rounded-full h-1.5 shrink-0">
                                                <div class="bg-rose-400 h-1.5 rounded-full" style="width:{percentWidth(count, demographicStats.total)}%"></div>
                                            </div>
                                        </div>
                                    {/each}
                                </div>
                            </div>
                        </div>
                    </div>
                {/if}
            </div>

            <div class="mt-5 rounded-xl border border-cyan-200 bg-cyan-50 p-4">
                <div class="flex items-center justify-between mb-3">
                    <button class="flex items-center gap-2 text-sm font-bold text-cyan-800 hover:text-cyan-900 transition-colors" on:click={() => showCouponManager = !showCouponManager}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 transition-transform {showCouponManager ? 'rotate-90' : ''}">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                        Coupon / បញ្ចុះតម្លៃ
                    </button>
                    <span class="badge badge-info badge-sm text-white">{coupons.length}</span>
                </div>

                {#if showCouponManager}
                    <div class="space-y-4" in:slide={{ duration: 200 }}>
                        <div class="grid grid-cols-1 lg:grid-cols-7 gap-2 bg-white border border-cyan-100 rounded-xl p-3">
                            <input class="input input-sm input-bordered bg-white" placeholder="Code ឧ. CPD50" bind:value={couponForm.code} />
                            <select class="select select-sm select-bordered bg-white" bind:value={couponForm.course_id}>
                                <option value="">គ្រប់វគ្គ</option>
                                {#each couponCourseOptions as course}
                                    <option value={course.id}>{course.title}</option>
                                {/each}
                            </select>
                            <select class="select select-sm select-bordered bg-white" bind:value={couponForm.discount_type}>
                                <option value="percent">%</option>
                                <option value="amount">Amount</option>
                            </select>
                            <input type="number" min="0" class="input input-sm input-bordered bg-white" placeholder="Value" bind:value={couponForm.discount_value} />
                            <select class="select select-sm select-bordered bg-white" bind:value={couponForm.currency}>
                                <option value="KHR">KHR</option>
                                <option value="USD">USD</option>
                            </select>
                            <input type="number" min="0" class="input input-sm input-bordered bg-white" placeholder="Max uses" bind:value={couponForm.max_uses} />
                            <button class="btn btn-sm btn-info text-white" on:click={saveCoupon}>Save</button>
                            <input class="input input-sm input-bordered bg-white lg:col-span-3" placeholder="Description" bind:value={couponForm.description} />
                            <input type="datetime-local" class="input input-sm input-bordered bg-white lg:col-span-2" bind:value={couponForm.expires_at} />
                        </div>

                        <div class="overflow-x-auto rounded-lg border border-cyan-100 bg-white">
                            <table class="table table-xs">
                                <thead>
                                    <tr>
                                        <th>Code</th>
                                        <th>វគ្គ</th>
                                        <th>Discount</th>
                                        <th>ប្រើប្រាស់</th>
                                        <th>ផុតកំណត់</th>
                                        <th>ស្ថានភាព</th>
                                        <th class="text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {#if couponLoading}
                                        <tr><td colspan="7" class="text-center py-4">កំពុងផ្ទុក...</td></tr>
                                    {:else if coupons.length === 0}
                                        <tr><td colspan="7" class="text-center py-4 text-gray-400">មិនទាន់មាន coupon</td></tr>
                                    {:else}
                                        {#each coupons as coupon}
                                            <tr>
                                                <td class="font-bold">{coupon.code}</td>
                                                <td>{coupon.course?.title || 'គ្រប់វគ្គ'}</td>
                                                <td>{coupon.discount_type === 'percent' ? `${coupon.discount_value}%` : formatCurrency(coupon.discount_value, coupon.currency)}</td>
                                                <td>{coupon.used_count || 0}{coupon.max_uses ? ` / ${coupon.max_uses}` : ''}</td>
                                                <td>{formatDate(coupon.expires_at)}</td>
                                                <td>
                                                    <span class="badge badge-sm {coupon.is_active ? 'badge-success' : 'badge-ghost'}">
                                                        {coupon.is_active ? 'Active' : 'Inactive'}
                                                    </span>
                                                </td>
                                                <td class="text-right">
                                                    <button class="btn btn-xs btn-outline" on:click={() => toggleCoupon(coupon)}>
                                                        {coupon.is_active ? 'Disable' : 'Enable'}
                                                    </button>
                                                </td>
                                            </tr>
                                        {/each}
                                    {/if}
                                </tbody>
                            </table>
                        </div>
                    </div>
                {/if}
            </div>

            <div class="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
                    <button class="flex items-center gap-2 text-sm font-bold text-emerald-800 hover:text-emerald-900 transition-colors" on:click={() => showFinance = !showFinance}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4 transition-transform {showFinance ? 'rotate-90' : ''}">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                        </svg>
                        របាយការណ៍ហិរញ្ញវត្ថុ
                    </button>
                    {#if showFinance}
                        <div class="flex gap-2">
                            <button class="btn btn-xs btn-square btn-warning text-white shadow-sm text-base" on:click={printFinanceReport} disabled={financeStats.paidCount === 0 || loading} title="ព្រីនរបាយការណ៍ហិរញ្ញវត្ថុ (Print/PDF)">🖨️</button>
                            <button class="btn btn-xs btn-square btn-success text-white shadow-sm text-base" on:click={exportFinanceReportCsv} disabled={financeStats.paidCount === 0 || loading} title="ទាញយករបាយការណ៍ហិរញ្ញវត្ថុជា Excel">📊</button>
                        </div>
                    {/if}
                </div>

                {#if showFinance}
                    <div class="space-y-4" in:slide={{ duration: 200 }}>
                        <div class="grid grid-cols-2 lg:grid-cols-6 gap-3">
                            <div class="rounded-xl border border-emerald-200 bg-white p-4">
                                <div class="text-xs font-bold text-emerald-700">Paid សរុប</div>
                                <div class="text-2xl font-black text-emerald-800 mt-1">{financeStats.paidCount}</div>
                                <div class="text-xs text-gray-500">អ្នកបង់ប្រាក់</div>
                            </div>
                            <div class="rounded-xl border border-sky-200 bg-white p-4">
                                <div class="text-xs font-bold text-sky-700">Free សរុប</div>
                                <div class="text-2xl font-black text-sky-800 mt-1">{financeStats.freeCount}</div>
                                <div class="text-xs text-gray-500">មិនគិតចំណូល</div>
                            </div>
                            <div class="rounded-xl border border-green-200 bg-white p-4">
                                <div class="text-xs font-bold text-green-700">ចំណូលបានបញ្ជាក់</div>
                                {#if financeStats.currencies.length === 0}
                                    <div class="text-2xl font-black text-green-800 mt-1">0</div>
                                {:else}
                                    {#each financeStats.currencies as row}
                                        <div class="text-lg font-black text-green-800 mt-1">{formatCurrency(row.approvedAmount, row.currency)}</div>
                                    {/each}
                                {/if}
                            </div>
                            <div class="rounded-xl border border-amber-200 bg-white p-4">
                                <div class="text-xs font-bold text-amber-700">ប្រាក់កំពុងរង់ចាំ</div>
                                {#if financeStats.currencies.length === 0}
                                    <div class="text-2xl font-black text-amber-800 mt-1">0</div>
                                {:else}
                                    {#each financeStats.currencies as row}
                                        <div class="text-lg font-black text-amber-800 mt-1">{formatCurrency(row.pendingAmount, row.currency)}</div>
                                    {/each}
                                {/if}
                            </div>
                            <div class="rounded-xl border border-purple-200 bg-white p-4">
                                <div class="text-xs font-bold text-purple-700">ប្រាក់លើកលែង</div>
                                {#if financeStats.currencies.length === 0}
                                    <div class="text-2xl font-black text-purple-800 mt-1">0</div>
                                {:else}
                                    {#each financeStats.currencies as row}
                                        <div class="text-lg font-black text-purple-800 mt-1">{formatCurrency(row.waivedAmount, row.currency)}</div>
                                    {/each}
                                {/if}
                            </div>
                            <div class="rounded-xl border border-cyan-200 bg-white p-4">
                                <div class="text-xs font-bold text-cyan-700">Discount Coupon</div>
                                {#if financeStats.currencies.length === 0}
                                    <div class="text-2xl font-black text-cyan-800 mt-1">0</div>
                                {:else}
                                    {#each financeStats.currencies as row}
                                        <div class="text-lg font-black text-cyan-800 mt-1">{formatCurrency(row.discountAmount, row.currency)}</div>
                                    {/each}
                                {/if}
                            </div>
                        </div>

                        {#if financeStats.currencies.length > 0}
                            <div class="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                {#each financeStats.currencies as row}
                                    <div class="rounded-xl border border-emerald-100 bg-white p-3">
                                        <div class="flex items-center justify-between mb-2">
                                            <div class="font-bold text-gray-900">{row.currency}</div>
                                            <div class="badge badge-success badge-sm">{row.paidCount} paid</div>
                                        </div>
                                        <div class="grid grid-cols-2 lg:grid-cols-5 gap-2 text-center">
                                            <div class="rounded-lg bg-green-50 p-2">
                                                <div class="text-xs text-green-700 font-bold">Approved</div>
                                                <div class="text-sm font-black text-green-800">{formatCurrency(row.approvedAmount, row.currency)}</div>
                                                <div class="text-[11px] text-gray-500">{row.approvedCount} នាក់</div>
                                            </div>
                                            <div class="rounded-lg bg-amber-50 p-2">
                                                <div class="text-xs text-amber-700 font-bold">Pending</div>
                                                <div class="text-sm font-black text-amber-800">{formatCurrency(row.pendingAmount, row.currency)}</div>
                                                <div class="text-[11px] text-gray-500">{row.pendingCount} នាក់</div>
                                            </div>
                                            <div class="rounded-lg bg-red-50 p-2">
                                                <div class="text-xs text-red-700 font-bold">Rejected</div>
                                                <div class="text-sm font-black text-red-800">{formatCurrency(row.rejectedAmount, row.currency)}</div>
                                                <div class="text-[11px] text-gray-500">{row.rejectedCount} នាក់</div>
                                            </div>
                                            <div class="rounded-lg bg-purple-50 p-2">
                                                <div class="text-xs text-purple-700 font-bold">Waived</div>
                                                <div class="text-sm font-black text-purple-800">{formatCurrency(row.waivedAmount, row.currency)}</div>
                                                <div class="text-[11px] text-gray-500">{row.waivedCount} នាក់</div>
                                            </div>
                                            <div class="rounded-lg bg-cyan-50 p-2">
                                                <div class="text-xs text-cyan-700 font-bold">Discount</div>
                                                <div class="text-sm font-black text-cyan-800">{formatCurrency(row.discountAmount, row.currency)}</div>
                                                <div class="text-[11px] text-gray-500">Coupon</div>
                                            </div>
                                        </div>
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        <div class="overflow-x-auto rounded-lg border border-emerald-100 bg-white">
                            <table class="table table-xs">
                                <thead>
                                    <tr>
                                        <th>វគ្គសិក្សា</th>
                                        <th>រូបិយប័ណ្ណ</th>
                                        <th class="text-center">Paid</th>
                                        <th class="text-center">Approved</th>
                                        <th class="text-right">ចំណូលបានបញ្ជាក់</th>
                                        <th class="text-center">Pending</th>
                                        <th class="text-right">ប្រាក់រង់ចាំ</th>
                                        <th class="text-center">Waived</th>
                                        <th class="text-right">ប្រាក់លើកលែង</th>
                                        <th class="text-right">Discount</th>
                                        <th class="text-center">Rejected</th>
                                        <th class="text-right">ប្រាក់ Rejected</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {#if courseFinanceRows.length === 0}
                                        <tr>
                                            <td colspan="12" class="text-center text-gray-400 py-4">មិនទាន់មានវគ្គបង់ប្រាក់តាម filter នេះទេ</td>
                                        </tr>
                                    {:else}
                                        {#each courseFinanceRows as row}
                                            <tr>
                                                <td class="font-medium max-w-80 truncate">{row.title}</td>
                                                <td>{row.currency}</td>
                                                <td class="text-center font-bold">{row.paidCount}</td>
                                                <td class="text-center text-success font-bold">{row.approvedCount}</td>
                                                <td class="text-right font-bold text-success">{formatCurrency(row.approvedAmount, row.currency)}</td>
                                                <td class="text-center text-warning font-bold">{row.pendingCount}</td>
                                                <td class="text-right font-bold text-warning">{formatCurrency(row.pendingAmount, row.currency)}</td>
                                                <td class="text-center text-purple-700 font-bold">{row.waivedCount}</td>
                                                <td class="text-right font-bold text-purple-700">{formatCurrency(row.waivedAmount, row.currency)}</td>
                                                <td class="text-right font-bold text-cyan-700">{formatCurrency(row.discountAmount, row.currency)}</td>
                                                <td class="text-center text-error font-bold">{row.rejectedCount}</td>
                                                <td class="text-right font-bold text-error">{formatCurrency(row.rejectedAmount, row.currency)}</td>
                                            </tr>
                                        {/each}
                                    {/if}
                                </tbody>
                            </table>
                        </div>
                    </div>
                {/if}
            </div>

            <div class="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
                    <div>
                        <h4 class="font-bold text-gray-900">របាយការណ៍សង្ខេបតាមវគ្គ</h4>
                        <p class="text-xs text-gray-500 mt-1">តារាងនេះប្រើ filter/search បច្ចុប្បន្ន: {filteredStats.total} កំណត់ត្រា</p>
                    </div>
                    <div class="flex gap-2">
                        <button class="btn btn-sm btn-outline btn-success" on:click={exportCourseSummaryCsv} disabled={courseReportRows.length === 0 || loading}>
                            <DownloadIcon class="w-4 h-4" />
                            Summary Excel
                        </button>
                        <button class="btn btn-sm btn-outline btn-warning" on:click={printEnrollmentReport} disabled={filteredEnrollments.length === 0 || loading}>
                            <PrinterIcon class="w-4 h-4" />
                            Print/PDF
                        </button>
                    </div>
                </div>

                {#if courseReportRows.length === 0}
                    <div class="text-sm text-gray-400 py-4 text-center">មិនទាន់មានទិន្នន័យសម្រាប់របាយការណ៍</div>
                {:else}
                    <div class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                        <table class="table table-xs">
                            <thead>
                                <tr>
                                    <th>វគ្គសិក្សា</th>
                                    <th class="text-center">សរុប</th>
                                    <th class="text-center">រង់ចាំ</th>
                                    <th class="text-center">Approved</th>
                                    <th class="text-center">Free Reg.</th>
                                    <th class="text-center">Rejected</th>
                                    <th class="text-center">Paid</th>
                                    <th class="text-center">Free</th>
                                </tr>
                            </thead>
                            <tbody>
                                {#each courseReportRows as row}
                                    <tr>
                                        <td class="font-medium max-w-80 truncate">{row.title}</td>
                                        <td class="text-center font-bold">{row.total}</td>
                                        <td class="text-center text-warning font-bold">{row.pending}</td>
                                        <td class="text-center text-success font-bold">{row.approved}</td>
                                        <td class="text-center text-info font-bold">{row.registered}</td>
                                        <td class="text-center text-error font-bold">{row.rejected}</td>
                                        <td class="text-center">{row.paid}</td>
                                        <td class="text-center">{row.free}</td>
                                    </tr>
                                {/each}
                            </tbody>
                        </table>
                    </div>
                {/if}
            </div>
        {/if}
    </section>

    {#if setupNeeded}
        <div class="alert alert-warning text-sm">
            មិនទាន់មាន table <strong>course_enrollments</strong> ទេ។ សូម run migration:
            <code>supabase/migrations/20260707000100_course_enrollments.sql</code>
        </div>
    {:else if errorMessage}
        <div class="alert alert-error text-sm">{errorMessage}</div>
    {:else}
        <section class="bg-base-100 border border-base-300 shadow-sm rounded-xl overflow-hidden">
            <div class="p-4 border-b border-base-300 bg-gray-50">
                <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
                    <div>
                        <h4 class="font-bold text-gray-900">បញ្ជីអ្នកចុះឈ្មោះ</h4>
                        <p class="text-xs text-gray-500 mt-1">ថ្ងៃបិទចុះឈ្មោះបិទតែអ្នកថ្មី។ Admin អាចបន្ថែមអ្នកដែលបានចូលរៀនតាម Zoom/Telegram ដោយដៃបាន។</p>
                    </div>
                    <button class="btn btn-sm {showManualAdd ? 'btn-primary' : 'btn-outline btn-primary'}" on:click={() => showManualAdd = !showManualAdd}>
                        {showManualAdd ? 'បិទការបន្ថែមដោយដៃ' : '+ បន្ថែមអ្នកចុះឈ្មោះដោយដៃ'}
                    </button>
                </div>

                {#if showManualAdd}
                    <div class="mb-4 rounded-xl border border-primary/20 bg-white p-4">
                        <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_220px] gap-3">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div class="form-control">
                                    <label class="label py-1"><span class="label-text font-bold text-gray-700">ជ្រើសវគ្គសិក្សា</span></label>
                                    <select bind:value={manualCourseId} class="select select-bordered bg-white">
                                        <option value="">-- ជ្រើសវគ្គ --</option>
                                        {#each courses as course}
                                            <option value={course.id}>{course.title}</option>
                                        {/each}
                                    </select>
                                    {#if manualCourse}
                                        {@const manualProgram = programConfigFor(manualCourse)}
                                        <div class="text-xs text-gray-500 mt-1">
                                            {manualProgram.pricing_type === 'paid' ? `Paid: ${formatCurrency(manualProgram.price, manualProgram.currency)}` : 'Free'} · អាចបន្ថែមបាន ទោះ registration បិទក៏ដោយ
                                        </div>
                                    {/if}
                                </div>
                                <div class="form-control">
                                    <label class="label py-1"><span class="label-text font-bold text-gray-700">ស្ថានភាពបញ្ចូល</span></label>
                                    <select bind:value={manualAddMode} class="select select-bordered bg-white">
                                        <option value="approved">Approved / បានចូលរៀនហើយ</option>
                                        <option value="waived">Approved + Waived payment</option>
                                        <option value="pending_payment">Pending payment</option>
                                    </select>
                                </div>
                            </div>
                            <div class="rounded-xl bg-primary/5 border border-primary/10 p-3 text-xs text-gray-600">
                                ប្រើសម្រាប់អ្នកដែលចូល Zoom តាម Telegram ប៉ុន្តែមិនបានចុះឈ្មោះក្នុង app មុនថ្ងៃបិទ។
                            </div>
                        </div>

                        <div class="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px] gap-2">
                            <label class="input input-bordered bg-white flex items-center gap-2">
                                <SearchIcon class="w-4 h-4 text-gray-400" />
                                <input bind:value={manualUserSearch} type="text" class="grow" placeholder="ស្វែងរកសមាជិកតាមឈ្មោះ ឬលេខទូរស័ព្ទ..." on:keydown={(e) => e.key === 'Enter' && searchManualUsers()} />
                            </label>
                            <button class="btn btn-primary" on:click={searchManualUsers} disabled={manualAddLoading || manualUserSearch.trim().length < 2}>
                                {manualAddLoading ? 'កំពុងរក...' : 'ស្វែងរក'}
                            </button>
                        </div>

                        {#if manualUserResults.length > 0}
                            <div class="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                {#each manualUserResults as user}
                                    <div class="rounded-xl border border-gray-200 bg-gray-50 p-3 flex items-center justify-between gap-3">
                                        <div class="min-w-0">
                                            <div class="font-bold text-gray-900 truncate">{user.full_name || user.name_latin || 'មិនមានឈ្មោះ'}</div>
                                            <div class="text-xs text-gray-500 truncate">{[user.phone_number, user.name_latin, user.gender].filter(Boolean).join(' · ')}</div>
                                        </div>
                                        <button class="btn btn-xs btn-success text-white" on:click={() => addManualEnrollment(user)} disabled={!manualCourseId || manualAddLoading}>
                                            បន្ថែម
                                        </button>
                                    </div>
                                {/each}
                            </div>
                        {/if}
                    </div>
                {/if}

                <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-3">
                    <label class="input input-bordered bg-white flex items-center gap-2">
                        <SearchIcon class="w-4 h-4 text-gray-400" />
                        <input bind:value={searchTerm} type="text" class="grow" placeholder="ស្វែងរកឈ្មោះ លេខទូរស័ព្ទ ឬវគ្គ..." />
                    </label>
                    <select bind:value={courseFilter} class="select select-bordered bg-white">
                        <option value="all">វគ្គទាំងអស់</option>
                        {#each courseOptions as course}
                            <option value={course.id}>{course.title}</option>
                        {/each}
                    </select>
                </div>
            </div>

            {#if loading}
                <div class="py-14 text-center text-gray-400">
                    <span class="loading loading-spinner loading-md text-primary"></span>
                    <div class="text-sm mt-3">កំពុងផ្ទុក...</div>
                </div>
            {:else if filteredEnrollments.length === 0}
                <div class="py-14 text-center text-gray-400">
                    <UsersIcon class="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <div class="font-medium">មិនទាន់មានការចុះឈ្មោះតាម filter នេះទេ</div>
                </div>
            {:else}
                {#if selectedCount > 0}
                    <div class="mx-4 mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                        <div class="font-bold text-primary">
                            បានជ្រើស {selectedCount} ការចុះឈ្មោះ
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <button class="btn btn-sm btn-success text-white" on:click={() => bulkUpdateEnrollments('approved')} disabled={bulkLoading}>
                                <CheckCircleIcon class="w-4 h-4" />
                                Approve ច្រើន
                            </button>
                            <button class="btn btn-sm btn-error text-white" on:click={() => bulkUpdateEnrollments('rejected')} disabled={bulkLoading}>
                                <XCircleIcon class="w-4 h-4" />
                                Reject ច្រើន
                            </button>
                            <button class="btn btn-sm btn-outline btn-error" on:click={bulkDeleteEnrollments} disabled={bulkLoading}>
                                <Trash2Icon class="w-4 h-4" />
                                លុបច្រើន
                            </button>
                            <button class="btn btn-sm btn-ghost" on:click={clearSelection} disabled={bulkLoading}>
                                ដកជម្រើស
                            </button>
                        </div>
                    </div>
                {/if}
                <div class="overflow-x-auto">
                    <table class="table table-zebra">
                        <thead class="bg-white">
                            <tr>
                                <th class="w-10">
                                    <input
                                        type="checkbox"
                                        class="checkbox checkbox-sm checkbox-primary"
                                        checked={allFilteredSelected}
                                        on:change={toggleAllFiltered}
                                        aria-label="ជ្រើសទាំងអស់"
                                    />
                                </th>
                                <th>សមាជិក</th>
                                <th>វគ្គសិក្សា</th>
                                <th>Payment</th>
                                <th>ស្ថានភាព</th>
                                <th>ថ្ងៃចុះឈ្មោះ</th>
                                <th class="text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each filteredEnrollments as row}
                                <tr>
                                    <td>
                                        <input
                                            type="checkbox"
                                            class="checkbox checkbox-sm checkbox-primary"
                                            checked={selectedEnrollmentIds.has(row.id)}
                                            on:change={() => toggleEnrollmentSelection(row.id)}
                                            aria-label="ជ្រើសការចុះឈ្មោះ"
                                        />
                                    </td>
                                    <td class="min-w-56">
                                        <div class="flex items-center gap-3">
                                            <div class="avatar placeholder">
                                                <div class="bg-primary/10 text-primary rounded-full w-10">
                                                    <span class="text-sm font-bold">{memberName(row).slice(0, 1)}</span>
                                                </div>
                                            </div>
                                            <div>
                                                <div class="font-bold text-gray-900">{memberName(row)}</div>
                                                <div class="text-xs text-gray-500">{memberMeta(row) || '-'}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td class="min-w-64">
                                        <div class="font-medium text-gray-900">{row.course?.title || '-'}</div>
                                        <div class="text-xs text-gray-500">ID: {row.course_id}</div>
                                    </td>
                                    <td>
                                        <span class="badge badge-sm {row.pricing_type === 'paid' ? 'badge-warning' : 'badge-success'}">
                                            {paymentLabel(row)}
                                        </span>
                                        {#if Number(row.discount_amount || 0) > 0}
                                            <div class="text-xs text-cyan-600 mt-1">Coupon: {row.coupon_code || '-'} (-{formatCurrency(row.discount_amount, row.currency)})</div>
                                        {/if}
                                        {#if row.payment_status === 'waived'}
                                            <div class="text-xs text-purple-600 mt-1">Waived: {row.waiver_reason || '-'}</div>
                                        {/if}
                                        {#if row.payment_reference}
                                            <div class="text-xs font-mono text-gray-600 mt-1 break-all">Ref: {row.payment_reference}</div>
                                        {/if}
                                        {#if row.payment_proof_url}
                                            <a href={row.payment_proof_url} target="_blank" rel="noreferrer"
                                                class="btn btn-xs btn-outline btn-info mt-2">
                                                មើលបង្កាន់ដៃ
                                            </a>
                                        {/if}
                                        <div class="text-xs text-gray-500 mt-1">{row.payment_status || '-'}</div>
                                    </td>
                                    <td>
                                        <span class="badge badge-sm {statusClass(row)}">{statusLabel(row)}</span>
                                        {#if row.approved_at}
                                            <div class="text-xs text-gray-500 mt-1">ដោយ {row.approver?.full_name || row.approver?.name_latin || '-'}</div>
                                        {/if}
                                    </td>
                                    <td class="text-xs min-w-36">{formatDate(row.registered_at)}</td>
                                    <td class="text-right min-w-44">
                                        {#if row.status === 'pending_payment'}
                                            <div class="flex flex-wrap justify-end gap-2">
                                                <button class="btn btn-xs btn-success text-white" on:click={() => updateEnrollment(row, 'approved')}>
                                                    <CheckCircleIcon class="w-3 h-3" />
                                                    Approve
                                                </button>
                                                <button class="btn btn-xs btn-error text-white" on:click={() => updateEnrollment(row, 'rejected')}>
                                                    <XCircleIcon class="w-3 h-3" />
                                                    Reject
                                                </button>
                                                <button class="btn btn-xs btn-secondary text-white" on:click={() => waiveEnrollment(row)}>
                                                    Waive
                                                </button>
                                                <button class="btn btn-xs btn-outline btn-error" on:click={() => deleteEnrollment(row)}>
                                                    <Trash2Icon class="w-3 h-3" />
                                                    លុប
                                                </button>
                                            </div>
                                        {:else}
                                            <div class="flex flex-wrap justify-end gap-2">
                                                <button class="btn btn-xs btn-outline" on:click={() => updateEnrollment(row, 'approved')} disabled={row.status === 'approved'}>
                                                    Mark Approved
                                                </button>
                                                {#if row.pricing_type === 'paid' && row.payment_status !== 'waived'}
                                                    <button class="btn btn-xs btn-secondary text-white" on:click={() => waiveEnrollment(row)}>
                                                        Waive
                                                    </button>
                                                {/if}
                                                <button class="btn btn-xs btn-outline btn-error" on:click={() => deleteEnrollment(row)}>
                                                    <Trash2Icon class="w-3 h-3" />
                                                    លុប
                                                </button>
                                            </div>
                                        {/if}
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            {/if}
        </section>
    {/if}
</div>
