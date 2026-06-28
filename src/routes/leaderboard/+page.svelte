<!-- src/routes/leaderboard/+page.svelte -->
<script>
    import { onMount, getContext } from 'svelte';
    import { goto } from '$app/navigation';
    import LeaderboardView from '$lib/Components/LeaderboardView.svelte';

    const currentUser = getContext('currentUser');
    const supabase = getContext('supabase');
    
    let leaderboard = [];
    let loading = true;

    onMount(async () => {
        if (!$currentUser) {
            goto('/');
            return;
        }
        await loadLeaderboard();
        loading = false;
    });

    async function loadLeaderboard() {
        try {
            // Aggregate XP server-side: sum scores per user, join name, top 20 only
            const { data, error } = await supabase
                .rpc('get_leaderboard_top20');

            if (error) {
                // Fallback: fetch only users with xp > 0, limited
                const { data: users } = await supabase
                    .from('users')
                    .select('id, full_name, avatar_url, xp')
                    .gt('xp', 0)
                    .order('xp', { ascending: false })
                    .limit(20);
                leaderboard = users || [];
            } else {
                leaderboard = data || [];
            }
        } catch (e) { console.error(e); }
    }
</script>

<div class="min-h-screen bg-gray-50 p-4">
    {#if loading}
        <div class="flex justify-center pt-10"><span class="loading loading-spinner loading-lg text-primary"></span></div>
    {:else}
        <LeaderboardView {leaderboard} currentUser={$currentUser} on:close={() => goto('/')} />
    {/if}
</div>
