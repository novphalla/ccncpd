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
    let isCorrect = null;
    let answers = []; 
    let passed = false;
    let isSubmitted = false;
    
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

    // Helper: រកចម្លើយត្រឹមត្រូវ (Handle various data structures)
    $: currentCorrectAnswers = (() => {
        if (!currentQuestion) return [];
        if (Array.isArray(currentQuestion.answers)) return currentQuestion.answers.map(Number);
        if (currentQuestion.correct_answer !== undefined) {
             return Array.isArray(currentQuestion.correct_answer) ? currentQuestion.correct_answer.map(Number) : [Number(currentQuestion.correct_answer)];
        }
        if (currentQuestion.answer !== undefined) return [Number(currentQuestion.answer)];
        return [];
    })();

    function getOptionClasses(originalIndex) {
        const isSelected = selectedOption === originalIndex;
        const isCorrectAnswer = currentCorrectAnswers.includes(originalIndex);

        if (isSubmitted) {
            if (quizType === 'pre') {
                return isSelected ? 'btn-primary text-white border-primary' : 'bg-white border-gray-200 text-gray-400';
            }

            // Post-test logic
            if (isSelected) {
                return isCorrect ? 'btn-success text-black border-success' : 'btn-error text-black border-error';
            }
            if (isCorrectAnswer) {
                return 'btn-success text-black border-success';
            }
            return 'bg-white border-gray-200 text-gray-700';
        } 
        // Before submission
        return isSelected
            ? 'bg-primary text-white border-primary shadow-lg shadow-primary/40 scale-[1.02] ring-4 ring-primary/20'
            : 'bg-white border-gray-200 hover:border-primary/50 hover:bg-blue-50/30 text-gray-700 hover:shadow-md hover:scale-[1.01]';
    }

    function selectOption(index) {
        if (isSubmitted) return;
        selectedOption = index;
    }

    function handleNext() {
        if (!isSubmitted) {
            isCorrect = currentCorrectAnswers.includes(selectedOption);
            answers[currentQuestionIndex] = selectedOption;

            if (isCorrect) {
                score++;
                // Note: XP is now awarded in bulk at the end of the quiz to reduce database requests
            }
            isSubmitted = true;
        } else {
            nextQuestion();
        }
    }

    function nextQuestion() {
        if (currentQuestionIndex < questions.length - 1) {
            currentQuestionIndex++;
            selectedOption = null;
            isCorrect = null;
            isSubmitted = false;
        } else {
            finishQuiz();
        }
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
        showResult = true;
        const percentage = Math.round((score / questions.length) * 100);
        
        // Pre-test: ជាប់ជានិច្ច (Completion only)
        if (quizType === 'pre') {
            passed = true;
        } else {
            passed = percentage >= passingScore; // ពិនិត្យថាតើពិន្ទុគ្រប់គ្រាន់ឬនៅ?
        }

        if (currentUser) {
            // Random delay between 0 and 2000ms to prevent thundering herd when many users submit at the exact same time
            const jitterMs = Math.floor(Math.random() * 2000);
            await new Promise(resolve => setTimeout(resolve, jitterMs));

            const totalXpToAward = (score * 10) + (passed ? 50 : 0);
            const { error } = await supabase.rpc('submit_quiz_and_update_xp', {
                p_course_id: courseId,
                p_score: percentage,
                p_passed: passed,
                p_answers: answers,
                p_total_questions: questions.length,
                p_correct_count: score,
                p_percentage: percentage,
                p_type: quizType,
                p_question_ids: questions.map(q => q.id),
                p_xp_amount: totalXpToAward
            });
            
            if (error) {
                console.error("Error saving quiz result:", error);
                alert("បរាជ័យក្នុងការរក្សាទុកលទ្ធផលតេស្ត: " + error.message);
            } else {
                // Update local XP without hitting the DB again
                currentUser.xp = (currentUser.xp || 0) + totalXpToAward;
            }
        }

        if (passed) {
            dispatch('complete');
            triggerConfetti();
        } else {
            // បើធ្លាក់ ចាប់ផ្តើមរាប់ថយក្រោយ
            startCooldownTimer();
        }
    }
</script>

<div class="fixed inset-0 bg-gray-50 z-50 flex flex-col overflow-hidden">
    {#if currentQuestion}
        <!-- Header -->
        <div class="bg-white p-4 shadow-sm flex justify-between items-center z-20">
            <div class="flex items-center gap-2">
                <button on:click={() => dispatch('close')} class="btn btn-sm btn-circle btn-ghost">✕</button>
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
                                disabled={isSubmitted}
                                on:click={() => selectOption(option.originalIndex)}
                                class="btn h-auto py-4 px-6 justify-between text-left normal-case text-base border-2 rounded-2xl transition-all duration-300 {getOptionClasses(option.originalIndex)}"
                            >
                                <span class="font-medium">{option.text}</span>
                                {#if isSubmitted && quizType !== 'pre'}
                                    {#if selectedOption === option.originalIndex}
                                        <span class="text-xl">{isCorrect ? '✅' : '❌'}</span>
                                    {:else if currentCorrectAnswers.includes(option.originalIndex)}
                                        <span class="text-xl">✅</span>
                                    {/if}
                                {/if}
                            </button>
                        {/each}
                    </div>

                    {#if selectedOption !== null}
                        <div class="mt-6 flex justify-end" in:fade>
                            <button on:click={handleNext} class="btn btn-primary btn-lg rounded-full shadow-lg shadow-primary/40 px-8">
                                {#if !isSubmitted}
                                    {quizType === 'pre' ? 'បញ្ជូនចម្លើយ' : 'ពិនិត្យចម្លើយ'}
                                {:else}
                                    {currentQuestionIndex === questions.length - 1 ? 'បញ្ចប់' : 'បន្ទាប់ →'}
                                {/if}
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
                            <div class="stat-value text-amber-500 text-3xl">+{passed ? score * 10 + 50 : score * 10}</div>
                            <div class="stat-desc">ពិន្ទុបទពិសោធន៍</div>
                        </div>
                    </div>

                    <div class="flex flex-col gap-3">
                        {#if !passed}
                            <button on:click={() => dispatch('review', { answers })} class="btn btn-warning w-full btn-lg text-white shadow-md">📝 មើលចម្លើយដែលខុស</button>
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
