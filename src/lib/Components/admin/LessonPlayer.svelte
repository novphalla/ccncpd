<script>
    import { createEventDispatcher, onMount, tick, onDestroy } from 'svelte';
    import { fade, fly } from 'svelte/transition';
    import { PUBLIC_R2_PUBLIC_URL } from '$env/static/public';

    export let course = { title: 'ចំណងជើងវគ្គសិក្សា' };
    export let lesson = { title: 'មេរៀនទី ១', duration: '10:00' };
    export let lessons = [];
    export let currentProgress = 0;
    export let supabase = null;
    export let currentUser = null;
    
    const dispatch = createEventDispatcher();

    let zoom = 100;
    let currentPage = 1;
    let totalPages = 10; // Mock total pages
    let isFullScreen = false;
    let showControls = true;
    let hideControlsTimeout;
    let showToc = false;
    let canvas;
    let resumeToastMessage = '';
    let resumeToastTimeout;
    
    let pdfDoc = null;
    let pageRendering = false;
    let pageNumPending = null;
    let isCompleted = false;
    let errorMessage = '';
    let isPdf = false;
    let downloadProgress = 0; // សម្រាប់បង្ហាញភាគរយពេលទាញយក
    let saveProgressTimeout; // សម្រាប់ Debounce ការ Save
    let currentLoadingTask = null; // សម្រាប់ Cancel ការ Load PDF ចាស់

    // Page-turn animation
    let flipDir = 0; // 1 = forward, -1 = backward
    let pageExitState = null; // { src, w, h, dir } snapshot of old page

    $: currentProgress = totalPages ? Math.round((currentPage / totalPages) * 100) : 0;
    $: currentIndex = lessons.findIndex(l => l.id === lesson.id);
    $: hasNext = currentIndex < lessons.length - 1;
    $: hasPrev = currentIndex > 0;

    // Swipe Logic
    let touchStartX = 0;
    let touchEndX = 0;
    let initialPinchDistance = null;
    let initialZoom = 100;
    let pinchScale = 1;
    let lastTap = 0; // For double tap detection

    function nextLesson() {
        if (hasNext) {
            lesson = lessons[currentIndex + 1];
            resetState();
        }
    }

    function prevLesson() {
        if (hasPrev) {
            lesson = lessons[currentIndex - 1];
            resetState();
        }
    }

    function resetState() {
        zoom = 100;
        currentPage = 1;
        errorMessage = '';
        downloadProgress = 0;
        isCompleted = false;
        resumeToastMessage = '';
        clearTimeout(resumeToastTimeout);
    }

    $: if (pdfDoc && currentPage === totalPages && !isCompleted) {
        markComplete();
    }

    $: if (lesson && lesson.url) {
        errorMessage = ''; // Reset error when lesson changes
        isPdf = lesson.url.toLowerCase().match(/\.pdf(\?.*)?$/);
        if (isPdf) {
            loadPdf(lesson.url);
        }
    }

    function getEmbedUrl(url) {
        if (!url) return '';
        const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
        const match = url.match(youtubeRegex);
        if (match && match[1]) return `https://www.youtube.com/embed/${match[1]}`;
        return url;
    }

    async function loadPdf(url) {
        if (typeof window === 'undefined') return;
        
        // លុប Task និង Document ចាស់ចោលមុននឹង Load ថ្មីដើម្បីសន្សំសំចៃ Memory
        if (currentLoadingTask) {
            try { await currentLoadingTask.destroy(); } catch (e) {}
        }
        if (pdfDoc) {
            try { await pdfDoc.destroy(); } catch (e) {}
        }
        
        pdfDoc = null; totalPages = 0; currentPage = 1;
        errorMessage = '';
        downloadProgress = 0;

        // Load PDF.js if not loaded
        if (!window.pdfjsLib) {
            if (!window.pdfjsLibLoadingPromise) {
                window.pdfjsLibLoadingPromise = new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                    script.onload = () => {
                        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                        resolve();
                    };
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }
            await window.pdfjsLibLoadingPromise;
        }

        try {
            currentLoadingTask = window.pdfjsLib.getDocument(url);
            
            // ចាប់យកភាគរយនៃការទាញយក (Progress tracking)
            currentLoadingTask.onProgress = function(progress) {
                if (progress.total > 0) {
                    downloadProgress = Math.round((progress.loaded / progress.total) * 100);
                }
            };

            pdfDoc = await currentLoadingTask.promise;
            currentLoadingTask = null; // Reset
            totalPages = pdfDoc.numPages;
            await loadProgress();
            await tick(); // Ensure canvas is ready
            renderPage(currentPage);
        } catch (error) {
            console.error('Error loading PDF:', error);
            
            if (error.name === 'MissingPDFException') {
                errorMessage = 'រកមិនឃើញឯកសារ PDF ទេ (404 Not Found)។ ប្រសិនបើអ្នកកំពុងតេស្តលើ Localhost សូមប្រាកដថាអ្នកបាន Upload ឯកសារទៅកាន់ Bucket ពិតប្រាកដ (wrangler dev --remote)។';
            } else if (error.name === 'InvalidPDFException') {
                errorMessage = 'ឯកសារខូច ឬមិនមែនជា PDF ត្រឹមត្រូវ។';
            } else {
                errorMessage = 'មិនអាចផ្ទុកឯកសារ PDF បានទេ។ (' + error.message + ')';
            }
        }
    }

    async function renderPage(num) {
        if (!pdfDoc || !canvas) return;

        pageRendering = true;
        const page = await pdfDoc.getPage(num);
        
        const devicePixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

        // Use zoom level for rendering scale
        let baseScale = 1.0;

        // Auto-fit: fill viewport (one page at a time, book mode)
        if (typeof window !== 'undefined') {
            const unscaledViewport = page.getViewport({ scale: 1 });
            // Subtract: header(~56) + footer(~52) + sticky bar(~44) + padding(~20)
            const availH = window.innerHeight - 172;
            const availW = Math.min(window.innerWidth - 32, 1200);
            const scaleByH = availH / unscaledViewport.height;
            const scaleByW = availW / unscaledViewport.width;
            baseScale = Math.min(scaleByH, scaleByW);
        }

        const viewport = page.getViewport({ scale: baseScale * (zoom / 100) });
        
        // Scale canvas for high-DPI screens
        canvas.height = Math.floor(viewport.height * devicePixelRatio);
        canvas.width = Math.floor(viewport.width * devicePixelRatio);
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        canvas.style.width = `${Math.floor(viewport.width)}px`;

        const ctx = canvas.getContext('2d');
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        
        try {
            await page.render(renderContext).promise;
        } catch (e) {
            // Rendering cancelled
        }

        // Trigger page-enter animation after rendering
        if (canvas && flipDir !== 0) {
            const dir = flipDir;
            flipDir = 0;
            canvas.style.animation = 'none';
            canvas.getBoundingClientRect(); // force reflow to restart animation
            canvas.style.animation = dir > 0
                ? 'bookEnterRight 0.32s ease-out forwards'
                : 'bookEnterLeft 0.32s ease-out forwards';
        }

        pageRendering = false;
        if (pageNumPending !== null) {
            renderPage(pageNumPending);
            pageNumPending = null;
        }
    }

    function queueRenderPage(num) {
        if (pageRendering) {
            pageNumPending = num;
        } else {
            renderPage(num);
        }
    }

    function changePage(offset) {
        const newPage = currentPage + offset;
        if (newPage < 1 || newPage > totalPages) return;

        // Capture current page as snapshot for flip-out animation
        if (canvas && canvas.width > 0 && !pageRendering) {
            pageExitState = {
                src: canvas.toDataURL(),
                w: parseInt(canvas.style.width) || canvas.offsetWidth,
                h: parseInt(canvas.style.height) || canvas.offsetHeight,
                dir: offset > 0 ? 1 : -1
            };
            flipDir = offset > 0 ? 1 : -1;
            setTimeout(() => { pageExitState = null; }, 420);
        }

        currentPage = newPage;
        queueRenderPage(currentPage);

        // Debounce saveProgress (រង់ចាំ ១វិនាទី បើគ្មានការចុចបន្ត ទើប Save)
        clearTimeout(saveProgressTimeout);
        saveProgressTimeout = setTimeout(() => saveProgress(), 1000);
    }

    // Re-render when zoom changes
    function zoomIn() {
        zoom = Math.min(200, zoom + 10);
        if (pdfDoc) queueRenderPage(currentPage);
    }

    function zoomOut() {
        zoom = Math.max(50, zoom - 10);
        if (pdfDoc) queueRenderPage(currentPage);
    }

    async function loadProgress() {
        if (!supabase || !currentUser || !lesson || lesson.id === 'fallback') {
            currentPage = 1;
            return;
        }
        
        const { data } = await supabase
            .from('lesson_progress')
            .select('last_page, completed')
            .eq('user_id', currentUser.id)
            .eq('lesson_id', lesson.id)
            .maybeSingle();
            
        currentPage = data?.last_page || 1;
        isCompleted = data?.completed || false;
        
        if (currentPage > 1 && !isCompleted) {
            resumeToastMessage = `អ្នកបានរៀនដល់ទំព័រទី ${currentPage} នៃ ${totalPages}`;
            clearTimeout(resumeToastTimeout);
            resumeToastTimeout = setTimeout(() => {
                resumeToastMessage = '';
            }, 4000);
        }
    }

    async function saveProgress() {
        if (!supabase || !currentUser || !lesson || lesson.id === 'fallback') return;

        await supabase
            .from('lesson_progress')
            .upsert({
                user_id: currentUser.id,
                lesson_id: lesson.id,
                course_id: course.id,
                last_page: currentPage,
                updated_at: new Date()
            }, { onConflict: 'user_id,lesson_id' });
    }

    async function markComplete() {
        if (!supabase || !currentUser || !lesson || lesson.id === 'fallback') return;

        const { error } = await supabase
            .from('lesson_progress')
            .upsert({
                user_id: currentUser.id,
                lesson_id: lesson.id,
                course_id: course.id,
                last_page: currentPage,
                completed: true,
                updated_at: new Date()
            }, { onConflict: 'user_id,lesson_id' });
            
        if (!error) isCompleted = true;
    }

    // Auto-hide controls for immersion
    function handleMouseMove() {
        showControls = true;
        clearTimeout(hideControlsTimeout);
        hideControlsTimeout = setTimeout(() => {
            showControls = false;
        }, 3000);
    }

    function toggleFullScreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
            isFullScreen = true;
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
                isFullScreen = false;
            }
        }
    }
    
    function handleTouchStart(e) {
        const now = new Date().getTime();
        const DOUBLE_TAP_DELAY = 300; // ms

        // Double Tap to Zoom
        if (now - lastTap < DOUBLE_TAP_DELAY && e.touches.length === 1) {
            e.preventDefault();
            
            if (zoom > 100) { // If currently zoomed in, reset to default
                zoom = 100;
            } else { // If not zoomed in, zoom to 200%
                zoom = 200;
            }
            
            if (pdfDoc) queueRenderPage(currentPage);

            lastTap = 0; // Reset tap timer to prevent triple-tap issues
            return; // Exit to prevent other touch handlers
        }
        lastTap = now;

        // Pinch to Zoom
        if (e.touches.length === 2) {
            initialPinchDistance = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            initialZoom = zoom;
        } else { // Swipe
            touchStartX = e.changedTouches[0].screenX;
        }
    }

    function handleTouchMove(e) {
        handleMouseMove(); // Show controls to indicate activity
        if (initialPinchDistance && e.touches.length === 2) {
            e.preventDefault(); // Prevent browser native zoom
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            pinchScale = dist / initialPinchDistance;
            if (canvas) {
                // Visual preview using CSS transform (performant)
                canvas.style.transform = `scale(${pinchScale})`;
                canvas.style.transformOrigin = 'center center';
            }
        }
    }

    function handleTouchEnd(e) {
        if (initialPinchDistance) {
            if (e.touches.length < 2) {
                // Pinch ended - commit the new zoom level
                const newZoom = Math.round(initialZoom * pinchScale);
                zoom = Math.min(300, Math.max(50, newZoom)); // Limit zoom between 50% and 300%
                initialPinchDistance = null;
                pinchScale = 1;
                if (canvas) canvas.style.transform = 'none'; // Reset CSS scale
                if (pdfDoc) queueRenderPage(currentPage); // Re-render PDF at new quality
            }
            return;
        }

        touchEndX = e.changedTouches[0].screenX;
        if (zoom > 100) return; // Disable swipe when zoomed in to allow panning
        
        if (touchStartX - touchEndX > 50) { // Swipe Left -> Next
            if (currentPage < totalPages) changePage(1);
        } else if (touchEndX - touchStartX > 50) { // Swipe Right -> Prev
            if (currentPage > 1) changePage(-1);
        }
    }

    let isDownloading = false;

    $: isYouTube = !!(lesson?.url && lesson.url.match(/youtube|youtu\.be/i));
    $: canDownload = !!(course?.allow_download && lesson?.url && !isYouTube);

    async function downloadLesson() {
        if (!lesson?.url || isDownloading) return;
        isDownloading = true;
        try {
            const res = await fetch(lesson.url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const blob = await res.blob();
            const ext = isPdf ? '.pdf' : '';
            const filename = lesson.title.replace(/[/\\?%*:|"<>]/g, '-') + ext;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); document.body.removeChild(a); }, 500);
        } catch {
            window.open(lesson.url, '_blank');
        } finally {
            isDownloading = false;
        }
    }

    function handleKeyDown(e) {
        if (!isPdf || !pdfDoc) return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); if (currentPage < totalPages) changePage(1); }
        else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); if (currentPage > 1) changePage(-1); }
    }

    onMount(() => {
        handleMouseMove();
    });
    
    onDestroy(() => {
        clearTimeout(hideControlsTimeout);
        clearTimeout(saveProgressTimeout);
        clearTimeout(resumeToastTimeout);
        // Clear Memory ពេលបិទ Component
        if (currentLoadingTask) currentLoadingTask.destroy().catch(()=>{});
        if (pdfDoc) pdfDoc.destroy().catch(()=>{});
    });
</script>

<svelte:window on:keydown={handleKeyDown} on:resize={() => { if (pdfDoc) queueRenderPage(currentPage); }} />

<div class="fixed inset-0 z-50 flex flex-col overflow-hidden"
     role="region" aria-label="Lesson Player"
     transition:fade={{ duration: 200 }}
     on:touchstart={handleTouchStart}
     on:touchmove={handleTouchMove}
     on:touchend={handleTouchEnd}
     style="background:#f0e6d0;">

    <!-- ផ្ទាំងលោតប្រាប់ពីទំព័រដែលបានរៀនដល់ (Resume Toast) -->
    {#if resumeToastMessage}
        <div class="absolute top-16 left-1/2 transform -translate-x-1/2 z-[60] px-5 py-2.5 rounded-full shadow-2xl text-sm font-bold flex items-center gap-2 whitespace-nowrap"
             transition:fly={{ y: -20, duration: 400 }}
             style="background: #2c1a0e; color: #c8a96e; border: 1px solid #b8860b;">
            <span class="text-lg">🔖</span> {resumeToastMessage}
        </div>
    {/if}
    
    <!-- ═══ HEADER ═══ -->
    <header class="flex-shrink-0 flex items-center gap-2 px-3 sm:px-5 py-3 z-20"
            style="background:linear-gradient(180deg,#2a1a09,#3c2414); border-bottom:2px solid #b8860b; box-shadow:0 4px 20px rgba(0,0,0,.4);">

        <button on:click={() => dispatch('close')}
                class="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style="color:#c8a96e; background:rgba(255,255,255,.06); border:none; cursor:pointer;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" width="18" height="18">
                <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"/>
            </svg>
        </button>

        <div class="flex-1 min-w-0">
            <p class="truncate" style="color:#b8a070; font-size:.6rem; letter-spacing:.12em; text-transform:uppercase; font-family:sans-serif; line-height:1.2;">{course.title}</p>
            <h1 class="truncate font-bold" style="color:#f5ede0; font-size:.88rem; line-height:1.3;">{lesson.title}</h1>
        </div>

        <div class="hidden sm:flex items-center gap-2 flex-shrink-0" style="font-family:monospace; color:#c8a96e; font-size:.7rem;">
            <div class="rounded-full overflow-hidden" style="width:72px; height:4px; background:#4a2c18;">
                <div class="h-full rounded-full transition-all duration-500" style="width:{currentProgress}%; background:linear-gradient(90deg,#b8860b,#daa520);"></div>
            </div>
            <span>{currentProgress}%</span>
        </div>

        <button on:click={() => showToc = !showToc}
                class="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all"
                style="color:{showToc?'#2a1a09':'#c8a96e'}; background:{showToc?'#c8a96e':'rgba(255,255,255,.06)'}; border:none; cursor:pointer;"
                title="បញ្ជីមាតិកា">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="18" height="18">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12"/>
            </svg>
        </button>

        <button on:click={toggleFullScreen}
                class="flex-shrink-0 w-9 h-9 rounded-full hidden sm:flex items-center justify-center"
                style="color:#c8a96e; background:rgba(255,255,255,.06); border:none; cursor:pointer;"
                title="ពេញអេក្រង់">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="18" height="18">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/>
            </svg>
        </button>

        {#if canDownload}
        <button on:click={downloadLesson}
                class="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style="color:#c8a96e; background:rgba(255,255,255,.06); border:none; cursor:pointer; opacity:{isDownloading ? 0.5 : 1};"
                disabled={isDownloading}
                title="ទាញយក">
            {#if isDownloading}
                <div class="animate-spin rounded-full" style="width:16px; height:16px; border:2px solid #c8a96e; border-top-color:transparent;"></div>
            {:else}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="18" height="18">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
                </svg>
            {/if}
        </button>
        {/if}
    </header>

    <!-- ═══ BODY ═══ -->
    <div class="flex-1 flex overflow-hidden relative">

        {#if showToc && lessons.length > 0}
            <!-- Mobile backdrop -->
            <div class="fixed inset-0 z-10 sm:hidden" style="background:rgba(0,0,0,.6);" on:click={() => showToc=false} role="presentation"></div>

            <aside class="w-64 sm:w-72 flex-shrink-0 flex flex-col overflow-hidden z-20"
                   style="background:#1e110a; border-right:2px solid #4a2c18;"
                   transition:fly={{ x: -20, duration: 180 }}>
                <div class="flex items-center justify-between px-4 py-3 flex-shrink-0"
                     style="border-bottom:1px solid #3a2414;">
                    <span style="color:#b8860b; font-size:.68rem; letter-spacing:.15em; text-transform:uppercase; font-family:sans-serif; font-weight:700;">📚 បញ្ជីមាតិកា</span>
                    <button class="sm:hidden w-7 h-7 flex items-center justify-center rounded-full"
                            style="color:#c8a96e; background:rgba(255,255,255,.06); border:none; cursor:pointer; font-size:.85rem;"
                            on:click={() => showToc=false}>✕</button>
                </div>
                <nav class="overflow-y-auto flex-1 py-1">
                    {#each lessons as l, i}
                    <button class="w-full text-left flex items-start gap-3 px-4 py-3 transition-colors"
                            style="background:{l.id===lesson.id?'rgba(184,134,11,.15)':'transparent'}; border-left:3px solid {l.id===lesson.id?'#b8860b':'transparent'}; border-bottom:1px solid #2c1a0e; border-top:none; border-right:none; cursor:pointer;"
                            on:click={() => { lesson=l; resetState(); if(typeof window!=='undefined'&&window.innerWidth<640) showToc=false; }}>
                        <span style="color:#b8860b; font-size:.62rem; font-family:monospace; flex-shrink:0; margin-top:3px; font-weight:700;">{String(i+1).padStart(2,'0')}</span>
                        <span class="text-sm leading-snug" style="color:{l.id===lesson.id?'#f5ede0':'#a08060'};">{l.title}</span>
                    </button>
                    {/each}
                </nav>
            </aside>
        {/if}

        <!-- Reading area -->
        <main class="flex-1 flex flex-col overflow-hidden"
              on:mousemove={handleMouseMove}>

            <!-- Scrollable content: centered + no-scroll for PDF, normal scroll for video -->
            <div class="flex-1 flex {isPdf ? 'items-center justify-center overflow-hidden p-2' : 'flex-col items-center overflow-auto py-5 px-3 sm:px-6'}"
                 style="background:#f0e6d0; background-image:radial-gradient(circle at 20% 80%,rgba(184,134,11,.04) 0%,transparent 60%),radial-gradient(circle at 80% 20%,rgba(92,59,30,.05) 0%,transparent 60%);">

            <!-- Ornamental chapter heading (video only) -->
            {#if !isPdf}
            <p class="mb-4 select-none tracking-widest text-center" style="color:#a08060; font-size:.6rem; letter-spacing:.2em; font-family:sans-serif; text-transform:uppercase; opacity:.7;">❦ &nbsp;{lesson.title}&nbsp; ❦</p>
            {/if}

            <!-- Book with drop shadow -->
            <div style="{isPdf ? '' : 'overflow-x:auto;'} max-width:100%;">
                <div class="relative"
                     style="background:white; border-radius:2px; box-shadow:0 2px 8px rgba(44,26,14,.15),0 8px 30px rgba(44,26,14,.25),0 20px 60px rgba(44,26,14,.18),-4px 0 12px rgba(0,0,0,.08); display:inline-block; overflow:hidden; perspective:1200px;">

                    <!-- Spine shadow -->
                    <div class="absolute left-0 top-0 bottom-0 z-10 pointer-events-none" style="width:18px; background:linear-gradient(to right,rgba(44,26,14,.22) 0%,rgba(44,26,14,.06) 55%,transparent 100%);"></div>

                    <!-- Exit page overlay (book flip-out animation) -->
                    {#if pageExitState}
                    <img src={pageExitState.src} alt=""
                         class="absolute top-0 left-0 pointer-events-none"
                         style="width:{pageExitState.w}px; height:{pageExitState.h}px; z-index:8; display:block;
                                animation: {pageExitState.dir > 0 ? 'bookExitLeft' : 'bookExitRight'} 0.38s ease-in forwards;" />
                    {/if}

                    <!-- PDF Canvas -->
                    <canvas bind:this={canvas} style="display:block;"></canvas>

                    <!-- Video iframe -->
                    {#if !isPdf && lesson.url}
                    <div class="w-full max-w-4xl mx-auto aspect-video bg-black/90 rounded-lg overflow-hidden shadow-inner flex items-center justify-center">
                        <iframe src={getEmbedUrl(lesson.url)}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowfullscreen title={lesson.title} loading="lazy"
                                style="width:100%; height:100%; border:none; display:block;"></iframe>
                    </div>
                    {/if}

                    <!-- Error -->
                    {#if errorMessage}
                    <div class="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center z-20"
                         style="background:rgba(253,246,227,.96);">
                        <span style="font-size:2.5rem;">⚠️</span>
                        <p class="text-sm" style="color:#5c3b1e; max-width:320px; line-height:1.7;">{errorMessage}</p>
                        <a href={lesson.url} target="_blank" rel="noopener noreferrer"
                           class="text-sm font-bold px-5 py-2 rounded"
                           style="background:#2c1a0e; color:#c8a96e; text-decoration:none; display:inline-block;">
                            បើកផ្ទាល់ →
                        </a>
                    </div>
                    {/if}

                    <!-- Loading -->
                    {#if isPdf && !pdfDoc && !errorMessage}
                    <div class="flex flex-col items-center justify-center gap-4"
                         style="min-height:320px; background:#fdf6e3;">
                        <div class="animate-spin rounded-full"
                             style="width:32px; height:32px; border:2px solid #b8860b; border-top-color:transparent;"></div>
                        <p style="color:#8b6540; font-family:sans-serif; font-size:.78rem;">
                            កំពុងផ្ទុកឯកសារ... {#if downloadProgress > 0 && downloadProgress < 100}{downloadProgress}%{/if}
                        </p>
                    </div>
                    {/if}

                    <!-- No URL -->
                    {#if !lesson.url && !errorMessage}
                    <div class="flex flex-col items-center justify-center" style="min-height:400px; min-width:260px;">
                        <span style="font-size:4rem; opacity:.2;">📖</span>
                        <p style="color:#c8b08a; font-family:sans-serif; font-size:.85rem; margin-top:.5rem; opacity:.6;">មិនមានមាតិការ</p>
                    </div>
                    {/if}

                    <!-- Corner fold -->
                    <div class="absolute bottom-0 right-0 pointer-events-none z-10"
                         style="width:22px; height:22px; background:linear-gradient(225deg,#f0e6d0 50%,rgba(200,170,110,.25) 50%);"></div>
                </div>
            </div>

            <!-- Manual Complete Button for Videos/Images -->
            {#if !isPdf && lesson.url && !isCompleted && !errorMessage}
            <div class="mt-8 flex justify-center w-full" in:fade={{ duration: 300, delay: 500 }}>
                <button on:click={markComplete} class="px-8 py-3 rounded-full font-bold shadow-lg transition-transform hover:scale-105 active:scale-95 flex items-center gap-2" 
                        style="background:linear-gradient(90deg,#b8860b,#daa520); color:#2a1a09; border:none; text-shadow: 0 1px 1px rgba(255,255,255,0.3);">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg> បញ្ជាក់ថាបានរៀនចប់
                </button>
            </div>
            {/if}

            </div><!-- end scrollable -->

            <!-- Sticky page controls bar (always visible, no scroll needed) -->
            {#if isPdf && pdfDoc}
            <div class="flex-shrink-0 flex items-center justify-between gap-2 px-4 py-2.5"
                 style="background:rgba(42,26,9,0.96); border-top:1px solid rgba(184,134,11,0.35); backdrop-filter:blur(4px);">

                <div class="flex items-center gap-1.5">
                    <button on:click={zoomOut}
                            class="flex items-center justify-center rounded font-bold"
                            style="width:28px;height:28px;background:rgba(200,169,110,.1);color:#c8a96e;border:1px solid rgba(184,134,11,.3);cursor:pointer;font-size:1rem;">−</button>
                    <span style="color:#8b7050;font-family:monospace;font-size:.7rem;min-width:32px;text-align:center;">{zoom}%</span>
                    <button on:click={zoomIn}
                            class="flex items-center justify-center rounded font-bold"
                            style="width:28px;height:28px;background:rgba(200,169,110,.1);color:#c8a96e;border:1px solid rgba(184,134,11,.3);cursor:pointer;font-size:1rem;">+</button>
                </div>

                <div class="flex items-center gap-2">
                    <button disabled={currentPage===1} on:click={() => changePage(-1)}
                            class="flex items-center justify-center rounded-full font-bold text-xl disabled:opacity-25"
                            style="width:36px;height:36px;background:#b8860b;color:#2a1a09;border:none;cursor:pointer;line-height:1;">‹</button>

                    <div class="flex items-center gap-1 rounded-full px-3 py-1"
                         style="background:rgba(255,255,255,.07);min-width:72px;justify-content:center;">
                        <span class="font-bold" style="color:#f5ede0;font-family:monospace;font-size:.9rem;">{currentPage}</span>
                        <span style="color:#6b4c30;font-size:.75rem;margin:0 2px;">/</span>
                        <span style="color:#b8a070;font-family:monospace;font-size:.85rem;">{totalPages}</span>
                    </div>

                    <button disabled={currentPage===totalPages} on:click={() => changePage(1)}
                            class="flex items-center justify-center rounded-full font-bold text-xl disabled:opacity-25"
                            style="width:36px;height:36px;background:#b8860b;color:#2a1a09;border:none;cursor:pointer;line-height:1;">›</button>
                </div>

                <span class="text-xs" style="color:#6b4c30;font-family:sans-serif;opacity:.6;font-size:.62rem;">← → keys</span>
            </div>
            {/if}
        </main>
    </div>

    <!-- ═══ FOOTER ═══ -->
    <footer class="flex-shrink-0 flex items-center gap-3 px-4 py-3 z-20"
            style="background:linear-gradient(180deg,#3c2414,#2a1a09); border-top:2px solid #b8860b; box-shadow:0 -4px 20px rgba(0,0,0,.35);">

        <button disabled={!hasPrev} on:click={prevLesson}
                class="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-opacity disabled:opacity-30"
                style="background:rgba(184,134,11,.12); color:#c8a96e; border:1px solid rgba(184,134,11,.3); cursor:pointer;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" width="14" height="14">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5"/>
            </svg>
            <span class="hidden sm:inline">មុន</span>
        </button>

        <div class="flex-1 flex justify-center">
            {#if isCompleted}
            <span class="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full"
                  style="background:rgba(34,197,94,.15); color:#86efac; border:1px solid rgba(34,197,94,.25);">
                ✓ រៀនចប់ហើយ
            </span>
            {:else if lesson.duration}
            <span class="text-xs select-none" style="color:#8b6540; letter-spacing:.08em; font-family:sans-serif;">⏱ {lesson.duration}</span>
            {/if}
        </div>

        <button disabled={!hasNext} on:click={nextLesson}
                class="flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium transition-opacity disabled:opacity-30"
                style="background:rgba(184,134,11,.12); color:#c8a96e; border:1px solid rgba(184,134,11,.3); cursor:pointer;">
            <span class="hidden sm:inline">បន្ទាប់</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" width="14" height="14">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/>
            </svg>
        </button>
    </footer>
</div>

<style>
    @keyframes bookExitLeft {
        0%   { transform: perspective(1200px) rotateY(0deg) translateX(0)    scale(1);    opacity: 1; transform-origin: left center; }
        40%  { opacity: 0.8; }
        100% { transform: perspective(1200px) rotateY(-55deg) translateX(-8%) scale(0.95); opacity: 0; transform-origin: left center; }
    }
    @keyframes bookExitRight {
        0%   { transform: perspective(1200px) rotateY(0deg)   translateX(0)   scale(1);    opacity: 1; transform-origin: right center; }
        40%  { opacity: 0.8; }
        100% { transform: perspective(1200px) rotateY(55deg)  translateX(8%)  scale(0.95); opacity: 0; transform-origin: right center; }
    }
    @keyframes bookEnterRight {
        0%   { transform: perspective(1200px) rotateY(45deg)  translateX(10%) scale(0.95); opacity: 0; }
        100% { transform: perspective(1200px) rotateY(0deg)   translateX(0)   scale(1);    opacity: 1; }
    }
    @keyframes bookEnterLeft {
        0%   { transform: perspective(1200px) rotateY(-45deg) translateX(-10%) scale(0.95); opacity: 0; }
        100% { transform: perspective(1200px) rotateY(0deg)   translateX(0)    scale(1);    opacity: 1; }
    }
</style>