<script>
    import { createEventDispatcher, onMount, tick, onDestroy } from 'svelte';
    import { fade, fly } from 'svelte/transition';
    import { PUBLIC_R2_PUBLIC_URL } from '$env/static/public';
    import { normalizeAssetProxyUrl } from '$lib/utils.js';
    import {
        ArrowLeftIcon,
        BookOpenIcon,
        CheckCircle2Icon,
        ChevronLeftIcon,
        ChevronRightIcon,
        CircleAlertIcon,
        Clock3Icon,
        DownloadIcon,
        ExternalLinkIcon,
        FileQuestionIcon,
        ListIcon,
        LoaderCircleIcon,
        MessageCircleIcon,
        Maximize2Icon,
        Minimize2Icon,
        XIcon,
        ZoomInIcon,
        ZoomOutIcon
    } from 'lucide-svelte';
    import LessonDiscussion from '$lib/Components/LessonDiscussion.svelte';

    export let course = { title: 'ចំណងជើងវគ្គសិក្សា' };
    export let lesson = { title: 'មេរៀនទី ១', duration: '10:00' };
    export let lessons = [];
    export let currentProgress = 0;
    export let currentUser = null;
    
    const dispatch = createEventDispatcher();

    let zoom = 100;
    let currentPage = 1;
    let totalPages = 10; // Mock total pages
    let isFullScreen = false;
    let showControls = true;
    let hideControlsTimeout;
    let showToc = false;
    let showDiscussion = false;
    let discussionCount = 0;
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
        discussionCount = 0;
        clearTimeout(resumeToastTimeout);
    }

    $: if (pdfDoc && currentPage === totalPages && !isCompleted) {
        markComplete();
    }

    $: lessonFileUrl = normalizeAssetProxyUrl(lesson?.url, PUBLIC_R2_PUBLIC_URL);

    $: if (lesson) {
        errorMessage = ''; // Reset error when lesson changes
        isPdf = !!(lessonFileUrl && lessonFileUrl.toLowerCase().match(/\.pdf(\?.*)?$/));
        if (isPdf) {
            loadPdf(lessonFileUrl);
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
            // Reserve room for the header, page toolbar, lesson footer, and viewer padding.
            const availH = window.innerHeight - 196;
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
        if (!currentUser || !lesson || lesson.id === 'fallback') {
            currentPage = 1;
            return;
        }

        try {
            const response = await fetch(`/api/lesson-progress?lesson_id=${encodeURIComponent(lesson.id)}`, {
                cache: 'no-store',
                credentials: 'same-origin'
            });

            if (!response.ok) {
                console.warn('Unable to load lesson progress:', response.status);
                currentPage = 1;
                return;
            }

            const data = await response.json();
            currentPage = data.progress?.last_page || 1;
            isCompleted = data.progress?.completed || false;
        } catch (error) {
            console.warn('Unable to load lesson progress:', error);
            currentPage = 1;
            return;
        }
        
        if (currentPage > 1 && !isCompleted) {
            resumeToastMessage = `អ្នកបានរៀនដល់ទំព័រទី ${currentPage} នៃ ${totalPages}`;
            clearTimeout(resumeToastTimeout);
            resumeToastTimeout = setTimeout(() => {
                resumeToastMessage = '';
            }, 4000);
        }
    }

    async function saveProgress() {
        if (!currentUser || !lesson || lesson.id === 'fallback') return;

        try {
            const response = await fetch('/api/lesson-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    lesson_id: lesson.id,
                    course_id: course.id,
                    last_page: currentPage
                })
            });

            if (!response.ok) {
                console.warn('Unable to save lesson progress:', response.status);
            }
        } catch (error) {
            console.warn('Unable to save lesson progress:', error);
        }
    }

    async function markComplete() {
        if (!currentUser || !lesson || lesson.id === 'fallback') return;

        try {
            const response = await fetch('/api/lesson-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    lesson_id: lesson.id,
                    course_id: course.id,
                    last_page: currentPage,
                    completed: true
                })
            });

            if (response.ok) {
                isCompleted = true;
            } else {
                console.warn('Unable to mark lesson complete:', response.status);
            }
        } catch (error) {
            console.warn('Unable to mark lesson complete:', error);
        }
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
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    }

    function syncFullscreenState() {
        isFullScreen = !!document.fullscreenElement;
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
    $: canDownload = !!(course?.allow_download && lessonFileUrl && !isYouTube);

    async function downloadLesson() {
        if (!lessonFileUrl || isDownloading) return;
        isDownloading = true;
        try {
            const res = await fetch(lessonFileUrl);
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
            window.open(lessonFileUrl, '_blank');
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
        document.addEventListener('fullscreenchange', syncFullscreenState);
    });
    
    onDestroy(() => {
        clearTimeout(hideControlsTimeout);
        clearTimeout(saveProgressTimeout);
        clearTimeout(resumeToastTimeout);
        document.removeEventListener('fullscreenchange', syncFullscreenState);
        // Clear Memory ពេលបិទ Component
        if (currentLoadingTask) currentLoadingTask.destroy().catch(()=>{});
        if (pdfDoc) pdfDoc.destroy().catch(()=>{});
    });
</script>

<svelte:window on:keydown={handleKeyDown} on:resize={() => { if (pdfDoc) queueRenderPage(currentPage); }} />

<div
    class="lesson-shell fixed inset-0 z-50 flex flex-col overflow-hidden"
    role="region"
    aria-label="Lesson Player"
    transition:fade={{ duration: 180 }}
    on:touchstart={handleTouchStart}
    on:touchmove={handleTouchMove}
    on:touchend={handleTouchEnd}
>
    {#if resumeToastMessage}
        <div
            class="resume-toast absolute left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-bold shadow-xl"
            transition:fly={{ y: -16, duration: 300 }}
        >
            <BookOpenIcon size={18} />
            {resumeToastMessage}
        </div>
    {/if}

    <header class="lesson-header relative z-20 flex-shrink-0">
        <div class="flex min-h-[64px] items-center gap-2 px-2.5 sm:gap-3 sm:px-5">
            <button
                on:click={() => dispatch('close')}
                class="reader-icon-button flex-shrink-0"
                aria-label="ត្រឡប់ក្រោយ"
                title="ត្រឡប់ក្រោយ"
            >
                <ArrowLeftIcon size={20} strokeWidth={2.25} />
            </button>

            <div class="min-w-0 flex-1">
                <p class="course-title truncate">{course.title}</p>
                <h1 class="lesson-title truncate">{lesson.title}</h1>
            </div>

            <div class="hidden min-w-[116px] items-center gap-2 md:flex">
                <div class="progress-track flex-1">
                    <div class="progress-value" style="width:{currentProgress}%"></div>
                </div>
                <span class="progress-label">{currentProgress}%</span>
            </div>

            <div class="header-actions flex flex-shrink-0 items-center gap-1">
                <button
                    on:click={() => showToc = !showToc}
                    class:reader-icon-button-active={showToc}
                    class="reader-icon-button"
                    aria-label="បញ្ជីមាតិកា"
                    aria-pressed={showToc}
                    title="បញ្ជីមាតិកា"
                >
                    <ListIcon size={19} />
                </button>

                <button
                    on:click={() => showDiscussion = !showDiscussion}
                    class:reader-icon-button-active={showDiscussion}
                    class="reader-icon-button relative"
                    aria-label="ការពិភាក្សាមេរៀន"
                    aria-pressed={showDiscussion}
                    title="ការពិភាក្សាមេរៀន"
                >
                    <MessageCircleIcon size={19} />
                    {#if discussionCount > 0}
                        <span class="discussion-count">{discussionCount > 99 ? '99+' : discussionCount}</span>
                    {/if}
                </button>

                <button
                    on:click={toggleFullScreen}
                    class="reader-icon-button hidden sm:flex"
                    aria-label={isFullScreen ? 'ចាកចេញពីពេញអេក្រង់' : 'ពេញអេក្រង់'}
                    title={isFullScreen ? 'ចាកចេញពីពេញអេក្រង់' : 'ពេញអេក្រង់'}
                >
                    {#if isFullScreen}
                        <Minimize2Icon size={18} />
                    {:else}
                        <Maximize2Icon size={18} />
                    {/if}
                </button>

                {#if canDownload}
                    <button
                        on:click={downloadLesson}
                        class="download-button"
                        disabled={isDownloading}
                        aria-label="ទាញយកមេរៀន"
                        title="ទាញយកមេរៀន"
                    >
                        {#if isDownloading}
                            <LoaderCircleIcon class="animate-spin" size={19} />
                        {:else}
                            <DownloadIcon size={19} />
                        {/if}
                    </button>
                {/if}
            </div>
        </div>

        <div class="mobile-progress md:hidden">
            <div class="progress-value" style="width:{currentProgress}%"></div>
        </div>
    </header>

    <div class="relative flex flex-1 overflow-hidden">
        {#if showToc && lessons.length > 0}
            <button
                class="toc-backdrop absolute inset-0 z-20 sm:hidden"
                on:click={() => showToc = false}
                aria-label="បិទបញ្ជីមាតិកា"
            ></button>

            <aside
                class="toc-panel absolute inset-y-0 left-0 z-30 flex w-[min(84vw,320px)] flex-shrink-0 flex-col overflow-hidden sm:relative sm:w-80"
                transition:fly={{ x: -24, duration: 180 }}
            >
                <div class="toc-header flex flex-shrink-0 items-center justify-between px-4 py-3.5">
                    <div class="flex min-w-0 items-center gap-2">
                        <BookOpenIcon size={18} />
                        <div class="min-w-0">
                            <h2>មាតិកាវគ្គសិក្សា</h2>
                            <p>{lessons.length} មេរៀន</p>
                        </div>
                    </div>
                    <button
                        class="reader-icon-button sm:hidden"
                        on:click={() => showToc = false}
                        aria-label="បិទបញ្ជីមាតិកា"
                        title="បិទ"
                    >
                        <XIcon size={18} />
                    </button>
                </div>

                <nav class="toc-list flex-1 overflow-y-auto p-2" aria-label="បញ្ជីមេរៀន">
                    {#each lessons as l, i}
                        <button
                            class:toc-item-active={l.id === lesson.id}
                            class="toc-item flex w-full items-start gap-3 text-left"
                            aria-current={l.id === lesson.id ? 'page' : undefined}
                            on:click={() => {
                                lesson = l;
                                resetState();
                                if (typeof window !== 'undefined' && window.innerWidth < 640) showToc = false;
                            }}
                        >
                            <span class="toc-number">{String(i + 1).padStart(2, '0')}</span>
                            <span class="min-w-0 flex-1">
                                <span class="toc-item-title">{l.title}</span>
                                {#if l.duration}
                                    <span class="toc-duration">
                                        <Clock3Icon size={12} />
                                        {l.duration}
                                    </span>
                                {/if}
                            </span>
                        </button>
                    {/each}
                </nav>
            </aside>
        {/if}

        {#if showDiscussion}
            <button
                class="discussion-backdrop absolute inset-0 z-40"
                on:click={() => showDiscussion = false}
                aria-label="បិទការពិភាក្សា"
            ></button>
            <LessonDiscussion
                {lesson}
                {course}
                {currentUser}
                on:close={() => showDiscussion = false}
                on:count={(event) => discussionCount = event.detail}
            />
        {/if}

        <main class="flex min-w-0 flex-1 flex-col overflow-hidden" on:mousemove={handleMouseMove}>
            <div
                class:pdf-viewport={isPdf}
                class:media-viewport={!isPdf}
                class="reader-viewport flex-1"
            >
                <div class:pdf-document={isPdf} class:media-document={!isPdf} class="document-surface relative">
                    {#if pageExitState}
                        <img
                            src={pageExitState.src}
                            alt=""
                            class="pointer-events-none absolute left-0 top-0"
                            style="width:{pageExitState.w}px; height:{pageExitState.h}px; z-index:8; display:block;
                                   animation:{pageExitState.dir > 0 ? 'bookExitLeft' : 'bookExitRight'} 0.38s ease-in forwards;"
                        />
                    {/if}

                    <canvas bind:this={canvas} class:hidden={!isPdf} class="pdf-canvas"></canvas>

                    {#if !isPdf && lessonFileUrl}
                        <div class="video-frame">
                            <iframe
                                src={getEmbedUrl(lessonFileUrl)}
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowfullscreen
                                title={lesson.title}
                                loading="lazy"
                            ></iframe>
                        </div>
                    {/if}

                    {#if errorMessage}
                        <div class="reader-state absolute inset-0 z-20">
                            <span class="state-icon state-icon-error">
                                <CircleAlertIcon size={26} />
                            </span>
                            <p>{errorMessage}</p>
                            <a href={lessonFileUrl} target="_blank" rel="noopener noreferrer" class="state-action">
                                <ExternalLinkIcon size={16} />
                                បើកផ្ទាល់
                            </a>
                        </div>
                    {/if}

                    {#if isPdf && !pdfDoc && !errorMessage}
                        <div class="reader-state loading-state">
                            <LoaderCircleIcon class="animate-spin text-teal-600" size={30} />
                            <p>
                                កំពុងផ្ទុកឯកសារ
                                {#if downloadProgress > 0 && downloadProgress < 100}
                                    <strong>{downloadProgress}%</strong>
                                {/if}
                            </p>
                        </div>
                    {/if}

                    {#if !lessonFileUrl && !errorMessage}
                        <div class="reader-state empty-state">
                            <span class="state-icon">
                                <FileQuestionIcon size={28} />
                            </span>
                            <p>មិនមានមាតិកា</p>
                        </div>
                    {/if}
                </div>

                {#if !isPdf && lessonFileUrl && !isCompleted && !errorMessage}
                    <button on:click={markComplete} class="complete-button" in:fade={{ duration: 250, delay: 300 }}>
                        <CheckCircle2Icon size={19} />
                        បញ្ជាក់ថាបានរៀនចប់
                    </button>
                {/if}
            </div>

            {#if isPdf && pdfDoc}
                <div class="page-toolbar flex flex-shrink-0 items-center justify-between gap-2 px-2.5 sm:px-4">
                    <div class="zoom-controls flex items-center gap-1">
                        <button on:click={zoomOut} class="toolbar-icon-button" aria-label="បន្ថយទំហំ" title="បន្ថយទំហំ">
                            <ZoomOutIcon size={17} />
                        </button>
                        <span class="zoom-value">{zoom}%</span>
                        <button on:click={zoomIn} class="toolbar-icon-button" aria-label="ពង្រីកទំហំ" title="ពង្រីកទំហំ">
                            <ZoomInIcon size={17} />
                        </button>
                    </div>

                    <div class="page-controls flex items-center gap-1.5">
                        <button
                            disabled={currentPage === 1}
                            on:click={() => changePage(-1)}
                            class="page-nav-button"
                            aria-label="ទំព័រមុន"
                            title="ទំព័រមុន"
                        >
                            <ChevronLeftIcon size={20} />
                        </button>

                        <div class="page-counter" aria-label={`ទំព័រ ${currentPage} នៃ ${totalPages}`}>
                            <strong>{currentPage}</strong>
                            <span>/</span>
                            <span>{totalPages}</span>
                        </div>

                        <button
                            disabled={currentPage === totalPages}
                            on:click={() => changePage(1)}
                            class="page-nav-button"
                            aria-label="ទំព័របន្ទាប់"
                            title="ទំព័របន្ទាប់"
                        >
                            <ChevronRightIcon size={20} />
                        </button>
                    </div>

                    <div class="hidden w-[104px] sm:block"></div>
                </div>
            {/if}
        </main>
    </div>

    <footer class="lesson-footer relative z-20 flex flex-shrink-0 items-center gap-2 px-2.5 sm:px-4">
        <button disabled={!hasPrev} on:click={prevLesson} class="lesson-nav-button">
            <ChevronLeftIcon size={18} />
            <span class="hidden sm:inline">មេរៀនមុន</span>
        </button>

        <div class="flex min-w-0 flex-1 justify-center">
            {#if isCompleted}
                <span class="lesson-status lesson-status-complete">
                    <CheckCircle2Icon size={16} />
                    រៀនចប់ហើយ
                </span>
            {:else if lesson.duration}
                <span class="lesson-status">
                    <Clock3Icon size={15} />
                    {lesson.duration}
                </span>
            {:else}
                <span class="lesson-position">{Math.max(currentIndex + 1, 1)} / {Math.max(lessons.length, 1)}</span>
            {/if}
        </div>

        <button disabled={!hasNext} on:click={nextLesson} class="lesson-nav-button lesson-nav-button-next">
            <span class="hidden sm:inline">មេរៀនបន្ទាប់</span>
            <ChevronRightIcon size={18} />
        </button>
    </footer>
</div>

<style>
    .lesson-shell {
        background: #e7edf2;
        color: #17212b;
    }

    .lesson-header {
        background: #ffffff;
        border-bottom: 1px solid #d7e0e8;
        box-shadow: 0 2px 12px rgba(20, 35, 50, 0.08);
    }

    .reader-icon-button,
    .download-button,
    .toolbar-icon-button,
    .page-nav-button {
        display: flex;
        width: 40px;
        height: 40px;
        flex: 0 0 40px;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        border: 1px solid #d7e0e8;
        background: #f8fafc;
        color: #405265;
        cursor: pointer;
        transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
    }

    .reader-icon-button:hover,
    .toolbar-icon-button:hover,
    .page-nav-button:hover:not(:disabled) {
        border-color: #aebdca;
        background: #eef3f6;
        color: #17212b;
    }

    .reader-icon-button-active {
        border-color: #0f766e;
        background: #e6f5f3;
        color: #0f766e;
    }

    .discussion-count {
        position: absolute;
        right: -0.25rem;
        top: -0.3rem;
        min-width: 1.15rem;
        height: 1.15rem;
        padding: 0 0.2rem;
        border: 2px solid #ffffff;
        border-radius: 999px;
        background: #dc2626;
        color: #ffffff;
        font-size: 0.58rem;
        font-weight: 800;
        line-height: 0.95rem;
        text-align: center;
    }

    .discussion-backdrop {
        border: 0;
        background: rgba(15, 23, 42, 0.32);
    }

    .download-button {
        border-color: #0f766e;
        background: #0f766e;
        color: #ffffff;
    }

    .download-button:hover:not(:disabled) {
        border-color: #0b5f59;
        background: #0b5f59;
    }

    .download-button:disabled,
    .reader-icon-button:disabled,
    .toolbar-icon-button:disabled,
    .page-nav-button:disabled {
        cursor: not-allowed;
        opacity: 0.45;
    }

    .reader-icon-button:focus-visible,
    .download-button:focus-visible,
    .toolbar-icon-button:focus-visible,
    .page-nav-button:focus-visible,
    .toc-item:focus-visible,
    .lesson-nav-button:focus-visible,
    .complete-button:focus-visible {
        outline: 3px solid rgba(14, 165, 164, 0.28);
        outline-offset: 2px;
    }

    .course-title {
        color: #6a7b8c;
        font-size: 0.68rem;
        line-height: 1.35;
        letter-spacing: 0;
    }

    .lesson-title {
        margin-top: 2px;
        color: #17212b;
        font-size: 0.95rem;
        line-height: 1.4;
        letter-spacing: 0;
    }

    .progress-track,
    .mobile-progress {
        overflow: hidden;
        background: #dfe7ed;
    }

    .progress-track {
        height: 6px;
        border-radius: 3px;
    }

    .mobile-progress {
        height: 3px;
    }

    .progress-value {
        height: 100%;
        border-radius: inherit;
        background: #0f8f83;
        transition: width 300ms ease;
    }

    .progress-label {
        min-width: 34px;
        color: #516273;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.72rem;
        text-align: right;
    }

    .resume-toast {
        top: 76px;
        max-width: calc(100vw - 24px);
        overflow: hidden;
        border: 1px solid #b7e3de;
        border-radius: 6px;
        background: #ffffff;
        color: #0f766e;
        text-overflow: ellipsis;
    }

    .toc-backdrop {
        border: 0;
        background: rgba(15, 23, 32, 0.54);
    }

    .toc-panel {
        background: #f8fafc;
        border-right: 1px solid #d5dfe7;
        box-shadow: 12px 0 28px rgba(22, 36, 50, 0.12);
    }

    .toc-header {
        min-height: 64px;
        border-bottom: 1px solid #dce4eb;
        background: #ffffff;
        color: #0f766e;
    }

    .toc-header h2 {
        margin: 0;
        color: #23313f;
        font-size: 0.9rem;
        font-weight: 800;
        line-height: 1.4;
        letter-spacing: 0;
    }

    .toc-header p {
        margin: 1px 0 0;
        color: #728293;
        font-size: 0.68rem;
        line-height: 1.3;
    }

    .toc-list {
        scrollbar-color: #b8c5d0 transparent;
        scrollbar-width: thin;
    }

    .toc-item {
        min-height: 64px;
        padding: 10px;
        border: 1px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: #435465;
        cursor: pointer;
        transition: background-color 140ms ease, border-color 140ms ease;
    }

    .toc-item:hover {
        background: #eef3f6;
    }

    .toc-item-active {
        border-color: #a9d9d4;
        background: #e6f5f3;
        color: #154f4a;
    }

    .toc-number {
        display: flex;
        width: 30px;
        height: 30px;
        flex: 0 0 30px;
        align-items: center;
        justify-content: center;
        border-radius: 5px;
        background: #e7edf2;
        color: #667789;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.68rem;
        font-weight: 700;
    }

    .toc-item-active .toc-number {
        background: #0f766e;
        color: #ffffff;
    }

    .toc-item-title {
        display: -webkit-box;
        overflow: hidden;
        color: inherit;
        font-size: 0.82rem;
        font-weight: 700;
        line-height: 1.55;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
    }

    .toc-duration {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: 4px;
        color: #7c8c9b;
        font-size: 0.66rem;
    }

    .reader-viewport {
        min-width: 0;
        background: #dfe6ec;
    }

    .pdf-viewport {
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        padding: 12px;
    }

    .media-viewport {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        overflow: auto;
        padding: 24px 16px;
    }

    .document-surface {
        max-width: 100%;
    }

    .pdf-document {
        display: inline-block;
        min-width: 280px;
        min-height: 320px;
        overflow: hidden;
        border: 1px solid #cbd5de;
        border-radius: 3px;
        background: #ffffff;
        box-shadow: 0 3px 10px rgba(31, 46, 61, 0.12), 0 18px 42px rgba(31, 46, 61, 0.16);
        perspective: 1200px;
    }

    .media-document {
        width: min(100%, 1100px);
    }

    .pdf-canvas {
        display: block;
    }

    .video-frame {
        width: 100%;
        overflow: hidden;
        border: 1px solid #283746;
        border-radius: 6px;
        aspect-ratio: 16 / 9;
        background: #101820;
        box-shadow: 0 12px 32px rgba(31, 46, 61, 0.18);
    }

    .video-frame iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
    }

    .reader-state {
        display: flex;
        min-width: 278px;
        min-height: 318px;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        padding: 24px;
        background: rgba(255, 255, 255, 0.98);
        color: #526273;
        text-align: center;
    }

    .reader-state p {
        max-width: 380px;
        margin: 0;
        font-size: 0.84rem;
        line-height: 1.7;
    }

    .state-icon {
        display: flex;
        width: 52px;
        height: 52px;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background: #edf2f5;
        color: #687989;
    }

    .state-icon-error {
        background: #fff1f0;
        color: #c33d36;
    }

    .state-action,
    .complete-button {
        display: inline-flex;
        min-height: 40px;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 8px 14px;
        border: 1px solid #0f766e;
        border-radius: 6px;
        background: #0f766e;
        color: #ffffff;
        font-size: 0.82rem;
        font-weight: 700;
        text-decoration: none;
        cursor: pointer;
    }

    .complete-button {
        flex: 0 0 auto;
        margin-top: 4px;
    }

    .page-toolbar {
        min-height: 52px;
        border-top: 1px solid #d6e0e7;
        background: #ffffff;
        box-shadow: 0 -2px 10px rgba(25, 40, 55, 0.06);
    }

    .toolbar-icon-button {
        width: 32px;
        height: 32px;
        flex-basis: 32px;
        border-radius: 5px;
    }

    .zoom-value {
        min-width: 38px;
        color: #536475;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.7rem;
        text-align: center;
    }

    .page-nav-button {
        width: 36px;
        height: 36px;
        flex-basis: 36px;
        border-color: #0f766e;
        background: #0f766e;
        color: #ffffff;
    }

    .page-nav-button:hover:not(:disabled) {
        border-color: #0b5f59;
        background: #0b5f59;
        color: #ffffff;
    }

    .page-nav-button:disabled {
        border-color: #d8e0e6;
        background: #edf1f4;
        color: #9ba8b4;
    }

    .page-counter {
        display: flex;
        min-width: 78px;
        height: 36px;
        align-items: center;
        justify-content: center;
        gap: 5px;
        border: 1px solid #d8e0e7;
        border-radius: 6px;
        background: #f6f8fa;
        color: #788795;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.78rem;
    }

    .page-counter strong {
        color: #17212b;
        font-size: 0.88rem;
    }

    .lesson-footer {
        min-height: 56px;
        border-top: 1px solid #263746;
        background: #18242f;
        box-shadow: 0 -2px 12px rgba(14, 25, 35, 0.12);
    }

    .lesson-nav-button {
        display: flex;
        min-width: 42px;
        min-height: 38px;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 7px 10px;
        border: 1px solid #40515f;
        border-radius: 6px;
        background: #22313d;
        color: #e1e9ef;
        font-size: 0.78rem;
        font-weight: 700;
        cursor: pointer;
        transition: background-color 140ms ease, border-color 140ms ease;
    }

    .lesson-nav-button-next {
        border-color: #168d82;
        background: #0f766e;
        color: #ffffff;
    }

    .lesson-nav-button:hover:not(:disabled) {
        border-color: #607483;
        background: #2c3d4a;
    }

    .lesson-nav-button-next:hover:not(:disabled) {
        border-color: #20a598;
        background: #0b655e;
    }

    .lesson-nav-button:disabled {
        cursor: not-allowed;
        opacity: 0.34;
    }

    .lesson-status {
        display: inline-flex;
        max-width: 100%;
        min-height: 30px;
        align-items: center;
        gap: 6px;
        overflow: hidden;
        padding: 5px 10px;
        color: #aebbc5;
        font-size: 0.72rem;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .lesson-status-complete {
        border: 1px solid rgba(74, 222, 128, 0.28);
        border-radius: 6px;
        background: rgba(34, 197, 94, 0.12);
        color: #86efac;
        font-weight: 700;
    }

    .lesson-position {
        color: #91a0ac;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.72rem;
    }

    @media (max-width: 420px) {
        .reader-icon-button,
        .download-button {
            width: 38px;
            height: 38px;
            flex-basis: 38px;
        }

        .course-title {
            font-size: 0.62rem;
        }

        .lesson-title {
            font-size: 0.82rem;
        }

        .pdf-viewport {
            padding: 8px;
        }

        .zoom-controls {
            gap: 0;
        }

        .zoom-value {
            min-width: 34px;
        }

        .page-counter {
            min-width: 68px;
        }
    }

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
