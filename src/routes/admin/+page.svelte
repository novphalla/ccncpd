<!-- src/routes/admin/+page.svelte -->
<script>
    import { onMount, getContext } from 'svelte';
    import { goto } from '$app/navigation';
    import { createQuery } from '@tanstack/svelte-query';
    import AdminDashboard from '$lib/Components/admin/Admindashboard.svelte';

    const currentUser = getContext('currentUser');
    const supabase = getContext('supabase');

    let totalUsers = 0;
    let adminTab = 'dashboard';
    let loading = true;
    let showCertGen = false;
    let CertificateGeneratorComponent; // Lazy Load
    let verifiedUser = null; // ប្រើសម្រាប់រក្សាទុក User ដែលបានផ្ទៀងផ្ទាត់
    
    // System settings
    let loginBgUrl = '';
    let loginLogoUrl = '';
    let faviconUrl = '';
    const version = '1.0.0';

    onMount(async () => {
        // ពិនិត្យសិទ្ធិ Admin
        let userId = $currentUser?.id;
        verifiedUser = $currentUser;

        if (!userId) {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                goto('/');
                return;
            }
            userId = user.id;
            // ទាញយកព័ត៌មាន User បន្ថែមប្រសិនបើ Store នៅទទេ
            const { data: profile } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
            verifiedUser = profile;
        }
        
        const { data } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
        if (data?.role !== 'admin' && data?.role !== 'owner') {
            alert('គ្មានសិទ្ធិអនុញ្ញាត');
            goto('/');
            return;
        }

        // ទាញយកចំនួនអ្នកប្រើប្រាស់សរុប
        const { count } = await supabase.from('users').select('id', { count: 'exact', head: true });
        totalUsers = count || 0;

        await loadSystemSettings();
        loading = false;
    });

    async function loadSystemSettings() {
        const { data } = await supabase.from('app_settings').select('*').eq('id', 1).maybeSingle();
        if (data) {
            loginBgUrl = data.login_bg_url || '';
            loginLogoUrl = data.login_logo_url || '';
            faviconUrl = data.favicon_url || '';
        }
    }

    async function handleOpenCertGen() {
        showCertGen = true;
        if (!CertificateGeneratorComponent) {
            const module = await import('$lib/Components/admin/CertificateGenerator.svelte');
            CertificateGeneratorComponent = module.default;
        }
    }

    // ទាញយកវគ្គសិក្សាសម្រាប់ Admin
    $: coursesQuery = createQuery({
        queryKey: ['courses', 'admin'],
        queryFn: async () => {
            let query = supabase.from('courses')
                .select('id, title, description, thumbnail_url, cover_url, is_published, sort_order, created_at, deleted_at, cpd_points, cert_template_url, cert_config, quiz_questions, evaluation_form_id, department')
                .is('deleted_at', null)
                .order('sort_order', {ascending: true})
                .order('created_at', {ascending: false})
                .limit(500);
            const { data, error } = await query;
            if (error) throw error;
            return data || [];
        }
    });

    $: courses = $coursesQuery?.data || [];
</script>

{#if !loading && verifiedUser}
    <div class="min-h-screen bg-gray-50">
        {#if showCertGen}
            <div class="fixed inset-0 z-50 bg-white overflow-y-auto">
                {#if CertificateGeneratorComponent}
                    <svelte:component this={CertificateGeneratorComponent} onClose={() => showCertGen = false} />
                {:else}
                    <div class="flex items-center justify-center h-screen">
                        <span class="loading loading-spinner loading-lg text-primary"></span>
                    </div>
                {/if}
            </div>
        {:else}
            <AdminDashboard 
                {supabase} 
                currentUser={verifiedUser} 
                {courses} 
                {totalUsers}
                {loginBgUrl}
                {loginLogoUrl}
                {faviconUrl}
                {adminTab}
                {version}
                on:close={() => goto('/')}
                on:refresh={() => {
                    $coursesQuery.refetch();
                }}
                on:refreshSettings={loadSystemSettings}
                on:openCertGen={handleOpenCertGen} 
            />
        {/if}
    </div>
{:else}
    <div class="flex justify-center items-center h-screen">
        <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
{/if}
