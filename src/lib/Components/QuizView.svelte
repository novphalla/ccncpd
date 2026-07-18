<script>
    import { createEventDispatcher, onDestroy } from 'svelte';
    import { fade, fly } from 'svelte/transition';

    export let questions = [];
    export let courseId;
    export let supabase;
    export let currentUser;
    export let passingScore = 70; // ទទួលពិន្ទុជាប់ពីខាងក្រៅ (Default 70%)
    export let cooldownMinutes = 60; // រយៈពេលរង់ចាំ (នាទី)
    export let quizType = 'post'; // ទទួលយក type ពី +page.svelte
    export let courseTitle = ''; // ទទួលឈ្មោះវគ្គសិក្សា

    const dispatch = createEventDispatcher();

    let currentQuestionIndex = 0;
    let score = 0;
    let showResult = false;
    let selectedOption = null;
    let answers = []; 
    let passed = false;
    let isFinishing = false;
    let attemptKey = null;
    let xpAwarded = 0;
    
    // Cooldown Timer State
    let remainingTimeDisplay = '';
    let timerInterval;
    let cooldownProgress = 0;

    // Reactive statement to get current question safely
    $: currentQuestion = questions && questions[currentQuestionIndex];
    
    let shuffledOptions = [];
    $: if (currentQuestion && currentQuestion.options) {
        shuffledOptions = currentQuestion.options.map((opt, i) => ({ text: opt, originalIndex: i }));
        for (let i = shuffledOptions.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
        }
    }

    function getOptionClasses(originalIndex) {
        const isSelected = selectedOption === originalIndex;
        return isSelected
            ? 'bg-primary text-white border-primary shadow-lg shadow-primary/40 scale-[1.02] ring-4 ring-primary/20'
            : 'bg-white border-gray-200 hover:border-primary/50 hover:bg-blue-50/30 text-gray-700 hover:shadow-md hover:scale-[1.01]';
    }

    function selectOption(index) {
        if (isFinishing) return;
        selectedOption = index;
    }

    function createAttemptKey() {
        if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
            const random = Math.floor(Math.random() * 16);
            const value = character === 'x' ? random : (random & 0x3) | 0x8;
            return value.toString(16);
        });
    }

    function handleNext() {
        if (isFinishing || selectedOption === null) return;
        answers[currentQuestionIndex] = selectedOption;

        if (currentQuestionIndex < questions.length - 1) {
            nextQuestion();
        } else {
            finishQuiz();
        }
    }

    function nextQuestion() {
        currentQuestionIndex++;
        selectedOption = null;
    }

    async function triggerConfetti() {
        try {
            const { default: confetti } = await import('canvas-confetti');
            confetti({
                particleCount: 150,
                spread: 70,
                origin: { y: 0.6 }
            });
        } catch (e) {
            console.error("Confetti error:", e);
        }
    }

    function startCooldownTimer() {
        const retryAvailableAt = Date.now() + (cooldownMinutes * 60 * 1000);
        
        updateTimer(retryAvailableAt);
        if (timerInterval) clearInterval(timerInterval);
        
        timerInterval = setInterval(() => updateTimer(retryAvailableAt), 1000);
    }

    function updateTimer(endTime) {
        const diff = endTime - Date.now();
        const total = cooldownMinutes * 60 * 1000;
        if (diff <= 0) {
            remainingTimeDisplay = '';
            cooldownProgress = 0;
            clearInterval(timerInterval);
        } else {
            const m = Math.floor(diff / 60000);
            const s = Math.floor((diff % 60000) / 1000);
            remainingTimeDisplay = `${m}នាទី ${s}វិនាទី`;
            cooldownProgress = Math.min(100, Math.max(0, (diff / total) * 100));
        }
    }

    onDestroy(() => {
        if (timerInterval) clearInterval(timerInterval);
    });

    async function finishQuiz() {
        if (isFinishing || !currentUser || !questions.length) return;

        isFinishing = true;
        attemptKey ||= createAttemptKey();
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const headers = { 'Content-Type': 'application/json' };
            if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

            const response = await fetch('/api/submit-quiz', {
                method: 'POST',
                headers,
                credentials: 'same-origin',
                body: JSON.stringify({
                    courseId,
                    answers,
                    type: quizType,
                    questionIds: questions.map(question => question.id),
                    attemptKey
                })
            });
            const savedResult = await response.json().catch(() => ({}));
            if (!response.ok) {
                if (response.status === 429 && savedResult.error?.startsWith('QUIZ_COOLDOWN:')) {
                    throw new Error('មិនទាន់ដល់ពេលអាចធ្វើតេស្តម្តងទៀតបានទេ។');
                }
                if (response.status === 409) {
                    throw new Error('អ្នកបានបញ្ចប់តេស្តនេះរួចហើយ។');
                }
                throw new Error(savedResult.error || 'មិនអាចរក្សាទុកលទ្ធផលតេស្តបានទេ');
            }
            if (!savedResult?.result_id || !Number.isFinite(Number(savedResult.correct_count))) {
                throw new Error('Server បានផ្ញើលទ្ធផលមិនត្រឹមត្រូវ។ សូមព្យាយាមម្តងទៀត។');
            }

            score = Number(savedResult.correct_count);
            passed = savedResult.passed === true;
            xpAwarded = Number(savedResult.xp_awarded || 0);
            showResult = true;

            dispatch('saved', {
                attempt: {
                    id: savedResult.result_id,
                    course_id: courseId,
                    passed,
                    created_at: savedResult.created_at || new Date().toISOString(),
                    type: quizType
                },
                newXp: savedResult.new_xp,
                newCpdTotal: savedResult.new_cpd_total
            });

            if (passed) {
                dispatch('complete');
                triggerConfetti();
            } else {
                startCooldownTimer();
            }
        } catch (error) {
            console.error('Error saving quiz result:', error);
            alert('បរាជ័យក្នុងការរក្សាទុកលទ្ធផលតេស្ត: ' + error.message);
        } finally {
            isFinishing = false;
        }
    }
</script>

<div class="fixed inset-0 bg-gray-50 z-50 flex flex-col overflow-hidden">
    {#if currentQuestion}
        <!-- Header -->
        <div class="bg-white p-4 shadow-sm flex justify-between items-center z-20">
            <div class="flex items-center gap-2">
                <button on:click={() => dispatch('close')} class="btn btn-sm btn-circle btn-ghost" disabled={isFinishing}>✕</button>
                <span class="font-bold text-gray-800">សំណួរទី {currentQuestionIndex + 1}/{questions.length}</span>
            </div>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto overflow-x-hidden p-6 flex flex-col items-center">
            {#if !showResult}
                {#key currentQuestionIndex}
                <div class="w-full max-w-lg" in:fly={{ x: 30, duration: 300 }}>
                    {#if currentQuestion.image_url}
                        <img src={currentQuestion.image_url} alt="សំណួរ" class="w-full h-48 object-contain mb-6 rounded-2xl bg-white shadow-sm border" />
                    {/if}
                    
                    <h2 class="text-xl font-bold mb-8 leading-relaxed text-center">{currentQuestion.question}</h2>

                    <div class="flex flex-col gap-4">
                        {#each shuffledOptions as option}
                            <button 
                                disabled={isFinishing}
                                on:click={() => selectOption(option.originalIndex)}
                                class="btn h-auto py-4 px-6 justify-between text-left normal-case text-base border-2 rounded-2xl transition-all duration-300 {getOptionClasses(option.originalIndex)}"
                            >
                                <span class="font-medium">{option.text}</span>
                            </button>
                        {/each}
                    </div>

                    {#if selectedOption !== null}
                        <div class="mt-6 flex justify-end" in:fade>
                            <button on:click={handleNext} disabled={isFinishing} class="btn btn-primary btn-lg rounded-full shadow-lg shadow-primary/40 px-8">
                                {#if isFinishing}
                                    <span class="loading loading-spinner loading-sm"></span>
                                {/if}
                                {currentQuestionIndex === questions.length - 1 ? 'បញ្ចប់' : 'បន្ទាប់ →'}
                            </button>
                        </div>
                    {/if}
                </div>
                {/key}
            {:else}
                <div class="text-center w-full max-w-md pt-10" in:fly={{ y: 20 }}>
                    {#if passed}
                        <div class="mb-6">
                            <div class="w-32 h-32 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4 shadow-sm animate-bounce">
                                <span class="text-6xl">🎉</span>
                            </div>
                            {#if quizType === 'pre'}
                                <h2 class="text-3xl font-bold mb-2 text-green-600">បានបញ្ចប់ Pre-test</h2>
                                <p class="text-gray-500 text-lg">អ្នកអាចចូលរៀនមេរៀនបានហើយ</p>
                            {:else}
                                <h2 class="text-3xl font-bold mb-2 text-green-600">អបអរសាទរ!</h2>
                                <p class="text-gray-500 text-lg">អ្នកបានធ្វើតេសជាប់ដោយជោគជ័យ</p>
                            {/if}
                        </div>
                    {:else}
                        <div class="mb-6">
                            <div class="w-32 h-32 mx-auto bg-red-100 rounded-full flex items-center justify-center mb-4 shadow-sm">
                                <span class="text-6xl">😢</span>
                            </div>
                            <h2 class="text-3xl font-bold mb-2 text-red-600">បរាជ័យ!</h2>
                            <p class="text-gray-500 text-lg">សូមព្យាយាមម្តងទៀត</p>
                        </div>
                    {/if}
                    
                <!-- ព័ត៌មានអ្នកប្រឡង (បង្ហាញឈ្មោះពេលថតអេក្រង់) -->
                <div class="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-6 shadow-sm text-center">
                    <p class="text-xs text-blue-600/80 font-bold uppercase tracking-wider mb-1">បេក្ខជនធ្វើតេស / Candidate</p>
                    <h3 class="text-xl font-black text-blue-900">{currentUser?.full_name || 'អនាមិក'}</h3>
                    {#if currentUser?.name_latin}
                        <p class="text-sm font-medium text-blue-800/70">{currentUser.name_latin}</p>
                    {/if}
                    {#if courseTitle}
                        <div class="mt-3 pt-2 border-t border-blue-200/50">
                            <p class="text-sm font-bold text-blue-900 line-clamp-2">{courseTitle}</p>
                        </div>
                    {/if}
                    <p class="text-[11px] text-blue-700/60 font-mono mt-1.5 flex justify-center items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" /></svg>
                        {new Date().toLocaleString('km-KH')}
                    </p>
                </div>

                    <div class="stats shadow w-full mb-6 bg-white border border-gray-100">
                        <div class="stat place-items-center">
                            <div class="stat-title">ពិន្ទុសរុប</div>
                            <div class="stat-value {passed ? 'text-green-500' : 'text-red-500'} text-3xl">{Math.round((score / questions.length) * 100)}%</div>
                            <div class="stat-desc">ឆ្លើយត្រូវ {score}/{questions.length}</div>
                        </div>
                        <div class="stat place-items-center">
                            <div class="stat-title">XP ទទួលបាន</div>
                            <div class="stat-value text-amber-500 text-3xl">+{xpAwarded}</div>
                            <div class="stat-desc">ពិន្ទុបទពិសោធន៍</div>
                        </div>
                    </div>

                    <div class="flex flex-col gap-3">
                        {#if !passed}
                            <button on:click={() => dispatch('review')} class="btn btn-warning w-full btn-lg text-white shadow-md">📝 មើលចម្លើយដែលខុស</button>
                            <button on:click={() => dispatch('retry')} class="btn btn-outline w-full btn-lg relative overflow-hidden" disabled={remainingTimeDisplay !== ''}>
                                {#if remainingTimeDisplay}
                                    <div class="absolute inset-0 bg-gray-300 origin-left transition-all duration-1000 ease-linear" style="width: {cooldownProgress}%;"></div>
                                    <span class="relative z-10 font-bold">⏳ រង់ចាំ ({remainingTimeDisplay})</span>
                                {:else}
                                    <span class="relative z-10">🔄 ព្យាយាមម្តងទៀត</span>
                                {/if}
                            </button>
                        {/if}
                        <button on:click={() => dispatch('close')} class="btn {passed ? 'btn-primary' : 'btn-ghost'} w-full btn-lg">{passed ? '🏠 ត្រឡប់ទៅដើម' : '← ចាកចេញ'}</button>
                    </div>
                </div>
            {/if}
        </div>
    {:else}
        <div class="flex items-center justify-center h-full">
            <span class="loading loading-spinner loading-lg"></span>
        </div>
    {/if}
</div>
