<script>
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';
    import {
        PlusIcon, PencilIcon, Trash2Icon, CopyIcon, BookOpenIcon, SaveIcon, XIcon, UploadIcon,
        RefreshCwIcon, EyeIcon, DownloadIcon, FileTextIcon, AwardIcon, ImageIcon, GripVerticalIcon, FolderOpenIcon, UsersIcon, SearchIcon
    } from 'lucide-svelte';
    import { PUBLIC_R2_PUBLIC_URL } from '$env/static/public';
    import { normalizeAssetUrl } from '$lib/utils.js';
    import CertificateEditor from '$lib/Components/admin/CertificateEditor.svelte';
    import QuizManager from '$lib/Components/admin/QuizManager.svelte';
    export let supabase;
    export let courses = [];
    export let currentUser;

    const dispatch = createEventDispatcher();
    let showModal = false;
    let loading = false;
    let activeTab = 'general'; // 'general' | 'certificate'
    let editingCourse = {};
    let evaluationForms = [];

    let courseSearch = '';
    $: filteredCourses = courses.filter(c => 
        (c.title || '').toLowerCase().includes(courseSearch.toLowerCase()) || 
        (c.description || '').toLowerCase().includes(courseSearch.toLowerCase())
    );

    // State for Lessons & Questions
    let editingLessons = [];
    let newLesson = { title: '', url: '' };
    let editingLessonId = null;
    let isUploading = false;

    // File Picker State
    let showFilePicker = false;
    let filePickerTarget = '';
    let pickerFiles = [];
    let pickerLoading = false;
    let pickerCursor = null;
    let pickerHasMore = false;
    let pickerSearch = '';
    let pickerFilter = 'all';
    let pickerPreviewUrl = null;
    let pickerPreviewType = null;
    let pickerPreviewKey = null;
    let selectedPickerFiles = new Set();
    let pickerUploading = false;
    let pickerUploadTotal = 0;
    let pickerUploadCompleted = 0;
    const R2_URL = PUBLIC_R2_PUBLIC_URL;

    $: filteredPickerFiles = pickerFiles.filter(f => {
        if (pickerFilter === 'all') return true;
        const ext = f.key.split('.').pop().toLowerCase();
        if (pickerFilter === 'image') return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
        if (pickerFilter === 'pdf') return ext === 'pdf';
        if (pickerFilter === 'video') return ['mp4', 'webm', 'ogg', 'mov'].includes(ext);
        return true;
    });

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
        require_payment_approval: true,
        require_attendance: false,
        require_test_pass: true,
        require_evaluation: true,
        certificate_enabled: true
    };

    function programConfigFor(course) {
        return {
            ...defaultProgramConfig,
            ...(course?.cert_config?.program || {})
        };
    }

    function normalizeProgramConfig(config = {}) {
        const normalized = { ...defaultProgramConfig, ...config };
        normalized.price = Number(normalized.price || 0);
        normalized.capacity = normalized.capacity === '' || normalized.capacity === undefined ? null : normalized.capacity;
        if (normalized.access_mode === 'open_access') {
            normalized.pricing_type = 'free';
            normalized.price = 0;
            normalized.require_payment_approval = false;
        }
        if (normalized.pricing_type === 'free') {
            normalized.price = 0;
            normalized.require_payment_approval = false;
        }
        return normalized;
    }

    function formatProgramPrice(program) {
        const amount = Number(program?.price || 0);
        return `${amount.toLocaleString()} ${program?.currency || 'KHR'}`;
    }

    function updateProgramConfig(updates) {
        editingCourse.cert_config = editingCourse.cert_config || {};
        editingCourse.cert_config.program = normalizeProgramConfig({
            ...(editingCourse.cert_config.program || {}),
            ...updates
        });
        editingCourse = { ...editingCourse };
    }

    async function loadPickerFiles(reset = false) {
        if (reset) { pickerFiles = []; pickerCursor = null; }
        pickerLoading = true;
        try {
            let url = `/api/storage?limit=20&prefix=${encodeURIComponent(pickerSearch)}`;
            if (pickerCursor) url += `&cursor=${encodeURIComponent(pickerCursor)}`;
            const res = await fetch(url, {
                headers: { 'X-User-Id': currentUser?.id || '' }
            });
            const data = await res.json();
            if (data.objects) {
                pickerFiles = [...pickerFiles, ...data.objects];
                pickerHasMore = data.truncated;
                pickerCursor = data.cursor;
            }
        } catch(e) { console.error(e); }
        finally { pickerLoading = false; }
    }

    function openFilePicker(target) {
        filePickerTarget = target;
        showFilePicker = true;
        pickerFilter = 'all';
        selectedPickerFiles.clear();
        closePickerPreview();
        loadPickerFiles(true);
    }

    function selectPickerFile(key) {
        if (filePickerTarget === 'bulk_lessons') {
            togglePickerFileSelection(key);
            return;
        }
        const url = `${R2_URL}/${key}`;
        if (filePickerTarget === 'course_pdf') editingCourse.pdf_url = url;
        else if (filePickerTarget === 'thumbnail_url') editingCourse.thumbnail_url = url;
        else if (filePickerTarget === 'lesson_url') newLesson.url = url;
        
        editingCourse = editingCourse; // Svelte Reactivity Fix
        newLesson = newLesson;         // Svelte Reactivity Fix
        showFilePicker = false;
    }

    function openPickerPreview(e, file) {
        e.stopPropagation();
        const ext = file.key.split('.').pop().toLowerCase();
        pickerPreviewUrl = `${R2_URL}/${file.key}`;
        pickerPreviewKey = file.key;
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) pickerPreviewType = 'image';
        else if (ext === 'pdf') pickerPreviewType = 'pdf';
        else if (['mp4', 'webm', 'ogg', 'mov'].includes(ext)) pickerPreviewType = 'video';
    }

    function closePickerPreview() {
        pickerPreviewUrl = null;
        pickerPreviewType = null;
        pickerPreviewKey = null;
    }

    function togglePickerFileSelection(key) {
        if (selectedPickerFiles.has(key)) selectedPickerFiles.delete(key);
        else selectedPickerFiles.add(key);
        selectedPickerFiles = selectedPickerFiles;
    }

    async function addBulkLessons() {
        if (selectedPickerFiles.size === 0) return;
        
        const filesToAdd = Array.from(selectedPickerFiles).map(key => {
            const url = `${R2_URL}/${key}`;
            const filename = key.split('/').pop();
            const title = filename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
            return { title, url };
        });

        const payloads = filesToAdd.map((f, i) => ({
            course_id: editingCourse.id,
            title: f.title,
            url: f.url,
            sort_order: editingLessons.length + i
        }));

        pickerLoading = true;
        const { error } = await supabase.from('lessons').insert(payloads);
        pickerLoading = false;

        if (error) alert("មានបញ្ហាពេលបញ្ចូលមេរៀន: " + error.message);
        else {
            selectedPickerFiles.clear();
            showFilePicker = false;
            loadLessons(editingCourse.id);
        }
    }

    function toggleSelectAllPickerFiles(e) {
        if (e.target.checked) filteredPickerFiles.forEach(f => selectedPickerFiles.add(f.key));
        else selectedPickerFiles.clear();
        selectedPickerFiles = selectedPickerFiles;
    }

    async function deleteSelectedPickerFiles() {
        if (selectedPickerFiles.size === 0) return;
        if (!confirm(`តើអ្នកពិតជាចង់លុបឯកសារចំនួន ${selectedPickerFiles.size} នេះមែនទេ?`)) return;
        pickerLoading = true;
        try {
            const files = Array.from(selectedPickerFiles);
            await Promise.all(files.map(key => fetch('/api/storage', { 
                method: 'DELETE', 
                headers: { 'X-User-Id': currentUser?.id || '', 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: key }) 
            })));
            selectedPickerFiles.clear();
            await loadPickerFiles(true);
            closePickerPreview();
        } catch (e) {
            alert("Error deleting: " + e.message);
        } finally {
            pickerLoading = false;
        }
    }

    async function handlePickerUpload(e) {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        
        pickerUploading = true;
        pickerUploadTotal = files.length;
        pickerUploadCompleted = 0;
        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const formData = new FormData();
                const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
                const renamedFile = new File([file], safeName, { type: file.type });
                
                formData.append('file', renamedFile);
                formData.append('folder', 'uploads');
                
                const res = await fetch('/api/storage', {
                    method: 'POST',
                    headers: { 'X-User-Id': currentUser?.id || '' },
                    body: formData
                });
                if (!res.ok) throw new Error(await res.text());
                pickerUploadCompleted++;
            }
            
            await loadPickerFiles(true);
        } catch (error) {
            alert("មានបញ្ហាក្នុងការ Upload: " + error.message);
        } finally {
            pickerUploading = false;
            e.target.value = '';
        }
    }

    async function renamePickerFile(e, file) {
        e.stopPropagation();
        const oldName = file.key.split('/').pop();
        const folderMatch = file.key.match(/^(.*)\//);
        const folder = folderMatch ? folderMatch[1] : 'uploads';

        let newName = prompt("បញ្ចូលឈ្មោះថ្មីសម្រាប់ឯកសារនេះ:", oldName);
        if (!newName || newName === oldName) return;

        // រក្សាទុកកន្ទុយឯកសារ (Extension) ដដែល
        const oldExt = oldName.split('.').pop();
        if (!newName.toLowerCase().endsWith('.' + oldExt.toLowerCase())) {
            newName += '.' + oldExt;
        }
        const safeName = newName.replace(/[^a-zA-Z0-9.-]/g, '_');
        
        pickerLoading = true;
        try {
            // ទាញយក (Download) -> បញ្ចូលថ្មី (Upload) -> លុបចាស់ (Delete)
            const fileRes = await fetch(`${R2_URL}/${file.key}`);
            if (!fileRes.ok) throw new Error("មិនអាចទាញយកឯកសារដើមបានទេ (CORS Error)");
            const blob = await fileRes.blob();
            
            const formData = new FormData();
            formData.append('file', new File([blob], safeName, { type: blob.type }));
            formData.append('folder', folder);
            
            const uploadRes = await fetch('/api/storage', { method: 'POST', headers: { 'X-User-Id': currentUser?.id || '' }, body: formData });
            if (!uploadRes.ok) throw new Error(await uploadRes.text());
            
            await fetch('/api/storage', { method: 'DELETE', headers: { 'X-User-Id': currentUser?.id || '', 'Content-Type': 'application/json' }, body: JSON.stringify({ url: file.key }) });
            
            await loadPickerFiles(true);
        } catch (error) {
            alert("មានបញ្ហាពេលប្តូរឈ្មោះ: " + error.message + "\n(បញ្ជាក់៖ R2 Bucket របស់អ្នកត្រូវអនុញ្ញាត CORS ទើបអាចប្តូរឈ្មោះបាន)");
        } finally {
            pickerLoading = false;
        }
    }

    async function loadEvaluationForms() {
        // ទាញយកទាំង Form ដែលមិនទាន់ Publish (Draft) មកបង្ហាញដែរ ដើម្បីងាយស្រួលតេស្ត
        const { data } = await supabase.from('custom_forms').select('id, title, is_published').is('deleted_at', null).order('created_at', { ascending: false }).limit(200);
        evaluationForms = data || [];
    }

    async function loadLessons(courseId) {
        if (!courseId) { editingLessons = []; return; }
        const { data } = await supabase.from('lessons').select('*').eq('course_id', courseId).order('sort_order', { ascending: true });
        editingLessons = data || [];
    }

    async function deleteLesson(id) {
        if (!confirm('តើអ្នកពិតជាចង់លុបមេរៀននេះមែនទេ?')) return;
        const { error } = await supabase.from('lessons').delete().eq('id', id);
        if (error) alert(error.message);
        else loadLessons(editingCourse.id);
    }

    function cancelLessonEdit() {
        editingLessonId = null;
        newLesson = { title: '', url: '' };
    }

    function editLesson(lesson) {
        editingLessonId = lesson.id;
        newLesson = { title: lesson.title, url: lesson.url };
    }

    async function handleLessonUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        loading = true;
        const formData = new FormData();
        // ប្តូរឈ្មោះឯកសារក្នុង Client Side ផងដែរដើម្បីសុវត្ថិភាព (Optional, server side already handles it)
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const renamedFile = new File([file], safeName, { type: file.type });
        
        formData.append('file', renamedFile);
        formData.append('folder', 'lessons');

        try {
            const res = await fetch('/api/storage', { 
                method: 'POST', 
                headers: { 'X-User-Id': currentUser?.id || '' },
                body: formData 
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            
            newLesson.url = data.publicUrl;
            // Auto-fill title from filename if empty
            if (!newLesson.title) {
                newLesson.title = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
            }
            newLesson = newLesson; // Svelte Reactivity Fix
        } catch (error) {
            alert("Upload failed: " + error.message);
        } finally {
            loading = false;
        }
    }

    async function saveLesson() {
        if (!newLesson.title || !newLesson.url) return alert('សូមបញ្ចូលចំណងជើង និងតំណភ្ជាប់មេរៀន!');
        
        const payload = {
            course_id: editingCourse.id,
            title: newLesson.title,
            url: newLesson.url,
            sort_order: editingLessons.length
        };

        let error;
        if (editingLessonId) {
            const { error: err } = await supabase.from('lessons').update({ title: newLesson.title, url: newLesson.url }).eq('id', editingLessonId);
            error = err;
        } else {
            const { error: err } = await supabase.from('lessons').insert(payload);
            error = err;
        }

        if (error) alert(error.message);
        else {
            cancelLessonEdit();
            loadLessons(editingCourse.id);
        }
    }

    // Lesson Drag & Drop
    let draggedLesson = null;

    function handleDragStart(e, index) {
        draggedLesson = index;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.dropEffect = 'move';
    }

    function handleDragOver(e) {
        e.preventDefault();
    }

    async function handleDrop(e, index) {
        e.preventDefault();
        if (draggedLesson === null || draggedLesson === index) return;
        
        const item = editingLessons[draggedLesson];
        editingLessons.splice(draggedLesson, 1);
        editingLessons.splice(index, 0, item);
        editingLessons = editingLessons;
        draggedLesson = null;
        
        // Update sort_order in DB
        const updates = editingLessons.map((l, i) => ({ id: l.id, sort_order: i }));
        await supabase.from('lessons').upsert(updates);
    }

    function downloadCsvTemplate() {
        const headers = ['question', 'options', 'correct_answer', 'explanation'];
        const example = ['"សំណួរគំរូ?"', '"ជម្រើស១, ជម្រើស២, ជម្រើស៣"', '"ជម្រើស១"', '"ការពន្យល់ (បើមាន)"'];
        const csvContent = "\uFEFF" + [headers.join(','), example.join(',')].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'quiz_template.csv';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href); // Clean up memory
    }

    function openModal(course = null) {
        loadEvaluationForms();
        editingCourse = course ? JSON.parse(JSON.stringify(course)) : {
            title: '',
            description: '',
            pdf_url: '',
            thumbnail_url: '',
            cert_template_url: '',
            passing_score: 70,
            is_published: true,
            allow_download: false,
            is_featured: false,
            cpd_points: 0,
            duration: '',
            quiz_cooldown: 60,
            evaluation_form_id: null,
            start_date: null,
            end_date: null,
            post_test_auto_close_date: null
        };
        // ធានាថា evaluation_form_id ត្រូវបានកំណត់ជានិច្ច (ការពារករណីវគ្គសិក្សាចាស់ៗដែលមិនទាន់មាន column នេះ)
        if (editingCourse.evaluation_form_id === undefined) editingCourse.evaluation_form_id = null;
        if (editingCourse.has_pre_test === undefined) editingCourse.has_pre_test = false;
        if (editingCourse.is_featured === undefined) editingCourse.is_featured = false;
        if (editingCourse.cpd_points === undefined) editingCourse.cpd_points = 0;
        if (editingCourse.quiz_cooldown === undefined) editingCourse.quiz_cooldown = 60;

        // Initialize Certificate Config (កំណត់តម្លៃដើមសម្រាប់លិខិតបញ្ជាក់)
        if (!editingCourse.cert_config) editingCourse.cert_config = {};
        const programConfig = normalizeProgramConfig(editingCourse.cert_config.program);
        const certDefaults = {
            name: { x: 500, y: 300, fontSize: 50, color: '#000000', font: 'Arial', fontWeight: 'bold', align: 'center' },
            name_latin: { x: 500, y: 400, fontSize: 30, color: '#000000', font: 'Arial', fontWeight: 'bold', align: 'center' },
            qr: { x: 100, y: 100, size: 100 },
            id: { x: 500, y: 500, fontSize: 20, color: '#000000', fontWeight: 'bold', align: 'center' }
        };
        
        editingCourse.cert_config = {
            ...editingCourse.cert_config,
            name: { ...certDefaults.name, ...(editingCourse.cert_config.name || {}) },
            name_latin: { ...certDefaults.name_latin, ...(editingCourse.cert_config.name_latin || {}) },
            qr: { ...certDefaults.qr, ...(editingCourse.cert_config.qr || {}) },
            id: { ...certDefaults.id, ...(editingCourse.cert_config.id || {}) },
            program: programConfig
        };

        // Format dates for input
        if (editingCourse.start_date) editingCourse.start_date = new Date(editingCourse.start_date).toISOString().split('T')[0];
        if (editingCourse.end_date) editingCourse.end_date = new Date(editingCourse.end_date).toISOString().split('T')[0];
        if (editingCourse.post_test_auto_close_date) editingCourse.post_test_auto_close_date = new Date(editingCourse.post_test_auto_close_date).toISOString().slice(0, 16);
        if (editingCourse.post_test_fixed_date) editingCourse.post_test_fixed_date = new Date(editingCourse.post_test_fixed_date).toISOString().slice(0, 16);
        if (editingCourse.lessons_enabled === undefined) editingCourse.lessons_enabled = true;
        if (editingCourse.allow_download === undefined) editingCourse.allow_download = false;
        
        loadLessons(editingCourse.id);

        activeTab = 'general';
        showModal = true;
    }

    async function handleUpload(e, field, folder = 'courses') {
        const file = e.target.files[0];
        if (!file) return;

        if (field === 'thumbnail_url' && !['image/jpeg', 'image/png'].includes(file.type)) {
            alert("សូម Upload តែឯកសារប្រភេទ JPG ឬ PNG ប៉ុណ្ណោះ!");
            e.target.value = '';
            return;
        }
        
        loading = true;
        const formData = new FormData();
        const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
        const renamedFile = new File([file], safeName, { type: file.type });
        formData.append('file', renamedFile);
        formData.append('folder', folder);

        try {
            const res = await fetch('/api/storage', { 
                method: 'POST', 
                headers: { 'X-User-Id': currentUser?.id || '' },
                body: formData 
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            
            editingCourse[field] = data.publicUrl;
            // Trigger reactivity to ensure the new URL is bound to the input and ready for save
            editingCourse = { ...editingCourse };
        } catch (error) {
            alert("Upload failed: " + error.message);
        } finally {
            loading = false;
        }
    }

    async function saveCourse() {
        if (!editingCourse.title) return alert("សូមបញ្ចូលចំណងជើងវគ្គសិក្សា!");

        loading = true;

        editingCourse.cert_config = {
            ...(editingCourse.cert_config || {}),
            program: normalizeProgramConfig(editingCourse.cert_config?.program)
        };
        
        // STRICT WHITELIST: Only send columns that exist in the 'courses' table
        const payload = {
            title: editingCourse.title,
            title_en: editingCourse.title_en,
            description: editingCourse.description,
            description_en: editingCourse.description_en,
            duration: editingCourse.duration,
            cpd_points: editingCourse.cpd_points,
            quiz_cooldown: editingCourse.quiz_cooldown,
            quiz_passing_score: editingCourse.passing_score, // UI uses passing_score, DB uses quiz_passing_score
            is_published: editingCourse.is_published,
            is_featured: editingCourse.is_featured,
            has_pre_test: editingCourse.has_pre_test,
            allow_download: editingCourse.allow_download,
            pdf_url: editingCourse.pdf_url,
            thumbnail_url: editingCourse.thumbnail_url,
            cert_template_url: editingCourse.cert_template_url,
            cert_config: editingCourse.cert_config,
            evaluation_form_id: editingCourse.evaluation_form_id,
            sort_order: editingCourse.sort_order,
            post_test_auto_close_date: editingCourse.post_test_auto_close_date || null,
            post_test_fixed_date: editingCourse.post_test_fixed_date || null,
            cert_start_date: editingCourse.start_date || editingCourse.cert_start_date || null,
            cert_end_date: editingCourse.end_date || editingCourse.cert_end_date || null,
            lessons_enabled: editingCourse.lessons_enabled
        };

        // Handle ID: Only include if valid UUID (not new)
        if (editingCourse.id && !String(editingCourse.id).includes('new')) {
            payload.id = editingCourse.id;
        }

        const { error } = await supabase.from('courses').upsert(payload).select().single();
        
        loading = false;
        if (error) {
            alert("Error: " + error.message);
        } else {
            showModal = false;
            dispatch('refresh');
        }
    }

    async function togglePublish(course) {
        const { error } = await supabase.from('courses').update({ is_published: !course.is_published }).eq('id', course.id);
        if (error) alert("Error: " + error.message);
        else dispatch('refresh');
    }

    async function duplicateCourse(course) {
        if (!confirm(`តើអ្នកចង់ចម្លងវគ្គ "${course.title}" នេះមែនទេ?`)) return;
        
        isUploading = true;

        // STRICT WHITELIST for duplication
        const payload = {
            title: `${course.title} (Copy)`,
            title_en: course.title_en,
            description: course.description,
            description_en: course.description_en,
            duration: course.duration,
            cpd_points: course.cpd_points,
            quiz_cooldown: course.quiz_cooldown,
            quiz_passing_score: course.quiz_passing_score || course.passing_score,
            is_published: false, // Default to draft
            is_featured: false,
            has_pre_test: course.has_pre_test,
            allow_download: course.allow_download,
            pdf_url: course.pdf_url,
            thumbnail_url: course.thumbnail_url,
            cert_template_url: course.cert_template_url,
            cert_config: course.cert_config,
            evaluation_form_id: course.evaluation_form_id,
            sort_order: (courses.length || 0) + 1,
            lessons_enabled: course.lessons_enabled,
            // Reset dates
            post_test_auto_close_date: null,
            post_test_fixed_date: null,
            cert_start_date: null,
            cert_end_date: null
        };

        try {
            const { data: newCourseData, error } = await supabase.from('courses').insert(payload).select().single();
            if (error) throw error;

            // Copy Lessons
            const { data: lessons } = await supabase.from('lessons').select('*').eq('course_id', course.id);
            if (lessons && lessons.length > 0) {
                const newLessons = lessons.map(({ id, created_at, course_id, ...rest }) => ({ 
                    ...rest, 
                    course_id: newCourseData.id 
                }));
                const { error: lessonError } = await supabase.from('lessons').insert(newLessons);
                if (lessonError) throw lessonError;
            }

            // Copy Quiz Questions
            const { data: questions } = await supabase.from('quiz_questions').select('*').eq('course_id', course.id);
            if (questions && questions.length > 0) {
                const newQuestions = questions.map(({ id, created_at, course_id, ...rest }) => ({ 
                    ...rest, 
                    course_id: newCourseData.id 
                }));
                const { error: quizError } = await supabase.from('quiz_questions').insert(newQuestions);
                if (quizError) throw quizError;
            }

            alert("បានចម្លងវគ្គសិក្សាដោយជោគជ័យ!");
            dispatch('refresh');
        } catch (e) { 
            alert("កំហុស: " + e.message); 
        } finally { 
            isUploading = false; 
        }
    }

    function openTestManager(course) {
        openModal(course);
        activeTab = 'lessons_questions';
    }

    // --- Participants Tab ---
    let courseParticipants = [];
    let participantsLoading = false;

    async function loadParticipants(courseId) {
        if (!courseId) return;
        participantsLoading = true;
        courseParticipants = [];
        try {
            const { data, error } = await supabase
                .from('student_quiz_results')
                .select('created_at, user_id, users(full_name, name_latin, gender, phone_number, profile_data)')
                .eq('course_id', courseId)
                .eq('type', 'post')
                .eq('passed', true)
                .order('created_at', { ascending: true })
                .limit(3000);
            if (error) throw error;
            // Deduplicate by user_id (keep earliest pass)
            const seen = new Set();
            courseParticipants = (data || []).filter(r => {
                if (seen.has(r.user_id)) return false;
                seen.add(r.user_id);
                return true;
            });
        } catch(e) {
            alert('កំហុស: ' + e.message);
        } finally {
            participantsLoading = false;
        }
    }

    function exportParticipantsCsv() {
        const headers = ['ល.រ', 'កាលបរិច្ឆេទ', 'ឈ្មោះខ្មែរ', 'ឈ្មោះឡាតាំង', 'ភេទ', 'តួនាទី', 'ទីកន្លែងធ្វើការ', 'រាជធានី/ខេត្ត', 'ស្ថានភាពអាជ្ញាប័ណ្ណ', 'លេខទូរស័ព្ទ'];
        const rows = courseParticipants.map((r, i) => {
            const u = r.users || {};
            const pd = u.profile_data || {};
            return [
                i + 1,
                new Date(r.created_at).toLocaleDateString('km-KH'),
                u.full_name || '',
                u.name_latin || '',
                u.gender || '',
                pd.position || '',
                pd.workplace || '',
                pd.province || '',
                pd.license_status || '',
                u.phone_number || ''
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        });
        const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `participants_${editingCourse.title || 'course'}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    }

    $: participantStats = (() => {
        if (!courseParticipants.length) return null;
        const male = courseParticipants.filter(r => r.users?.gender === 'Male').length;
        const female = courseParticipants.filter(r => r.users?.gender === 'Female').length;
        const withLicense = courseParticipants.filter(r => r.users?.profile_data?.license_status === 'មាន').length;
        const provinceCounts = {};
        courseParticipants.forEach(r => {
            const p = r.users?.profile_data?.province || 'មិនបញ្ជាក់';
            provinceCounts[p] = (provinceCounts[p] || 0) + 1;
        });
        const topProvinces = Object.entries(provinceCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
        const positionCounts = {};
        courseParticipants.forEach(r => {
            const p = r.users?.profile_data?.position || 'មិនបញ្ជាក់';
            positionCounts[p] = (positionCounts[p] || 0) + 1;
        });
        const topPositions = Object.entries(positionCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
        const workplaceCounts = {};
        courseParticipants.forEach(r => {
            const w = r.users?.profile_data?.workplace || 'មិនបញ្ជាក់';
            workplaceCounts[w] = (workplaceCounts[w] || 0) + 1;
        });
        const topWorkplaces = Object.entries(workplaceCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
        return { male, female, withLicense, topProvinces, topPositions, topWorkplaces };
    })();

    async function deleteCourse(id) {
        if (!confirm("តើអ្នកពិតជាចង់លុបវគ្គសិក្សានេះមែនទេ?")) return;
        const { error } = await supabase.from('courses').update({ deleted_at: new Date().toISOString() }).eq('id', id);
        if (error) alert(error.message);
        else dispatch('refresh');
    }

    function switchCourseTab(tab) {
        if (tab !== 'general' && !editingCourse.id) {
            alert('សូមរក្សាទុកវគ្គសិក្សា (Save) ជាមុនសិន ទើបអាចបន្ថែមមេរៀន សំណួរ ឬលិខិតបញ្ជាក់បាន!');
            return;
        }
        activeTab = tab;
        if (tab === 'participants' && editingCourse.id) {
            loadParticipants(editingCourse.id);
        }
    }
</script>

<div class="space-y-6">
    <div class="card bg-base-100 p-5 shadow-md border border-base-300">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <h3 class="font-bold text-xl text-gray-800">📚 គ្រប់គ្រងវគ្គសិក្សា</h3>
            </div>
            <div class="flex flex-wrap gap-2 w-full md:w-auto justify-end items-center">
                <button on:click={() => openModal()} class="btn btn-sm btn-primary shadow-sm hover:shadow-md">
                    <PlusIcon class="w-4 h-4 mr-1" /> បង្កើតវគ្គថ្មី
                </button>
                <button on:click={() => dispatch('refresh')} class="btn btn-sm btn-outline shadow-sm hover:shadow-md">
                    <RefreshCwIcon class="w-4 h-4" /> Refresh
                </button>
            </div>
        </div>
        
        <div class="bg-base-200/50 p-3 border border-base-300 rounded-xl mt-4 flex flex-col xl:flex-row gap-3 items-start xl:items-center justify-between">
            <div class="flex flex-wrap gap-2 w-full xl:w-auto flex-1 items-center">
                <div class="relative w-full sm:w-auto sm:min-w-[300px]">
                    <SearchIcon class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input type="text" bind:value={courseSearch} placeholder="ស្វែងរកចំណងជើង ឬការពិពណ៌នាវគ្គ..." class="input input-sm input-bordered w-full pl-8" />
                </div>
            </div>
            <div class="text-sm text-gray-500 font-medium shrink-0">
                សរុប: {filteredCourses.length} វគ្គ
            </div>
        </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {#each filteredCourses as course (course.id)}
            {@const program = programConfigFor(course)}
            <div class="card bg-base-100 shadow-sm border border-base-300 hover:shadow-md transition-all group">
                <figure class="h-40 bg-gray-100 relative overflow-hidden">
                    {#if course.thumbnail_url || course.cover_url}
                        <img src={normalizeAssetUrl(course.thumbnail_url || course.cover_url, PUBLIC_R2_PUBLIC_URL)} alt={course.title} class="w-full h-full object-cover" />
                    {:else}
                        <div class="flex items-center justify-center w-full h-full text-gray-300 text-4xl">📚</div>
                    {/if}
                    {#if !course.is_published}
                        <div class="absolute top-2 right-2 badge badge-warning">Draft</div>
                    {/if}
                </figure>
                <div class="card-body p-4">
                    <h3 class="font-bold text-lg text-base-content line-clamp-1">{course.title}</h3>
                    <div class="flex flex-wrap gap-1.5">
                        {#if program.access_mode === 'program_enrollment'}
                            <span class="badge badge-sm badge-primary">ត្រូវចុះឈ្មោះ</span>
                            {#if program.pricing_type === 'paid'}
                                <span class="badge badge-sm badge-warning">{formatProgramPrice(program)}</span>
                            {:else}
                                <span class="badge badge-sm badge-success">Free</span>
                            {/if}
                        {:else}
                            <span class="badge badge-sm badge-ghost">Open Access</span>
                        {/if}
                    </div>
                    
                    <div class="flex justify-between items-center mt-2">
                        <div class="text-xs text-gray-500">ពិន្ទុជាប់: {course.passing_score}%</div>
                        <label class="label cursor-pointer p-0 gap-2">
                            <span class="label-text text-xs {course.is_published ? 'text-success' : 'text-gray-400'}">
                                {course.is_published ? 'ផ្សាយ' : 'Draft'}
                            </span> 
                            <input type="checkbox" checked={course.is_published} on:change={() => togglePublish(course)} class="toggle toggle-xs toggle-success" />
                        </label>
                    </div>

                    <div class="grid grid-cols-2 gap-2 mt-4">
                        <button on:click={() => openTestManager(course)} class="btn btn-xs btn-outline btn-info">
                            <BookOpenIcon class="w-3 h-3 mr-1" /> មេរៀន/តេស្ត
                        </button>
                        <button on:click={() => duplicateCourse(course)} class="btn btn-xs btn-outline btn-warning">
                            <CopyIcon class="w-3 h-3 mr-1" /> ចម្លង
                        </button>
                        <button on:click={() => openModal(course)} class="btn btn-xs btn-outline btn-primary">
                            <PencilIcon class="w-3 h-3 mr-1" /> កែប្រែ
                        </button>
                        <button on:click={() => deleteCourse(course.id)} class="btn btn-xs btn-outline btn-error">
                            <Trash2Icon class="w-3 h-3 mr-1" /> លុប
                        </button>
                    </div>
                </div>
            </div>
        {/each}
    </div>
</div>

<!-- Modal -->
{#if showModal}
    <div class="modal modal-open bg-black/40" transition:fade={{ duration: 200 }}>
        <div class="modal-box w-11/12 max-w-6xl bg-base-100 p-0 overflow-hidden rounded-2xl flex flex-col max-h-[92vh]">
            <!-- Header -->
            <div class="bg-base-200 px-6 py-4 border-b border-base-300 flex justify-between items-center shrink-0">
                <div>
                    <h3 class="font-bold text-lg text-base-content">{editingCourse.id ? 'កែប្រែវគ្គសិក្សា' : 'បង្កើតវគ្គសិក្សាថ្មី'}</h3>
                    <p class="text-xs text-gray-500 mt-0.5">រៀបចំព័ត៌មានវគ្គ ការចុះឈ្មោះ មេរៀន និងលិខិតបញ្ជាក់</p>
                </div>
                <button on:click={() => showModal = false} class="rounded-full w-8 h-8 hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none text-gray-500"><XIcon class="w-5 h-5" /></button>
            </div>

            <div class="p-6 overflow-y-auto flex-1">
                <!-- Tabs -->
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-1 p-1 bg-gray-100 rounded-xl mb-6 border border-gray-200 relative">
                    <button class="py-2.5 rounded-lg text-sm font-bold transition-all {activeTab === 'general' ? 'bg-white text-primary shadow-sm border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'}" 
                       on:click={() => switchCourseTab('general')}>
                       <FileTextIcon class="w-4 h-4 mr-1 inline" /> ព័ត៌មានទូទៅ
                    </button>
                    <button class="py-2.5 rounded-lg text-sm font-bold transition-all {activeTab === 'lessons_questions' ? 'bg-white text-primary shadow-sm border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'} {!editingCourse.id ? 'opacity-50 cursor-not-allowed' : ''}"
                       on:click={() => switchCourseTab('lessons_questions')}>
                       <BookOpenIcon class="w-4 h-4 mr-1 inline" /> មេរៀន & សំណួរ
                    </button>
                    <button class="py-2.5 rounded-lg text-sm font-bold transition-all {activeTab === 'certificate' ? 'bg-white text-primary shadow-sm border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'} {!editingCourse.id ? 'opacity-50 cursor-not-allowed' : ''}"
                       on:click={() => switchCourseTab('certificate')}>
                       <AwardIcon class="w-4 h-4 mr-1 inline" /> លិខិតបញ្ជាក់
                    </button>
                    {#if editingCourse.id}
                    <button class="py-2.5 rounded-lg text-sm font-bold transition-all {activeTab === 'participants' ? 'bg-white text-primary shadow-sm border border-gray-200' : 'text-gray-500 hover:bg-gray-200/50'}"
                       on:click={() => switchCourseTab('participants')}>
                       <UsersIcon class="w-4 h-4 mr-1 inline" /> អ្នកចូលរួម
                    </button>
                    {/if}
                </div>

                <!-- Tab Content: General -->
                {#if activeTab === 'general'}
                    <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
                        <div class="space-y-4">
                            <section class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                <div class="flex items-center justify-between gap-3 mb-4">
                                    <div>
                                        <h4 class="font-bold text-gray-900">ព័ត៌មានវគ្គសិក្សា</h4>
                                        <p class="text-xs text-gray-500 mt-1">ចំណុចសំខាន់ដែលសមាជិកនឹងឃើញនៅទំព័រមុខ</p>
                                    </div>
                                    <span class="badge badge-sm {editingCourse.is_published ? 'badge-success' : 'badge-ghost'}">
                                        {editingCourse.is_published ? 'Published' : 'Draft'}
                                    </span>
                                </div>

                                <div class="space-y-4">
                                    <div class="form-control w-full">
                                        <label class="label font-bold text-base-content text-base pb-1">
                                            ចំណងជើងវគ្គសិក្សា <span class="text-red-500 ml-1">*</span>
                                        </label>
                                        <input bind:value={editingCourse.title} class="input input-bordered w-full bg-white text-gray-900 rounded-xl text-lg" placeholder="ឧ. វគ្គបណ្តុះបណ្តាល..." />
                                    </div>

                                    <div class="form-control w-full">
                                        <label class="label font-bold text-base-content pb-1">ការពិពណ៌នា</label>
                                        <textarea bind:value={editingCourse.description} class="textarea textarea-bordered w-full bg-white text-gray-900 h-28 rounded-xl text-base leading-relaxed" placeholder="ពន្យល់សង្ខេបអំពីវគ្គសិក្សា..."></textarea>
                                    </div>
                                </div>
                            </section>

                            <section class="bg-white p-5 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                    <div>
                                        <h4 class="font-bold text-gray-900">ការចូលរៀន និងការចុះឈ្មោះ</h4>
                                        <p class="text-xs text-gray-500 mt-1">ជ្រើសរើសថាវគ្គនេះចូលរៀនភ្លាម ឬត្រូវចុះឈ្មោះជាមុន</p>
                                    </div>
                                    <span class="badge {editingCourse.cert_config.program.access_mode === 'program_enrollment' ? 'badge-primary' : 'badge-ghost'}">
                                        {editingCourse.cert_config.program.access_mode === 'program_enrollment' ? 'Registration Flow' : 'Open Access'}
                                    </span>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <button type="button"
                                        class="text-left p-4 rounded-xl border transition {editingCourse.cert_config.program.access_mode === 'open_access' ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-gray-200 hover:border-primary/40'}"
                                        on:click={() => updateProgramConfig({ access_mode: 'open_access' })}>
                                        <span class="font-bold text-gray-900 block">Open Access</span>
                                        <span class="text-xs text-gray-500 mt-1 block">សមាជិកអាចចូលវគ្គបានភ្លាម ដូចវគ្គចាស់ៗ</span>
                                    </button>
                                    <button type="button"
                                        class="text-left p-4 rounded-xl border transition {editingCourse.cert_config.program.access_mode === 'program_enrollment' ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-gray-200 hover:border-primary/40'}"
                                        on:click={() => updateProgramConfig({ access_mode: 'program_enrollment' })}>
                                        <span class="font-bold text-gray-900 block">ត្រូវចុះឈ្មោះជាមុន</span>
                                        <span class="text-xs text-gray-500 mt-1 block">ប្រើសម្រាប់វគ្គថ្មីដែលមានថ្ងៃរៀន ឬការបង់ប្រាក់</span>
                                    </button>
                                </div>

                                {#if editingCourse.cert_config.program.access_mode === 'program_enrollment'}
                                    <div class="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
                                        <div>
                                            <label class="label font-bold text-gray-700 pb-2">ប្រភេទតម្លៃ</label>
                                            <div class="join w-full">
                                                <button type="button"
                                                    class="join-item btn btn-sm flex-1 {editingCourse.cert_config.program.pricing_type === 'free' ? 'btn-primary text-white' : 'btn-outline'}"
                                                    on:click={() => updateProgramConfig({ pricing_type: 'free' })}>
                                                    Free
                                                </button>
                                                <button type="button"
                                                    class="join-item btn btn-sm flex-1 {editingCourse.cert_config.program.pricing_type === 'paid' ? 'btn-warning text-white' : 'btn-outline'}"
                                                    on:click={() => updateProgramConfig({ pricing_type: 'paid' })}>
                                                    Paid
                                                </button>
                                            </div>
                                        </div>

                                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div class="form-control">
                                                <label class="label py-1"><span class="label-text font-medium text-gray-600 text-xs">តម្លៃ</span></label>
                                                <input type="number" min="0" bind:value={editingCourse.cert_config.program.price}
                                                    disabled={editingCourse.cert_config.program.pricing_type !== 'paid'}
                                                    class="input input-bordered input-sm w-full bg-white" placeholder="0" />
                                            </div>
                                            <div class="form-control">
                                                <label class="label py-1"><span class="label-text font-medium text-gray-600 text-xs">រូបិយប័ណ្ណ</span></label>
                                                <select bind:value={editingCourse.cert_config.program.currency}
                                                    disabled={editingCourse.cert_config.program.pricing_type !== 'paid'}
                                                    class="select select-bordered select-sm w-full bg-white">
                                                    <option value="KHR">KHR</option>
                                                    <option value="USD">USD</option>
                                                </select>
                                            </div>
                                            <div class="form-control">
                                                <label class="label py-1"><span class="label-text font-medium text-gray-600 text-xs">ចំនួនកំណត់</span></label>
                                                <input type="number" min="0" bind:value={editingCourse.cert_config.program.capacity}
                                                    class="input input-bordered input-sm w-full bg-white" placeholder="ទុកទទេ = មិនកំណត់" />
                                            </div>
                                        </div>

                                        {#if editingCourse.cert_config.program.pricing_type === 'paid'}
                                            <div class="form-control">
                                                <label class="label py-1"><span class="label-text font-medium text-gray-600 text-xs">របៀបបង់ប្រាក់ / ការណែនាំ</span></label>
                                                <textarea bind:value={editingCourse.cert_config.program.payment_instructions}
                                                    class="textarea textarea-bordered w-full bg-white h-20 text-sm"
                                                    placeholder="ឧ. ផ្ញើទៅ ABA/ACLEDA... បន្ទាប់មក upload រូបបង្កាន់ដៃ"></textarea>
                                            </div>
                                        {/if}

                                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div class="form-control">
                                                <label class="label py-1"><span class="label-text font-medium text-gray-600 text-xs">ថ្ងៃបើកចុះឈ្មោះ</span></label>
                                                <input type="datetime-local" bind:value={editingCourse.cert_config.program.registration_open_at} class="input input-bordered input-sm w-full bg-white" />
                                            </div>
                                            <div class="form-control">
                                                <label class="label py-1"><span class="label-text font-medium text-gray-600 text-xs">ថ្ងៃបិទចុះឈ្មោះ</span></label>
                                                <input type="datetime-local" bind:value={editingCourse.cert_config.program.registration_close_at} class="input input-bordered input-sm w-full bg-white" />
                                            </div>
                                            <div class="form-control">
                                                <label class="label py-1"><span class="label-text font-medium text-gray-600 text-xs">ថ្ងៃចាប់ផ្តើមរៀន</span></label>
                                                <input type="datetime-local" bind:value={editingCourse.cert_config.program.learning_start_at} class="input input-bordered input-sm w-full bg-white" />
                                            </div>
                                            <div class="form-control">
                                                <label class="label py-1"><span class="label-text font-medium text-gray-600 text-xs">ថ្ងៃបញ្ចប់រៀន</span></label>
                                                <input type="datetime-local" bind:value={editingCourse.cert_config.program.learning_end_at} class="input input-bordered input-sm w-full bg-white" />
                                            </div>
                                        </div>

                                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <label class="flex items-center justify-between bg-white p-3 px-4 rounded-xl border border-gray-200">
                                                <span class="font-bold text-gray-700 text-sm">Admin approve payment</span>
                                                <input type="checkbox" bind:checked={editingCourse.cert_config.program.require_payment_approval}
                                                    disabled={editingCourse.cert_config.program.pricing_type !== 'paid'}
                                                    class="toggle toggle-warning toggle-sm" />
                                            </label>
                                            <label class="flex items-center justify-between bg-white p-3 px-4 rounded-xl border border-gray-200">
                                                <span class="font-bold text-gray-700 text-sm">ត្រូវមានវត្តមាន</span>
                                                <input type="checkbox" bind:checked={editingCourse.cert_config.program.require_attendance} class="toggle toggle-info toggle-sm" />
                                            </label>
                                            <label class="flex items-center justify-between bg-white p-3 px-4 rounded-xl border border-gray-200">
                                                <span class="font-bold text-gray-700 text-sm">ត្រូវប្រឡងជាប់</span>
                                                <input type="checkbox" bind:checked={editingCourse.cert_config.program.require_test_pass} class="toggle toggle-success toggle-sm" />
                                            </label>
                                            <label class="flex items-center justify-between bg-white p-3 px-4 rounded-xl border border-gray-200">
                                                <span class="font-bold text-gray-700 text-sm">ត្រូវវាយតម្លៃមុនយក Certificate</span>
                                                <input type="checkbox" bind:checked={editingCourse.cert_config.program.require_evaluation} class="toggle toggle-primary toggle-sm" />
                                            </label>
                                        </div>
                                    </div>
                                {/if}
                            </section>

                            <details class="bg-white rounded-xl border border-gray-200 shadow-sm">
                                <summary class="px-5 py-4 cursor-pointer font-bold text-gray-900 flex items-center justify-between">
                                    <span>ការកំណត់ម៉ោង Post-test</span>
                                    <span class="text-xs font-normal text-gray-500">Optional</span>
                                </summary>
                                <div class="px-5 pb-5 space-y-3">
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div class="form-control">
                                            <label class="label py-1">
                                                <span class="label-text font-medium text-gray-600 text-xs">ម៉ោង/ថ្ងៃបើក Post-test</span>
                                                <span class="label-text-alt text-xs text-gray-400">ទុកទទេ = បើកភ្លាម</span>
                                            </label>
                                            <input type="datetime-local" bind:value={editingCourse.post_test_fixed_date}
                                                class="input input-bordered input-sm w-full bg-white" />
                                            {#if editingCourse.post_test_fixed_date}
                                                <button class="btn btn-xs btn-ghost text-red-400 mt-1 w-fit" on:click={() => editingCourse.post_test_fixed_date = null}>លុបចេញ</button>
                                            {/if}
                                        </div>
                                        <div class="form-control">
                                            <label class="label py-1">
                                                <span class="label-text font-medium text-gray-600 text-xs">ម៉ោង/ថ្ងៃបិទ Post-test</span>
                                                <span class="label-text-alt text-xs text-gray-400">ទុកទទេ = គ្មានកំណត់</span>
                                            </label>
                                            <input type="datetime-local" bind:value={editingCourse.post_test_auto_close_date}
                                                class="input input-bordered input-sm w-full bg-white" />
                                            {#if editingCourse.post_test_auto_close_date}
                                                <button class="btn btn-xs btn-ghost text-red-400 mt-1 w-fit" on:click={() => editingCourse.post_test_auto_close_date = null}>លុបចេញ</button>
                                            {/if}
                                        </div>
                                    </div>
                                    {#if editingCourse.post_test_fixed_date || editingCourse.post_test_auto_close_date}
                                        <div class="text-xs text-orange-700 bg-orange-50 border border-orange-100 px-3 py-2 rounded-lg leading-relaxed">
                                            {#if editingCourse.post_test_fixed_date && editingCourse.post_test_auto_close_date}
                                                Post-test បើក <strong>{new Date(editingCourse.post_test_fixed_date).toLocaleString('km-KH')}</strong> → បិទ <strong>{new Date(editingCourse.post_test_auto_close_date).toLocaleString('km-KH')}</strong>
                                            {:else if editingCourse.post_test_fixed_date}
                                                Post-test នឹងបើក <strong>{new Date(editingCourse.post_test_fixed_date).toLocaleString('km-KH')}</strong>
                                            {:else}
                                                Post-test នឹងបិទ <strong>{new Date(editingCourse.post_test_auto_close_date).toLocaleString('km-KH')}</strong>
                                            {/if}
                                        </div>
                                    {/if}
                                </div>
                            </details>
                        </div>

                        <aside class="space-y-4 xl:sticky xl:top-0">
                            <section class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm space-y-4">
                                <div>
                                    <h4 class="font-bold text-gray-900">ការកំណត់រហ័ស</h4>
                                    <p class="text-xs text-gray-500 mt-1">កំណត់ស្ថានភាព និងលក្ខខណ្ឌសំខាន់ៗ</p>
                                </div>

                                <div class="grid grid-cols-2 gap-3">
                                    <div class="form-control">
                                        <label class="label py-1"><span class="label-text font-medium text-gray-600 text-xs">រយៈពេល</span></label>
                                        <input bind:value={editingCourse.duration} class="input input-bordered input-sm w-full bg-white" placeholder="ឧ. 2 ម៉ោង" />
                                    </div>
                                    <div class="form-control">
                                        <label class="label py-1"><span class="label-text font-medium text-gray-600 text-xs">ពិន្ទុ CPD</span></label>
                                        <input type="number" bind:value={editingCourse.cpd_points} class="input input-bordered input-sm w-full bg-white" placeholder="0" />
                                    </div>
                                </div>

                                <div class="form-control">
                                    <label class="label py-1"><span class="label-text font-medium text-gray-600 text-xs">Cooldown Post-test (នាទី)</span></label>
                                    <input type="number" bind:value={editingCourse.quiz_cooldown} class="input input-bordered input-sm w-full bg-white" placeholder="60" />
                                </div>

                                <div class="form-control">
                                    <label class="label py-1"><span class="label-text font-bold text-gray-700 text-xs">ទម្រង់វាយតម្លៃ</span></label>
                                    <div class="flex gap-2">
                                        <select bind:value={editingCourse.evaluation_form_id} class="select select-bordered select-sm w-full bg-white text-gray-900">
                                            <option value={null}>មិនតម្រូវ</option>
                                            {#each evaluationForms as form}
                                                <option value={form.id}>{form.title} {form.is_published ? '' : '(Draft)'}</option>
                                            {/each}
                                        </select>
                                        <button class="btn btn-sm btn-outline" on:click={loadEvaluationForms} title="Refresh">
                                            <RefreshCwIcon class="w-4 h-4" />
                                        </button>
                                    </div>
                                    {#if evaluationForms.length === 0}
                                        <div class="text-error text-xs mt-1">មិនមាន Form ទេ។ សូមបង្កើត Form ជាមុនសិន។</div>
                                    {/if}
                                </div>

                                <div class="space-y-2">
                                    <label class="flex items-center justify-between gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200 cursor-pointer">
                                        <span class="font-bold text-gray-700 text-sm">Publish</span>
                                        <input type="checkbox" bind:checked={editingCourse.is_published} class="toggle toggle-success toggle-sm" />
                                    </label>
                                    <label class="flex items-center justify-between gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200 cursor-pointer">
                                        <span class="font-bold text-gray-700 text-sm">Featured</span>
                                        <input type="checkbox" bind:checked={editingCourse.is_featured} class="toggle toggle-warning toggle-sm" />
                                    </label>
                                    <label class="flex items-center justify-between gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200 cursor-pointer">
                                        <span class="font-bold text-gray-700 text-sm">Pre-test</span>
                                        <input type="checkbox" bind:checked={editingCourse.has_pre_test} class="toggle toggle-info toggle-sm" />
                                    </label>
                                    <label class="flex items-center justify-between gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200 cursor-pointer">
                                        <span class="font-bold text-gray-700 text-sm">Download</span>
                                        <input type="checkbox" bind:checked={editingCourse.allow_download} class="toggle toggle-secondary toggle-sm" />
                                    </label>
                                    <label class="flex items-center justify-between gap-3 bg-gray-50 p-3 rounded-xl border border-gray-200 cursor-pointer">
                                        <span class="font-bold text-gray-700 text-sm">Lessons</span>
                                        <input type="checkbox" bind:checked={editingCourse.lessons_enabled} class="toggle toggle-primary toggle-sm" />
                                    </label>
                                </div>
                            </section>

                            <details class="bg-white rounded-xl border border-gray-200 shadow-sm" open>
                                <summary class="px-4 py-3 cursor-pointer font-bold text-gray-900">ឯកសារ និងរូបភាព</summary>
                                <div class="px-4 pb-4 space-y-4">
                                    <div class="form-control w-full">
                                        <label class="label font-bold text-gray-700 pb-1">ឯកសារមេរៀន (PDF/Link)</label>
                                        <div class="flex gap-2">
                                            <input bind:value={editingCourse.pdf_url} class="input input-bordered input-sm w-full bg-white text-gray-900 rounded-lg" placeholder="https://..." />
                                            <button class="btn btn-sm btn-outline" on:click={() => openFilePicker('course_pdf')} title="ជ្រើសរើសឯកសារ">
                                                <FolderOpenIcon class="w-4 h-4" />
                                            </button>
                                            <label class="btn btn-sm btn-primary text-white" title="Upload PDF">
                                                <UploadIcon class="w-4 h-4" />
                                                <input type="file" class="hidden" accept="application/pdf" on:change={(e) => handleUpload(e, 'pdf_url', 'lessons')} />
                                            </label>
                                        </div>
                                    </div>

                                    <div class="form-control w-full">
                                        <label class="label font-bold text-gray-700 pb-1">រូបភាព Cover</label>
                                        <div class="flex gap-2">
                                            <input type="file" accept=".jpg,.jpeg,.png" on:change={(e) => handleUpload(e, 'thumbnail_url')} class="file-input file-input-bordered file-input-sm w-full bg-white text-gray-900 rounded-lg" />
                                            <button class="btn btn-sm btn-outline" on:click={() => openFilePicker('thumbnail_url')} title="ជ្រើសរើសរូបភាព">
                                                <FolderOpenIcon class="w-4 h-4" />
                                            </button>
                                        </div>
                                        {#if editingCourse.thumbnail_url}
                                            <img src={normalizeAssetUrl(editingCourse.thumbnail_url, PUBLIC_R2_PUBLIC_URL)} alt="Cover" class="mt-2 h-28 w-full object-cover rounded-lg border border-gray-200" />
                                        {/if}
                                    </div>
                                </div>
                            </details>
                        </aside>
                    </div>
                {/if}

                <!-- Tab Content: Lessons & Questions -->
                {#if activeTab === 'lessons_questions'}
                    <div class="space-y-6">
                        <!-- Lesson Management -->
                        <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                            <h4 class="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
                                📚 គ្រប់គ្រងមេរៀន <span class="badge badge-primary badge-outline badge-sm">{editingLessons.length}</span>
                            </h4>
                            
                            <!-- Lesson List -->
                            <div class="space-y-3 mb-6">
                                {#each editingLessons as lesson, i (lesson.id)}
                                    <div 
                                        class="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100 hover:border-primary/30 transition-colors group cursor-move"
                                        draggable="true"
                                        on:dragstart={(e) => handleDragStart(e, i)}
                                        on:dragover={handleDragOver}
                                        on:drop={(e) => handleDrop(e, i)}

                                    >
                                        <GripVerticalIcon class="w-4 h-4 text-gray-400" />
                                        <div class="w-8 h-8 rounded-full bg-white flex items-center justify-center text-xs font-bold text-gray-500 shadow-sm border border-gray-100">
                                            {i + 1}
                                        </div>
                                        <div class="flex-1 min-w-0">
                                            <div class="font-bold text-gray-800 text-sm truncate">{lesson.title}</div>
                                            <a href={lesson.url} target="_blank" class="text-xs text-blue-500 hover:underline truncate block opacity-70">{lesson.url}</a>
                                        </div>
                                        <div class="flex gap-1">
                                            <button on:click={() => editLesson(lesson)} class="w-8 h-8 rounded-lg hover:bg-blue-50 flex items-center justify-center cursor-pointer border-0 outline-none" style="color: #0056b3;">
                                                <PencilIcon class="w-4 h-4" />
                                            </button>
                                            <button on:click={() => deleteLesson(lesson.id)} class="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center cursor-pointer border-0 outline-none" style="color: #ef4444;">
                                                <Trash2Icon class="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                {:else}
                                    <div class="text-center py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200 text-gray-400 text-sm">
                                        មិនទាន់មានមេរៀន
                                    </div>
                                {/each}
                            </div>

                            <!-- Add/Edit Lesson Form -->
                            <div class="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                <div class="flex justify-between items-center mb-3">
                                    <h5 class="font-bold text-gray-800 text-sm">{editingLessonId ? '✏️ កែប្រែមេរៀន' : '➕ បន្ថែមមេរៀនថ្មី'}</h5>
                                    <div class="flex gap-2">
                                        {#if !editingLessonId}
                                            <button class="btn btn-xs btn-outline btn-success" on:click={() => openFilePicker('bulk_lessons')} title="ជ្រើសរើសឯកសារច្រើនបញ្ចូលជាមេរៀនតែម្តង">
                                                <FolderOpenIcon class="w-3 h-3 mr-1" /> រើសច្រើន (Bulk Add)
                                            </button>
                                        {/if}
                                        {#if editingLessonId}
                                        <button on:click={cancelLessonEdit} class="flex items-center px-2 py-1 rounded hover:bg-gray-100 cursor-pointer border-0 outline-none text-gray-500">
                                            <XIcon class="w-3 h-3 mr-1" /> បោះបង់
                                        </button>
                                        {/if}
                                    </div>
                                </div>
                                <div class="flex flex-col gap-3">
                                    <input bind:value={newLesson.title} class="input input-sm input-bordered w-full rounded-lg" placeholder="ចំណងជើងមេរៀន..." />
                                    <div class="flex gap-2">
                                        <input bind:value={newLesson.url} class="input input-sm input-bordered w-full rounded-lg" placeholder="Link (YouTube/PDF)..." />
                                        <button class="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-300 bg-white hover:bg-blue-50 cursor-pointer shrink-0" style="color: #0099cc;" on:click={() => openFilePicker('lesson_url')} title="ជ្រើសរើសពឹក័លំ">
                                            <FolderOpenIcon class="w-4 h-4" />
                                        </button>
                                        <label class="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer shrink-0" style="background-color: #0056b3; color: white;" title="Upload PDF">
                                            <UploadIcon class="w-4 h-4" />
                                            <input type="file" class="hidden" accept="application/pdf" on:change={handleLessonUpload} />
                                        </label>
                                    </div>
                                    <button on:click={saveLesson} class="btn btn-sm btn-primary text-white w-full rounded-lg">
                                        <SaveIcon class="w-4 h-4 mr-1" /> រក្សាទុក
                                    </button>
                                </div>
                            </div>

                        </div>

                        <!-- Question Management -->
                        <QuizManager 
                            {supabase}
                            {editingCourse}
                            on:refresh={() => dispatch('refresh')}
                        />
                    </div>
                {/if}

                <!-- Tab Content: Certificate -->
                {#if activeTab === 'certificate'}
                    <CertificateEditor bind:editingCourse={editingCourse} />
                {/if}

                <!-- Tab Content: Participants -->
                {#if activeTab === 'participants'}
                    <div>
                        <div class="flex justify-between items-center mb-4">
                            <span class="text-sm text-gray-500">អ្នកដែលបានប្រឡងជាប់: <strong>{courseParticipants.length}</strong> នាក់</span>
                            <button class="btn btn-sm btn-outline" on:click={exportParticipantsCsv} disabled={courseParticipants.length === 0}>
                                <DownloadIcon class="w-4 h-4 mr-1" /> នាំចេញ CSV
                            </button>
                        </div>
                        {#if participantsLoading}
                            <div class="text-center p-8"><span class="loading loading-spinner loading-md text-primary"></span></div>
                        {:else if courseParticipants.length === 0}
                            <div class="text-center p-8 text-gray-400">មិនមានទិន្នន័យ</div>
                        {:else}
                            <!-- Summary Cards -->
                            {#if participantStats}
                            <div class="grid grid-cols-3 gap-3 mb-4">
                                <div class="bg-primary/5 border border-primary/20 rounded-xl p-3 text-center">
                                    <div class="text-2xl font-bold text-primary">{courseParticipants.length}</div>
                                    <div class="text-xs text-gray-500 mt-0.5">សរុប</div>
                                </div>
                                <div class="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                                    <div class="flex justify-center gap-3 text-lg font-bold">
                                        <span class="text-blue-600">{participantStats.male}♂</span>
                                        <span class="text-pink-500">{participantStats.female}♀</span>
                                    </div>
                                    <div class="text-xs text-gray-500 mt-0.5">ប្រុស / ស្រី</div>
                                </div>
                                <div class="bg-green-50 border border-green-100 rounded-xl p-3 text-center">
                                    <div class="text-lg font-bold text-green-600">{participantStats.withLicense} <span class="text-xs font-normal text-gray-400">/ {courseParticipants.length - participantStats.withLicense}</span></div>
                                    <div class="text-xs text-gray-500 mt-0.5">មានអជ្ញាប័ណ្ណ / គ្មាន</div>
                                </div>
                            </div>
                            <!-- Province Breakdown -->
                            <div class="bg-gray-50 rounded-xl border border-gray-200 p-3 mb-4">
                                <div class="text-xs font-bold text-gray-500 mb-2">រាជធានី/ខេត្ត</div>
                                <div class="flex flex-wrap gap-2">
                                    {#each participantStats.topProvinces as [province, count]}
                                        <span class="badge badge-ghost badge-sm border border-gray-300 gap-1">
                                            {province} <strong class="text-primary">{count}</strong>
                                        </span>
                                    {/each}
                                </div>
                            </div>
                            <div class="grid grid-cols-2 gap-3 mb-4">
                                <div class="bg-gray-50 rounded-xl border border-gray-200 p-3">
                                    <div class="text-xs font-bold text-gray-500 mb-2">តួនាទី</div>
                                    <div class="flex flex-wrap gap-1.5">
                                        {#each participantStats.topPositions as [pos, count]}
                                            <span class="badge badge-ghost badge-sm border border-gray-300 gap-1">
                                                {pos} <strong class="text-primary">{count}</strong>
                                            </span>
                                        {/each}
                                    </div>
                                </div>
                                <div class="bg-gray-50 rounded-xl border border-gray-200 p-3">
                                    <div class="text-xs font-bold text-gray-500 mb-2">ទីកន្លែងធ្វើការ</div>
                                    <div class="flex flex-wrap gap-1.5">
                                        {#each participantStats.topWorkplaces as [wp, count]}
                                            <span class="badge badge-ghost badge-sm border border-gray-300 gap-1">
                                                {wp} <strong class="text-primary">{count}</strong>
                                            </span>
                                        {/each}
                                    </div>
                                </div>
                            </div>
                            {/if}
                            <!-- Table -->
                            <div class="overflow-x-auto rounded-xl border">
                                <table class="table table-xs w-full">
                                    <thead class="bg-gray-50 text-xs font-bold">
                                        <tr>
                                            <th class="whitespace-nowrap">ល.រ</th>
                                            <th class="whitespace-nowrap">កាលបរិច្ឆេទ</th>
                                            <th class="whitespace-nowrap">ឈ្មោះខ្មែរ</th>
                                            <th class="whitespace-nowrap">ឈ្មោះឡាតាំង</th>
                                            <th class="whitespace-nowrap">ភេទ</th>
                                            <th class="whitespace-nowrap">តួនាទី</th>
                                            <th class="whitespace-nowrap">ទីកន្លែងធ្វើការ / រាជធានី/ខេត្ត</th>
                                            <th class="whitespace-nowrap">ស្ថានភាពអាជ្ញាប័ណ្ណ / លេខទូរស័ព្ទ</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {#each courseParticipants as r, i}
                                            <tr class="hover:bg-gray-50">
                                                <td>{i + 1}</td>
                                                <td class="whitespace-nowrap">{new Date(r.created_at).toLocaleDateString('km-KH')}</td>
                                                <td class="font-medium">{r.users?.full_name || '-'}</td>
                                                <td>{r.users?.name_latin || '-'}</td>
                                                <td>{r.users?.gender || '-'}</td>
                                                <td>{r.users?.profile_data?.position || '-'}</td>
                                                <td>{r.users?.profile_data?.workplace || '-'} / {r.users?.profile_data?.province || '-'}</td>
                                                <td>{r.users?.profile_data?.license_status || '-'} / {r.users?.phone_number || '-'}</td>
                                            </tr>
                                        {/each}
                                    </tbody>
                                </table>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>

            <!-- Footer -->
            <div class="bg-gray-50 px-6 py-4 border-t flex justify-end gap-2 shrink-0">
                <button class="btn btn-ghost" on:click={() => showModal = false}>បោះបង់</button>
                {#if activeTab !== 'participants'}
                <button class="btn btn-primary text-white" on:click={saveCourse} disabled={loading}>
                    {#if loading}<span class="loading loading-spinner"></span>{:else}<SaveIcon class="w-5 h-5 mr-1" />{/if}
                    រក្សាទុក
                </button>
                {/if}
            </div>
        </div>
    </div>
{/if}

<!-- File Picker Modal -->
{#if showFilePicker}
    <div class="modal modal-open bg-black/40" transition:fade={{ duration: 200 }}>
        <div class="modal-box w-11/12 max-w-5xl bg-white p-0 overflow-hidden rounded-2xl flex flex-col max-h-[90vh]">
            <div class="p-4 border-b shrink-0 flex justify-between items-center bg-gray-50">
                <h3 class="font-bold text-lg text-gray-800">ជ្រើសរើសឯកសារពីឃ្លាំង (R2)</h3>
                <button class="rounded-full w-8 h-8 hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none text-gray-500" on:click={() => { showFilePicker = false; closePickerPreview(); }}><XIcon class="w-5 h-5" /></button>
            </div>
            
            <div class="p-4 border-b bg-white">
                <div class="flex flex-col md:flex-row gap-2">
                    <div class="join">
                        <button class="join-item btn btn-sm {pickerFilter === 'all' ? 'btn-active btn-primary text-white' : ''}" on:click={() => pickerFilter = 'all'}>ទាំងអស់</button>
                        <button class="join-item btn btn-sm {pickerFilter === 'image' ? 'btn-active btn-primary text-white' : ''}" on:click={() => pickerFilter = 'image'}>រូបភាព</button>
                        <button class="join-item btn btn-sm {pickerFilter === 'pdf' ? 'btn-active btn-primary text-white' : ''}" on:click={() => pickerFilter = 'pdf'}>PDF</button>
                        <button class="join-item btn btn-sm {pickerFilter === 'video' ? 'btn-active btn-primary text-white' : ''}" on:click={() => pickerFilter = 'video'}>វីដេអូ</button>
                    </div>
                    <div class="flex gap-2 flex-1">
                        <input bind:value={pickerSearch} placeholder="ស្វែងរក..." class="input input-sm input-bordered w-full rounded-lg" on:keydown={(e) => e.key === 'Enter' && loadPickerFiles(true)} />
                        <button class="btn btn-sm btn-primary text-white rounded-lg" on:click={() => loadPickerFiles(true)}>ស្វែងរក</button>
                    {#if pickerUploading && pickerUploadTotal > 0}
                        <div class="flex flex-col justify-center min-w-[100px] px-2">
                            <progress class="progress progress-info w-full" value={pickerUploadCompleted} max={pickerUploadTotal}></progress>
                            <span class="text-[10px] text-center leading-none mt-1">{Math.round((pickerUploadCompleted / pickerUploadTotal) * 100)}% ({pickerUploadCompleted}/{pickerUploadTotal})</span>
                        </div>
                    {/if}
                    <label class="btn btn-sm btn-info text-white rounded-lg cursor-pointer {pickerUploading ? 'btn-disabled opacity-50' : ''}">
                        {#if pickerUploading}<span class="loading loading-spinner loading-xs"></span>{:else}<UploadIcon class="w-4 h-4 mr-1" /> Upload{/if}
                        <input type="file" multiple class="hidden" on:change={handlePickerUpload} disabled={pickerUploading} />
                    </label>
                        {#if selectedPickerFiles.size > 0}
                            {#if filePickerTarget === 'bulk_lessons'}
                                <button class="btn btn-sm btn-success text-white rounded-lg shadow-sm" on:click={addBulkLessons}>✅ បញ្ចូលជាមេរៀន ({selectedPickerFiles.size})</button>
                            {/if}
                            <button class="btn btn-sm btn-error text-white rounded-lg" on:click={deleteSelectedPickerFiles}>លុប ({selectedPickerFiles.size})</button>
                        {/if}
                    </div>
                </div>
            </div>

            <div class="flex gap-4 p-4 overflow-y-auto flex-1 min-h-0 bg-gray-50">
                <div class="flex-1 overflow-y-auto border rounded-xl bg-white shadow-sm">
                    <table class="table table-xs w-full table-pin-rows">
                        <thead class="bg-gray-100 text-gray-700">
                            <tr>
                                <th><input type="checkbox" class="checkbox checkbox-xs" on:change={toggleSelectAllPickerFiles} /></th>
                                <th>ប្រភេទ</th>
                                <th>ឈ្មោះ</th>
                                <th class="text-right">ទំហំ</th>
                                <th class="text-right">សកម្មភាព</th>
                            </tr>
                        </thead>
                        <tbody>
                            {#each filteredPickerFiles as file, i}
                                <tr class="hover:bg-gray-50 cursor-pointer border-b border-gray-100" on:click={() => selectPickerFile(file.key)} class:bg-blue-50={selectedPickerFiles.has(file.key)}>
                                    <td on:click|stopPropagation><input type="checkbox" class="checkbox checkbox-xs" checked={selectedPickerFiles.has(file.key)} on:change={() => togglePickerFileSelection(file.key)} /></td>
                                    <td>
                                        {#if file.key.match(/\.(jpg|jpeg|png|gif|webp)$/i)}<img src={`${R2_URL}/${file.key}`} alt="preview" class="w-8 h-8 object-cover rounded border" />
                                        {:else if file.key.match(/\.pdf$/i)}<span class="text-red-500 text-lg">📄</span>
                                        {:else if file.key.match(/\.(mp4|webm|ogg)$/i)}<span class="text-blue-500 text-lg">🎥</span>
                                        {:else}<span class="text-lg">📁</span>{/if}
                                    </td>
                                    <td class="truncate max-w-xs font-medium" title={file.key}>{file.key}</td>
                                    <td class="text-right text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</td>
                                    <td class="text-right flex justify-end gap-1">
                                        <button class="w-6 h-6 rounded hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none text-gray-500" on:click={(e) => renamePickerFile(e, file)} title="ប្តូរឈ្មោះ"><PencilIcon class="w-4 h-4" /></button>
                                        <button class="w-6 h-6 rounded hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none text-gray-500" on:click={(e) => openPickerPreview(e, file)} title="Preview"><EyeIcon class="w-4 h-4" /></button>
                                    </td>
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                    {#if pickerLoading}<div class="text-center p-4"><span class="loading loading-spinner loading-md text-primary"></span></div>
                    {:else if pickerFiles.length === 0}<div class="text-center p-8 text-gray-400">មិនមានឯកសារ</div>{/if}
                    {#if pickerHasMore && !pickerLoading}<div class="text-center p-2"><button class="btn btn-sm btn-ghost text-primary" on:click={() => loadPickerFiles()}>បង្ហាញបន្ថែម</button></div>{/if}
                </div>

                {#if pickerPreviewUrl}
                    <div class="w-1/3 border rounded-xl bg-white flex flex-col shadow-lg overflow-hidden">
                        <div class="p-2 border-b flex justify-between items-center bg-gray-50">
                            <span class="font-bold text-xs text-gray-600">Preview: {pickerPreviewType?.toUpperCase()}</span>
                            <button class="rounded-full w-6 h-6 hover:bg-gray-100 flex items-center justify-center cursor-pointer border-0 outline-none text-gray-500" on:click={closePickerPreview}><XIcon class="w-4 h-4" /></button>
                        </div>
                        <div class="flex-1 flex items-center justify-center overflow-hidden p-4 bg-gray-100">
                            {#if pickerPreviewType === 'image'}<img src={pickerPreviewUrl} alt="Preview" class="max-w-full max-h-full object-contain shadow-sm rounded" />
                            {:else if pickerPreviewType === 'pdf'}<iframe src={pickerPreviewUrl} title="PDF Preview" class="w-full h-full bg-white shadow-sm border rounded"></iframe>
                            {:else if pickerPreviewType === 'video'}<video src={pickerPreviewUrl} controls class="max-w-full max-h-full shadow-sm rounded"></video>{/if}
                        </div>
                        <div class="p-3 border-t bg-white text-center">
                            {#if filePickerTarget === 'bulk_lessons'}
                                <button class="btn {selectedPickerFiles.has(pickerPreviewKey) ? 'btn-error' : 'btn-success'} w-full text-white rounded-lg shadow-sm" on:click={() => togglePickerFileSelection(pickerPreviewKey)}>
                                    {selectedPickerFiles.has(pickerPreviewKey) ? '❌ ដកចេញពីការជ្រើសរើស' : '✅ ជ្រើសរើសឯកសារនេះ'}
                                </button>
                            {:else}
                                <button class="btn btn-primary w-full text-white rounded-lg shadow-sm" on:click={() => selectPickerFile(pickerPreviewKey)}>✅ ជ្រើសរើសឯកសារនេះ</button>
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

<style>
    .certificate-container {
        /* A4 aspect ratio */
        font-family: 'Nokora', sans-serif;
    }
</style>
