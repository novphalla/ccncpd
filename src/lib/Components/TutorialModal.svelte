<script>
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';

    export let show = false;
    export let tutorials = [];

    const dispatch = createEventDispatcher();
    let selectedTutorialIndex = 0;

    // ត្រឡប់ទៅការណែនាំទី ១ វិញរាល់ពេលបើក Modal ម្តងៗ
    $: if (show) {
        selectedTutorialIndex = 0;
    }

    function isImage(url) {
        return /\.(jpg|jpeg|png|webp|avif|gif|svg)(\?.*)?$/i.test(url);
    }

    function isPdf(url) {
        return /\.pdf(\?.*)?$/i.test(url);
    }

    function getEmbedUrl(url) {
        if (!url) return '';
        const youtubeRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
        const match = url.match(youtubeRegex);
        if (match && match[1]) {
            return `https://www.youtube.com/embed/${match[1]}`;
        }
        const driveRegex = /drive\.google\.com\/file\/d\/([^\/?]+)/;
        const driveMatch = url.match(driveRegex);
        if (driveMatch && driveMatch[1]) {
            return `https://drive.google.com/file/d/${driveMatch[1]}/preview`;
        }
        return url;
    }
</script>

{#if show && tutorials.length > 0}
    {@const currentTut = tutorials[selectedTutorialIndex] || {}}
    <div class="modal modal-open bg-black/60 z-[100]" transition:fade={{ duration: 200 }}>
        <div class="modal-box w-11/12 max-w-5xl bg-white p-0 relative overflow-hidden flex flex-col md:flex-row min-h-[60vh] max-h-[90vh]">
            
            <!-- Sidebar Tabs -->
            {#if tutorials.length > 1}
                <div class="w-full md:w-64 bg-gray-50 border-r border-gray-200 flex flex-row md:flex-col overflow-x-auto shrink-0 md:overflow-y-auto">
                    <div class="p-4 font-bold text-gray-700 border-b hidden md:block">បញ្ជីការណែនាំ</div>
                    <ul class="menu menu-horizontal md:menu-vertical w-full gap-1 p-2">
                        {#each tutorials as tut, i}
                            <li>
                                <button class="{selectedTutorialIndex === i ? 'active bg-primary text-white font-bold' : 'text-gray-600'}" on:click={() => selectedTutorialIndex = i}>{tut.title || `ការណែនាំទី ${i+1}`}</button>
                            </li>
                        {/each}
                    </ul>
                </div>
            {/if}

            <!-- Content Area -->
            <div class="flex-1 flex flex-col overflow-hidden">
                <div class="flex justify-between items-center p-4 border-b shrink-0">
                    <h3 class="font-bold text-lg text-gray-800">{currentTut.title || '💡 របៀបប្រើប្រាស់'}</h3>
                    <button class="btn btn-sm btn-circle btn-ghost" on:click={() => { show = false; dispatch('close'); }}>✕</button>
                </div>
                <div class="p-4 flex flex-1 justify-center bg-base-200 overflow-y-auto">
                    {#if isImage(currentTut.url)}
                        <img src={currentTut.url} alt="Tutorial" class="max-w-full object-contain rounded shadow-sm m-auto" />
                    {:else if isPdf(currentTut.url)}
                        <div class="w-full flex flex-col h-full"><div class="w-full flex justify-end mb-2 pr-1 shrink-0"><a href={currentTut.url} target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline btn-primary text-xs bg-white">⬇️ បើកអានពេញអេក្រង់ (Open Full)</a></div><iframe src={currentTut.url} class="w-full h-[65vh] rounded shadow-sm bg-white flex-1" allowfullscreen title="Tutorial PDF"></iframe></div>
                    {:else if getEmbedUrl(currentTut.url) !== currentTut.url}
                        <iframe src={getEmbedUrl(currentTut.url)} class="w-full aspect-video rounded shadow-sm m-auto" allowfullscreen title="Tutorial Video"></iframe>
                    {:else}
                        <div class="text-center py-10 m-auto"><p class="mb-4 text-gray-600">ឯកសារណែនាំត្រូវបានភ្ជាប់នៅខាងក្រៅ។</p><a href={currentTut.url} target="_blank" rel="noopener noreferrer" class="btn btn-primary text-white">ចុចទីនេះដើម្បីបើកមើលបន្ត</a></div>
                    {/if}
                </div>
            </div>
        </div>
    </div>
{/if}