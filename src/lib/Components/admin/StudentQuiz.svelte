<script>
    import { onMount } from 'svelte';
    import { fade } from 'svelte/transition';
    
    export let supabase;
    export let courseId;
    export let currentUser;
    export let onBack; // Function សម្រាប់ត្រឡប់ក្រោយ

    let loading = true;
    let questions = [];
    let course = null;
    let userAnswers = {}; // { questionId: selectedOptionIndex }
    let submitted = false;
    let result = null;
    let submitting = false;
    let currentQuestionIndex = 0;

    onMount(async () => {
        await loadQuizData();
    });

    async function loadQuizData() {
        loading = true;
        // ទាញយកព័ត៌មានវគ្គសិក្សា (ដើម្បីយកពិន្ទុជាប់)
        const { data: courseData } = await supabase
            .from('courses')
            .select('title, quiz_passing_score')
            .eq('id', courseId)
            .single();
        
        course = courseData;

        // ទាញយកសំណួរ
        const { data: questionData, error } = await supabase
            .from('quiz_questions')
            .select('*') 
            .eq('course_id', courseId)
            .order('sort_order', { ascending: true });

        if (error) {
            console.error("Error loading questions:", error);
        } else {
            let rawQuestions = JSON.parse(JSON.stringify(questionData || [])); // Clone data to avoid reference issues

            // Shuffle questions (Randomize order)
            for (let i = rawQuestions.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [rawQuestions[i], rawQuestions[j]] = [rawQuestions[j], rawQuestions[i]];
            }

            questions = rawQuestions.map(q => {
                // Create options with original index to preserve correct answer mapping
                const optionsWithIndex = q.options.map((opt, i) => ({ text: opt, originalIndex: i }));
                // Shuffle options
                for (let i = optionsWithIndex.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [optionsWithIndex[i], optionsWithIndex[j]] = [optionsWithIndex[j], optionsWithIndex[i]];
                }
                return { ...q, shuffledOptions: optionsWithIndex };
            });
        }
        loading = false;
    }

    function selectAnswer(qId, index) {
        if (submitted) return;
        // អនុញ្ញាតឱ្យដកចម្លើយវិញ (Deselect) បើចុចលើជម្រើសដដែល
        if (userAnswers[qId] === index) {
            delete userAnswers[qId];
        } else {
            userAnswers[qId] = index;
            // លោតទៅសំណួរបន្ទាប់ដោយស្វ័យប្រវត្តិ (Auto Advance)
            setTimeout(() => {
                nextQuestion();
            }, 1000);
        }
        userAnswers = userAnswers; // Trigger reactivity (ឱ្យ UI ដឹងថាមានការផ្លាស់ប្តូរ)
    }

    function nextQuestion() {
        if (currentQuestionIndex < questions.length - 1) {
            currentQuestionIndex++;
        }
    }

    function prevQuestion() {
        if (currentQuestionIndex > 0) {
            currentQuestionIndex--;
        }
    }

    async function submitQuiz() {
        if (!confirm("តើអ្នកចង់បញ្ជូនចម្លើយមែនទេ?")) return;
        
        submitting = true;
        let correctCount = 0;
        
        questions.forEach(q => {
            if (userAnswers[q.id] === q.correct_answer) {
                correctCount++;
            }
        });

        const score = Math.round((correctCount / questions.length) * 100);
        const passingScore = course?.quiz_passing_score || 70;
        const passed = score >= passingScore;

        const resultData = {
            user_id: currentUser.id,
            course_id: courseId,
            score: score,
            correct_count: correctCount,
            total_questions: questions.length,
            passed: passed,
            answers: userAnswers
        };

        const { error } = await supabase.from('student_quiz_results').insert(resultData);

        if (error) {
            alert("Error submitting quiz: " + error.message);
        } else {
            result = resultData;
            submitted = true;
        }
        submitting = false;
    }

    async function retry() {
        userAnswers = {};
        submitted = false;
        result = null;
        currentQuestionIndex = 0;
        await loadQuizData(); // Reload and reshuffle questions/answers
    }
</script>

<div class="max-w-3xl mx-auto p-4">
    {#if loading}
        <div class="flex justify-center py-10"><span class="loading loading-spinner loading-lg"></span></div>
    {:else if questions.length === 0}
        <div class="text-center py-10">
            <h3 class="text-xl font-bold text-gray-500">មិនទាន់មានសំណួរសម្រាប់វគ្គនេះទេ</h3>
            <button class="btn btn-primary mt-4" on:click={onBack}>ត្រឡប់ក្រោយ</button>
        </div>
    {:else if !submitted}
        <div class="mb-6">
            <button class="btn btn-sm btn-ghost mb-2" on:click={onBack}>← ត្រឡប់ក្រោយ</button>
            <h2 class="text-2xl font-bold text-primary">{course?.title} - តេស្តសមត្ថភាព</h2>
            <div class="flex justify-between items-center mt-2">
                <span class="text-sm text-gray-500">សំណួរទី {currentQuestionIndex + 1} នៃ {questions.length}</span>
                <span class="text-sm text-gray-500">ពិន្ទុជាប់: <span class="font-bold">{course?.quiz_passing_score || 70}%</span></span>
            </div>
            <progress class="progress progress-primary w-full mt-2" value={currentQuestionIndex + 1} max={questions.length}></progress>
        </div>

        <div class="space-y-6">
            {#if questions.length > 0}
                {@const q = questions[currentQuestionIndex]}
                {#key q.id}
                <div class="card bg-base-100 shadow-sm border border-gray-200" in:fade={{ duration: 200 }}>
                    <div class="card-body">
                        <h3 class="font-bold text-lg mb-4">{currentQuestionIndex + 1}. {q.question}</h3>
                        <div class="flex flex-col gap-3">
                            {#each q.shuffledOptions as opt (opt.originalIndex)}
                                {@const selectedIdx = userAnswers[q.id]}
                                {@const isSelected = selectedIdx === opt.originalIndex}
                                {@const isCorrect = opt.originalIndex === q.correct_answer}
                                {@const showResult = selectedIdx !== undefined}

                                <label class="relative flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 select-none group
                                    {showResult 
                                        ? (isCorrect ? 'border-green-500 bg-green-50' : (isSelected ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-white opacity-50'))
                                        : 'border-gray-200 bg-white hover:border-primary/50 hover:bg-gray-50'}"
                                >
                                    <input type="radio" name={`q_${q.id}`} class="radio" 
                                        class:radio-primary={!showResult}
                                        class:radio-success={showResult && isCorrect}
                                        class:radio-error={showResult && isSelected && !isCorrect}
                                        checked={isSelected} 
                                        on:click={() => selectAnswer(q.id, opt.originalIndex)}
                                        disabled={showResult && !isSelected} 
                                    />
                                    <span class="text-base flex-1 {showResult ? (isCorrect ? 'font-bold text-green-800' : (isSelected ? 'font-bold text-red-800' : 'text-gray-500')) : (isSelected ? 'font-bold text-primary' : 'font-medium text-gray-700')}">{opt.text}</span>
                                    {#if showResult && isCorrect}
                                        <span class="badge badge-success text-white">✓ ត្រូវ</span>
                                    {:else if showResult && isSelected && !isCorrect}
                                        <span class="badge badge-error text-white">✕ ខុស</span>
                                    {/if}
                                </label>
                            {/each}
                        </div>
                    </div>
                </div>
                {/key}
            {/if}
        </div>

        <div class="mt-8 flex justify-between items-center">
            <button class="btn" disabled={currentQuestionIndex === 0} on:click={prevQuestion}>
                ← ថយក្រោយ
            </button>
            
            <div class="text-sm text-gray-500">
                បានឆ្លើយ {Object.keys(userAnswers).length}/{questions.length}
            </div>

            {#if currentQuestionIndex === questions.length - 1}
                <button class="btn btn-primary" on:click={submitQuiz} disabled={submitting || Object.keys(userAnswers).length < questions.length}>
                    {#if submitting}<span class="loading loading-spinner"></span>{/if}
                    បញ្ជូនចម្លើយ
                </button>
            {:else}
                <button class="btn" on:click={nextQuestion}>
                    បន្ទាប់ →
                </button>
            {/if}
        </div>
    {:else}
        <!-- Result View -->
        <div class="card bg-base-100 shadow-xl border border-gray-200 text-center py-10" in:fade>
            <div class="card-body items-center">
                <div class="text-6xl mb-4">{result.passed ? '🎉' : '😢'}</div>
                <h2 class="text-3xl font-bold mb-2 {result.passed ? 'text-success' : 'text-error'}">
                    {result.passed ? 'អបអរសាទរ! អ្នកប្រឡងជាប់' : 'សូមចូលរួមសោកស្តាយ! អ្នកប្រឡងធ្លាក់'}
                </h2>
                <p class="text-gray-500 text-lg">ពិន្ទុរបស់អ្នក: <span class="font-bold text-2xl">{result.score}%</span></p>
                <p class="text-gray-500">ឆ្លើយត្រូវ: {result.correct_count} នៃ {result.total_questions} សំណួរ</p>

                <div class="flex gap-4 mt-6">
                    {#if result.passed}
                        <button class="btn btn-primary" on:click={() => window.open(`/certificate/${courseId}`, '_blank')}>
                            🎓 ទាញយកសញ្ញាបត្រ
                        </button>
                    {:else}
                        <button class="btn btn-outline" on:click={retry}>🔄 ប្រឡងម្តងទៀត</button>
                    {/if}
                    <button class="btn btn-ghost" on:click={onBack}>ត្រឡប់ទៅមេរៀន</button>
                </div>
            </div>
        </div>
        
        <!-- Review Answers (Optional) -->
        <div class="mt-8">
            <h3 class="text-xl font-bold mb-4">ត្រួតពិនិត្យចម្លើយ</h3>
            <div class="space-y-4">
                {#each questions as q, index (q.id)}
                    <div class="collapse collapse-arrow bg-base-100 border border-gray-200">
                        <input type="checkbox" /> 
                        <div class="collapse-title text-lg font-medium flex gap-2">
                            <span>{index + 1}. {q.question}</span>
                            {#if userAnswers[q.id] === q.correct_answer}
                                <span class="text-success">✓</span>
                            {:else}
                                <span class="text-error">✕</span>
                            {/if}
                        </div>
                        <div class="collapse-content"> 
                            <div class="flex flex-col gap-3 mt-2">
                                {#each q.shuffledOptions as opt (opt.originalIndex)}
                                    <div class="p-3 rounded-xl border-2 flex items-center gap-3
                                        {opt.originalIndex === q.correct_answer 
                                            ? 'bg-green-50 border-green-500 text-green-800' 
                                            : (userAnswers[q.id] === opt.originalIndex ? 'bg-red-50 border-red-500 text-red-800' : 'border-gray-200 bg-white text-gray-500')}
                                    ">
                                        <span class="font-medium flex-1">{opt.text}</span>
                                        {#if opt.originalIndex === q.correct_answer} <span class="badge badge-success text-white">ចម្លើយត្រឹមត្រូវ</span> {/if}
                                        {#if userAnswers[q.id] === opt.originalIndex && opt.originalIndex !== q.correct_answer} <span class="badge badge-error text-white">ចម្លើយរបស់អ្នក</span> {/if}
                                    </div>
                                {/each}
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>