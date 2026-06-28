<script>
    import { createEventDispatcher } from 'svelte';
    export let leaderboard = [];
    export let currentUser;

    const dispatch = createEventDispatcher();
</script>

<div class="screen p-4 max-w-md mx-auto min-h-screen bg-white">
    <div class="flex justify-between items-center mb-6">
        <h2 class="text-2xl font-bold text-yellow-600">🏆 សិស្សឆ្នើម</h2>
        <button on:click={() => dispatch('close')} class="btn btn-sm btn-circle btn-ghost">✕</button>
    </div>
    
    <div class="flex flex-col gap-3">
        {#each leaderboard as user, i}
            <div class="flex items-center bg-white p-3 rounded-xl shadow-sm border border-gray-200">
                <div class="font-bold text-xl w-8 text-center mr-2 
                    {i === 0 ? 'text-yellow-500' : i === 1 ? 'text-gray-400' : i === 2 ? 'text-orange-500' : 'text-gray-400 opacity-50'}">
                    #{i + 1}
                </div>
                <div class="avatar placeholder mr-3">
                    <div class="bg-gray-200 text-gray-700 rounded-full w-10 flex items-center justify-center overflow-hidden">
                        {#if user.avatar_url}
                            <img src={user.avatar_url} alt="Avatar" />
                        {:else}
                            <span class="text-sm font-bold">{user.full_name[0]}</span>
                        {/if}
                    </div>
                </div>
                <div class="flex-1">
                    <div class="font-bold {user.id === currentUser.id ? 'text-primary' : ''}">
                        {user.full_name} {user.id === currentUser.id ? '(អ្នក)' : ''}
                    </div>
                </div>
                <div class="font-bold text-yellow-600">{user.xp} XP</div>
            </div>
        {/each}
        {#if leaderboard.length === 0}
            <div class="text-center opacity-50 mt-10">មិនទាន់មានទិន្នន័យទេ</div>
        {/if}
    </div>
</div>