<script>
    import { onMount } from 'svelte';
    import { fade, scale, fly } from 'svelte/transition';
    import { page } from '$app/stores';
    import { SendIcon } from 'lucide-svelte';
    import { supabase } from '$lib/supabaseClient';


    let loading = true;
    let valid = false;
    let message = '';
    let student = null;
    let course = null;
    let completionDate = null;
    let score = 0;

    onMount(async () => {
        const u = $page.url.searchParams.get('u'); // User ID
        const c = $page.url.searchParams.get('c'); // Course ID

        if (!u || !c) {
            loading = false;
            valid = false;
            message = 'តំណភ្ជាប់មិនត្រឹមត្រូវ (Missing parameters)';
            return;
        }

        try {
            // 1. ទាញយកព័ត៌មានសិស្ស
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select('full_name, name_latin, avatar_url')
                .eq('id', u)
                .single();

            if (userError || !userData) throw new Error('រកមិនឃើញសិស្ស');
            student = userData;

            // 2. ទាញយកព័ត៌មានវគ្គសិក្សា
            const { data: courseData, error: courseError } = await supabase
                .from('courses')
                .select('title, thumbnail_url')
                .eq('id', c)
                .single();

            if (courseError || !courseData) throw new Error('រកមិនឃើញវគ្គសិក្សា');
            course = courseData;

            // 3. ផ្ទៀងផ្ទាត់ការបញ្ចប់វគ្គសិក្សា (ពិនិត្យមើលថាតើបានប្រឡងជាប់ឬនៅ)
            const { data: result, error: resultError } = await supabase
                .from('student_quiz_results')
                .select('created_at, passed, score')
                .eq('user_id', u)
                .eq('course_id', c)
                .eq('passed', true)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (resultError || !result) {
                valid = false;
                message = 'សិស្សនេះមិនទាន់បានបញ្ចប់វគ្គសិក្សានេះទេ ឬមិនទាន់ប្រឡងជាប់។';
            } else {
                valid = true;
                completionDate = new Date(result.created_at).toLocaleDateString('km-KH');
                score = result.score;
                message = 'វិញ្ញាបនបត្រត្រឹមត្រូវ (Valid)';
            }

        } catch (e) {
            valid = false;
            message = e.message || 'មានបញ្ហាក្នុងការផ្ទៀងផ្ទាត់';
        } finally {
            loading = false;
        }
    });

    function shareToTelegram() {
        if (!valid || !course || !student) return;
        const shareUrl = window.location.href;
        const shareText = `បានផ្ទៀងផ្ទាត់ជោគជ័យ! ✅\n\nសិស្ស៖ ${student.full_name}\nវគ្គសិក្សា៖ ${course.title}\nពិន្ទុ៖ ${score}%\n\nពិនិត្យមើលនៅទីនេះ៖`;
        const telegramUrl = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
        window.open(telegramUrl, '_blank');
    }
</script>

<div class="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 font-sans">
    <div class="card w-full max-w-lg bg-white shadow-2xl rounded-xl overflow-hidden border-4 border-double border-primary/20 relative" in:scale={{ duration: 400, start: 0.95 }}>
        <!-- Decorative corners -->
        <div class="absolute top-0 left-0 w-16 h-16 border-t-4 border-l-4 border-primary rounded-tl-xl"></div>
        <div class="absolute top-0 right-0 w-16 h-16 border-t-4 border-r-4 border-primary rounded-tr-xl"></div>
        <div class="absolute bottom-0 left-0 w-16 h-16 border-b-4 border-l-4 border-primary rounded-bl-xl"></div>
        <div class="absolute bottom-0 right-0 w-16 h-16 border-b-4 border-r-4 border-primary rounded-br-xl"></div>

        {#if loading}
            <div class="p-10 text-center">
                <span class="loading loading-spinner loading-lg text-primary"></span>
                <p class="mt-4 text-gray-500">កំពុងផ្ទៀងផ្ទាត់...</p>
            </div>
        {:else}
            <div class="p-8 text-center relative z-10" in:fade={{ duration: 300, delay: 200 }}>
                <!-- Status Icon -->
                <div class="mb-4 flex justify-center">
                    <div class="w-20 h-20 {valid ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'} rounded-full flex items-center justify-center text-4xl shadow-sm border-4 border-white" in:scale={{ duration: 500, delay: 300, start: 0.5 }}>
                        {valid ? '✓' : '✕'}
                    </div>
                </div>

                <h2 class="text-2xl font-bold mb-1 {valid ? 'text-green-700' : 'text-red-600'}">
                    {valid ? 'វិញ្ញាបនបត្រត្រឹមត្រូវ' : 'មិនត្រឹមត្រូវ / រកមិនឃើញ'}
                </h2>
                <p class="text-xs text-gray-400 uppercase tracking-widest mb-6">Certificate Verification</p>

                {#if valid && student && course}
                    <div class="space-y-6" in:fly={{ y: 20, duration: 500, delay: 400 }}>
                        <!-- Student Info -->
                        <div>
                            <p class="text-sm text-gray-500 mb-1">បានបញ្ចប់ដោយជោគជ័យជូនចំពោះ</p>
                            <h3 class="text-xl font-bold text-gray-800">{student.full_name}</h3>
                            <p class="text-sm text-gray-500 font-serif italic">{student.name_latin}</p>
                        </div>

                        <!-- Course Info -->
                        <div class="bg-gray-50 p-4 rounded-xl border border-gray-100">
                            <p class="text-xs text-gray-500 mb-2 uppercase font-bold">វគ្គសិក្សា (Course)</p>
                            <h4 class="text-lg font-bold text-primary">{course.title}</h4>
                        </div>

                        <!-- Details Grid -->
                        <div class="grid grid-cols-2 gap-4">
                            <div class="bg-blue-50 p-3 rounded-lg border border-blue-100">
                                <p class="text-xs text-gray-500 mb-1">កាលបរិច្ឆេទ (Date)</p>
                                <p class="font-bold text-gray-800">{completionDate}</p>
                            </div>
                            <div class="bg-green-50 p-3 rounded-lg border border-green-100">
                                <p class="text-xs text-gray-500 mb-1">ពិន្ទុ (Score)</p>
                                <p class="font-bold text-green-700 text-lg">{score}%</p>
                            </div>
                        </div>
                    </div>
                {:else}
                    <p class="text-gray-500" in:fade={{ delay: 300 }}>{message}</p>
                {/if}
            </div>
            
            <div class="bg-gray-50 p-4 text-center border-t border-gray-100 relative z-10" in:fly={{ y: 20, duration: 500, delay: 500 }}>
                <p class="text-[10px] text-gray-400 mb-2">Verified by CCN-CPD System</p>
                <div class="flex justify-center gap-2">
                    <a href="/" class="btn btn-sm btn-outline btn-primary rounded-full px-6">ទៅកាន់ទំព័រដើម</a>
                    {#if valid}
                        <button on:click={shareToTelegram} class="btn btn-sm btn-info text-white rounded-full px-4 gap-2">
                            <SendIcon size={16} /> Telegram
                        </button>
                    {/if}
                </div>
            </div>
        {/if}
    </div>
</div>