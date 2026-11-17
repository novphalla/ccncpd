<script>
    import { onMount } from 'svelte';

    let reports = [];
    let reportKind = 'comment';
    let status = 'pending';
    let loading = true;
    let busyId = null;
    let errorMessage = '';

    const statuses = [
        { value: 'pending', label: 'កំពុងរង់ចាំ' },
        { value: 'reviewed', label: 'បានដោះស្រាយ' },
        { value: 'dismissed', label: 'បានបដិសេធ' },
        { value: 'all', label: 'ទាំងអស់' }
    ];

    const reasonLabels = {
        spam: 'Spam',
        harassment: 'ការរំខាន/ប្រមាថ',
        privacy: 'បញ្ហាឯកជនភាព',
        inappropriate: 'ខ្លឹមសារមិនសមរម្យ',
        misinformation: 'ព័ត៌មានមិនត្រឹមត្រូវ',
        other: 'ផ្សេងៗ'
    };

    onMount(loadReports);

    function displayName(user) {
        return user?.full_name || user?.name_latin || 'មិនស្គាល់ឈ្មោះ';
    }

    function formatDate(value) {
        if (!value) return '—';
        return new Intl.DateTimeFormat('km-KH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    }

    async function loadReports() {
        loading = true;
        errorMessage = '';
        try {
            const endpoint = reportKind === 'chat' ? '/api/admin/private-chat-reports' : '/api/admin/lesson-comment-reports';
            const response = await fetch(`${endpoint}?status=${encodeURIComponent(status)}`, {
                credentials: 'same-origin',
                cache: 'no-store'
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចទាញយក report បានទេ។');
            reports = payload.reports || [];
        } catch (error) {
            errorMessage = error.message || 'មិនអាចទាញយក report បានទេ។';
        } finally {
            loading = false;
        }
    }

    async function changeStatus(nextStatus) {
        if (status === nextStatus) return;
        status = nextStatus;
        await loadReports();
    }

    async function changeKind(nextKind) {
        if (reportKind === nextKind) return;
        reportKind = nextKind;
        status = 'pending';
        await loadReports();
    }

    async function moderate(report, action) {
        if (busyId) return;
        const labels = { dismiss: 'បដិសេធ report នេះ', hide: 'លាក់ comment នេះ', delete: 'លុប comment នេះ', resolve: 'កំណត់ថាបានដោះស្រាយ', block: 'Block អ្នកដែលត្រូវបាន report' };
        if (!confirm(`តើអ្នកពិតជាចង់${labels[action]}មែនទេ?`)) return;

        busyId = report.id;
        errorMessage = '';
        try {
            const endpoint = reportKind === 'chat' ? '/api/admin/private-chat-reports' : '/api/admin/lesson-comment-reports';
            const response = await fetch(endpoint, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ report_id: report.id, action })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(payload.error || 'មិនអាចដោះស្រាយ report បានទេ។');
            reports = reportKind === 'chat'
                ? reports.filter(item => item.id !== report.id)
                : action === 'dismiss'
                    ? reports.filter(item => item.id !== report.id)
                    : reports.filter(item => item.comment_id !== report.comment_id);
        } catch (error) {
            errorMessage = error.message || 'មិនអាចដោះស្រាយ report បានទេ។';
        } finally {
            busyId = null;
        }
    }
</script>

<section class="space-y-4">
    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
                <h2 class="text-xl font-black text-slate-900">ការគ្រប់គ្រង Comment និង Private Chat</h2>
                <p class="mt-1 text-sm text-slate-500">ពិនិត្យ report របស់សមាជិក និងដោះស្រាយបញ្ហាសុវត្ថិភាព។</p>
            </div>
            <button class="btn btn-sm border-slate-200 bg-white text-slate-700 hover:bg-slate-50" on:click={loadReports}>↻ ផ្ទុកឡើងវិញ</button>
        </div>

        <div class="mt-4 flex flex-wrap gap-2 border-b border-slate-200 pb-4">
            <button class="rounded-xl px-4 py-2 text-sm font-black {reportKind === 'comment' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}" on:click={() => changeKind('comment')}>💬 Comment Reports</button>
            <button class="rounded-xl px-4 py-2 text-sm font-black {reportKind === 'chat' ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-600'}" on:click={() => changeKind('chat')}>🔒 Private Chat Reports</button>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
            {#each statuses as item}
                <button
                    class="rounded-full border px-4 py-2 text-xs font-bold transition {status === item.value ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-teal-300'}"
                    on:click={() => changeStatus(item.value)}
                >
                    {item.label}
                </button>
            {/each}
        </div>
    </div>

    {#if errorMessage}
        <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{errorMessage}</div>
    {/if}

    {#if loading}
        <div class="flex h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white"><span class="loading loading-spinner loading-lg text-teal-600"></span></div>
    {:else if reports.length === 0}
        <div class="flex h-56 flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white text-center text-slate-500">
            <div class="text-4xl">✅</div>
            <div class="mt-3 font-black">មិនមាន report ក្នុងបញ្ជីនេះទេ</div>
        </div>
    {:else}
        <div class="grid gap-4 xl:grid-cols-2">
            {#each reports as report (report.id)}
                <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <span class="inline-flex rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-700">⚑ {reasonLabels[report.reason] || report.reason}</span>
                            <p class="mt-2 text-xs text-slate-500">Report ដោយ <strong>{displayName(report.reporter)}</strong> · {formatDate(report.created_at)}</p>
                        </div>
                        <span class="rounded-full px-3 py-1 text-[11px] font-bold {report.status === 'pending' ? 'bg-amber-100 text-amber-700' : report.status === 'reviewed' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}">{report.status}</span>
                    </div>

                    {#if report.details}
                        <div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{report.details}</div>
                    {/if}

                    {#if reportKind === 'chat'}
                        <div class="mt-4 rounded-xl border border-red-100 bg-red-50/60 p-4">
                            <div class="text-xs text-slate-500">សមាជិកដែលត្រូវបាន Report</div>
                            <strong class="mt-1 block text-slate-900">{displayName(report.reported_user)}</strong>
                            {#if report.message}
                                <div class="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                                    <div class="text-[10px] font-bold text-slate-400">សារដែលបាន Report · {formatDate(report.message.created_at)}</div>
                                    <p class="mt-1 whitespace-pre-wrap text-sm text-slate-700">{report.message.body}</p>
                                </div>
                            {:else}
                                <p class="mt-3 text-xs text-slate-500">Report លើការសន្ទនាទាំងមូល (មិនបានជ្រើសសារជាក់លាក់)។</p>
                            {/if}
                        </div>
                    {:else}
                        <div class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                            <div class="flex items-center justify-between gap-3 text-xs">
                                <strong class="text-slate-800">{displayName(report.comment?.author)}</strong>
                                <span class="text-slate-400">{formatDate(report.comment?.created_at)}</span>
                            </div>
                            <p class="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                                {report.comment?.body || (report.comment?.status === 'deleted' ? '[Comment ត្រូវបានលុប]' : '[មិនមានខ្លឹមសារ]')}
                            </p>
                            <div class="mt-3 border-t border-slate-200 pt-3 text-xs font-semibold text-teal-700">
                                {report.comment?.course?.title || 'វគ្គសិក្សា'} · {report.comment?.lesson?.title || 'មេរៀន'}
                            </div>
                        </div>
                    {/if}

                    {#if report.status === 'pending'}
                        <div class="mt-4 grid grid-cols-3 gap-2">
                            <button class="btn btn-sm border-slate-300 bg-white text-slate-700 hover:bg-slate-100" on:click={() => moderate(report, 'dismiss')} disabled={busyId === report.id}>បដិសេធ</button>
                            {#if reportKind === 'chat'}
                                <button class="btn btn-sm border-emerald-600 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" on:click={() => moderate(report, 'resolve')} disabled={busyId === report.id}>ដោះស្រាយ</button>
                                <button class="btn btn-sm border-red-600 bg-red-600 text-white hover:bg-red-700" on:click={() => moderate(report, 'block')} disabled={busyId === report.id}>Block</button>
                            {:else}
                                <button class="btn btn-sm border-amber-500 bg-amber-50 text-amber-800 hover:bg-amber-100" on:click={() => moderate(report, 'hide')} disabled={busyId === report.id}>លាក់</button>
                                <button class="btn btn-sm border-red-600 bg-red-600 text-white hover:bg-red-700" on:click={() => moderate(report, 'delete')} disabled={busyId === report.id}>លុប</button>
                            {/if}
                        </div>
                    {:else if report.reviewer}
                        <p class="mt-4 text-xs text-slate-500">ពិនិត្យដោយ {displayName(report.reviewer)} · {formatDate(report.reviewed_at)}</p>
                    {/if}
                </article>
            {/each}
        </div>
    {/if}
</section>
