<script>
    import { page } from '$app/stores';
    import { onMount } from 'svelte';
    
    export let supabase;
    export let currentUser;

    let courseId = $page.params.id;
    let loading = true;
    let error = null;
    let course = null;
    let result = null;
    let verificationLink = '';

    onMount(async () => {
        verificationLink = window.location.href;
        await loadCertificate();
    });

    async function loadCertificate() {
        if (!currentUser) {
            error = "សូមចូលគណនីដើម្បីមើលលិខិតបញ្ជាក់ការសិក្សា។";
            loading = false;
            return;
        }

        // 1. ទាញយកព័ត៌មានវគ្គសិក្សា
        const { data: courseData, error: courseError } = await supabase
            .from('courses')
            .select('*')
            .eq('id', courseId)
            .single();

        if (courseError || !courseData) {
            error = "រកមិនឃើញវគ្គសិក្សា";
            loading = false;
            return;
        }
        course = courseData;

        // 2. Load Custom Font (ប្រសិនបើមាន)
        if (course.cert_config?.customFontUrl) {
            try {
                const font = new FontFace('CustomFont', `url(${course.cert_config.customFontUrl})`);
                await font.load();
                document.fonts.add(font);
            } catch (e) {
                console.error("Error loading font:", e);
            }
        }

        // 3. ទាញយកលទ្ធផលប្រឡង (ដើម្បីបញ្ជាក់ថាជាប់)
        const { data: resultData, error: resultError } = await supabase
            .from('student_quiz_results')
            .select('*')
            .eq('course_id', courseId)
            .eq('user_id', currentUser.id)
            .eq('passed', true)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (resultError || !resultData) {
            error = "អ្នកមិនទាន់បានប្រឡងជាប់វគ្គនេះទេ ឬមិនមានសិទ្ធិទទួលបានសញ្ញាបត្រ។";
        } else {
            result = resultData;
        }
        loading = false;
    }

    function handlePrint() {
        window.print();
    }
</script>

<svelte:head>
    <title>សញ្ញាបត្រ - {course?.title || 'Loading...'}</title>
    <style>
        @media print {
            @page { size: landscape; margin: 0; }
            body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; }
            .no-print { display: none !important; }
            .certificate-container { border: none !important; box-shadow: none !important; width: 100vw !important; height: 100vh !important; max-width: none !important; }
        }
    </style>
</svelte:head>

<div class="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4">
    {#if loading}
        <span class="loading loading-spinner loading-lg text-primary"></span>
    {:else if error}
        <div class="alert alert-error max-w-md shadow-lg">
            <svg xmlns="http://www.w3.org/2000/svg" class="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{error}</span>
        </div>
        <button class="btn btn-sm mt-4" on:click={() => window.history.back()}>ត្រឡប់ក្រោយ</button>
    {:else}
        <!-- Toolbar -->
        <div class="no-print mb-6 flex gap-4">
            <button class="btn btn-primary gap-2 shadow-lg" on:click={handlePrint}>
                🖨️ Print / Save PDF
            </button>
            <button class="btn btn-outline bg-white" on:click={() => window.history.back()}>បិទ</button>
        </div>

        <!-- Certificate Area -->
        <div class="certificate-container relative bg-white shadow-2xl overflow-hidden mx-auto text-black"
             style="width: 1123px; height: 794px; /* A4 Landscape dimensions at 96 DPI */">
            
            <!-- Background Template -->
            {#if course.cert_template_url}
                <img src={course.cert_template_url} alt="Certificate Template" class="w-full h-full object-cover absolute inset-0 z-0" />
            {/if}

            <!-- Dynamic Content -->
            {#each Object.entries(course.cert_config || {}) as [key, conf]}
                {#if conf.visible !== false}
                    <div class="absolute whitespace-nowrap z-10 flex items-center justify-center"
                         style="
                            left: {conf.x}px; 
                            top: {conf.y}px; 
                            transform: translate(-50%, -50%);
                            color: {conf.color};
                            font-size: {conf.fontSize}px;
                            font-family: {conf.font === 'Custom' ? 'CustomFont' : conf.font};
                         ">
                        {#if key === 'name'}
                            {currentUser.full_name || ''}
                        {:else if key === 'name_latin'}
                            {currentUser.name_latin || ''}
                        {:else if key === 'date'}
                            {new Date(result.created_at).toLocaleDateString('km-KH')}
                        {:else if key === 'id'}
                            {result.id.split('-')[0].toUpperCase()}
                        {:else if key === 'qr'}
                            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=${conf.size}x${conf.size}&data=${encodeURIComponent(verificationLink)}`} alt="QR" style="width: {conf.size}px; height: {conf.size}px;" />
                        {/if}
                    </div>
                {/if}
            {/each}
        </div>
    {/if}
</div>