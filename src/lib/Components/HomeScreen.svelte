<script>
    import { fade, fly, scale } from 'svelte/transition';
    import { elasticOut } from 'svelte/easing';
    import { createEventDispatcher, onMount } from 'svelte';
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

    onMount(() => {
        const interval = setInterval(() => {
            currentTime = new Date();
            now = Date.now();
        }, 1000);
        return () => clearInterval(interval);
    });

    // Extract unique categories from courses
    $: categories = ['All', ...new Set(courses.map(c => c.category).filter(Boolean))];
    
    // Filter courses based on search and category
    $: filteredCourses = courses.filter(c => {
        const matchesSearch = c.title.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = selectedCategory === 'All' || c.category === selectedCategory;
        return matchesSearch && matchesCategory;
    });

    // Filter for Featured Courses (Home Page)
    $: featuredCourses = courses.filter(c => c.is_featured);
    $: displayCourses = showAllCourses ? filteredCourses : (featuredCourses.length > 0 ? featuredCourses : courses.slice(0, 2));

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

    function isJoinAvailable(meeting) {
        // null countdown means no gate set, OR gate has already passed → joinable
        return !meetingCountdowns[meeting.id];
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
        await supabase.from('access_attempts').insert({
            user_id: currentUser.id,
            course_id: courseId,
            reason: reason
        });
    }

    async function handleCourseClick(course) {
        if (isLocked(course)) {
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

        <!-- Meetings Section -->
        {#if meetings.length > 0}
            <div>
                <h3 class="font-bold text-lg mb-3 flex items-center gap-2 text-gray-800">
                    {t('upcoming_meetings')}
                    <span class="badge badge-primary badge-sm text-white">{meetings.length}</span>
                </h3>
                <div class="carousel carousel-center w-full p-1 space-x-4 bg-transparent rounded-box">
                    {#each meetings as meeting}
                        <div class="carousel-item w-80">
                            <div class="card w-80 bg-white shadow-md border border-gray-200 rounded-2xl overflow-hidden">
                                <div class="h-2 bg-primary w-full"></div>
                                <div class="card-body p-4">
                                    <h2 class="card-title text-base line-clamp-3 leading-snug text-gray-800" title={meeting.title}>{meeting.title}</h2>
                                    <div class="text-sm text-gray-500 flex flex-col gap-2 mt-2 bg-gray-50 p-2 rounded-lg">
                                        <div class="flex items-center gap-2">
                                            <span>🗓️</span>
                                            {new Date(meeting.scheduled_at).toLocaleDateString('km-KH')}
                                        </div>
                                        <div class="flex items-center gap-2">
                                            <span>⏰</span>
                                            {new Date(meeting.scheduled_at).toLocaleTimeString('km-KH', {hour: '2-digit', minute:'2-digit'})}
                                        </div>
                                    </div>
                                    <div class="card-actions justify-end mt-3">
                                        {#if isRegistered(meeting.id)}
                                            {#if isJoinAvailable(meeting)}
                                                <button class="btn btn-primary btn-sm flex-1 shadow-md shadow-primary/20" on:click={() => {
                                                    dispatch('recordMeetingAttendance', meeting);
                                                    window.open(meeting.meeting_url, '_blank');
                                                }}>
                                                    {t('join_meeting')}
                                                </button>
                                            {:else}
                                                {#if meetingCountdowns[meeting.id]}
                                                {@const cd = meetingCountdowns[meeting.id]}
                                                <div class="w-full flex flex-col items-center gap-2">
                                                    <button class="btn btn-sm w-full opacity-50 cursor-not-allowed" disabled>
                                                        🔒 {t('join_meeting')}
                                                    </button>
                                                    <div class="flex items-center justify-center gap-1 w-full">
                                                        <div class="flex flex-col items-center bg-primary/10 rounded-lg px-2 py-1 min-w-[38px]">
                                                            <span class="text-sm font-black text-primary leading-none">{String(cd.days).padStart(2,'0')}</span>
                                                            <span class="text-[9px] text-gray-400 uppercase">ថ្ងៃ</span>
                                                        </div>
                                                        <span class="text-primary font-bold text-xs">:</span>
                                                        <div class="flex flex-col items-center bg-primary/10 rounded-lg px-2 py-1 min-w-[38px]">
                                                            <span class="text-sm font-black text-primary leading-none">{String(cd.hours).padStart(2,'0')}</span>
                                                            <span class="text-[9px] text-gray-400 uppercase">ម៉ោង</span>
                                                        </div>
                                                        <span class="text-primary font-bold text-xs">:</span>
                                                        <div class="flex flex-col items-center bg-primary/10 rounded-lg px-2 py-1 min-w-[38px]">
                                                            <span class="text-sm font-black text-primary leading-none">{String(cd.minutes).padStart(2,'0')}</span>
                                                            <span class="text-[9px] text-gray-400 uppercase">នាទី</span>
                                                        </div>
                                                        <span class="text-primary font-bold text-xs">:</span>
                                                        <div class="flex flex-col items-center bg-primary/10 rounded-lg px-2 py-1 min-w-[38px]">
                                                            <div class="relative h-5 overflow-hidden w-full flex justify-center">
                                                                {#key cd.seconds}
                                                                    <span class="absolute text-sm font-black text-primary leading-none"
                                                                        in:fly={{ y: -14, duration: 250 }}
                                                                        out:fly={{ y: 14, duration: 200 }}>
                                                                        {String(cd.seconds).padStart(2,'0')}
                                                                    </span>
                                                                {/key}
                                                            </div>
                                                            <span class="text-[9px] text-gray-400 uppercase">វិនាទី</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                {/if}
                                            {/if}
                                        {:else}
                                            <button class="btn btn-outline btn-primary btn-sm flex-1" on:click={() => dispatch('openMeetingRegistration', meeting)}>
                                                {t('register')}
                                            </button>
                                        {/if}
                                        <button class="btn btn-ghost btn-sm btn-square" title="ចែករំលែក" on:click={() => dispatch('shareMeeting', meeting)}>
                                            🔗
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}

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
                            </div>
                            
                            <div class="absolute bottom-2 right-2 badge badge-neutral text-white text-xs">
                                ⏱️ {course.duration || t('duration_not_set')}
                            </div>
                        </figure>
                        
                        <div class="card-body p-4">
                            <div class="flex justify-between items-start gap-2">
                                <h2 class="card-title text-base font-bold line-clamp-2 min-h-[3rem] text-base-content leading-snug">{course.title}</h2>
                                <button class="btn btn-ghost btn-xs btn-circle text-gray-400 hover:text-primary" on:click|stopPropagation={() => dispatch('shareCourse', course)}>
                                    🔗
                                </button>
                            </div>
                            <p class="text-xs text-base-content line-clamp-2 mb-4 h-8">{course.description || t('no_description')}</p>
                            
                            <div class="card-actions flex-col gap-2 mt-auto">
                                {#if course.has_pre_test && !preTestDoneCourses.includes(String(course.id))}
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

<style>
    .no-scrollbar::-webkit-scrollbar {
        display: none;
    }
    .no-scrollbar {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
</style>
