<script>
    import { createEventDispatcher } from 'svelte';
    import { fade } from 'svelte/transition';

    export let user = null;

    const dispatch = createEventDispatcher();
</script>

{#if user}
    <div class="modal modal-open bg-black/60 z-[100]" transition:fade={{ duration: 200 }}>
        <div class="modal-box bg-white max-w-sm p-0 overflow-hidden rounded-2xl">
            <div class="bg-blue-50 p-6 text-center relative border-b border-blue-100">
                <button class="absolute top-4 right-4 btn btn-sm btn-circle btn-ghost" on:click={() => dispatch('close')}>✕</button>
                <div class="avatar mb-4">
                    <div class="w-24 h-24 rounded-full ring ring-primary ring-offset-base-100 ring-offset-2 shadow-lg bg-white">
                        {#if user.avatar_url}
                            <img src={user.avatar_url} alt="Profile" class="object-cover" />
                        {:else}
                            <div class="bg-gray-200 text-gray-700 w-full h-full flex items-center justify-center text-3xl font-bold">
                                {user.full_name ? user.full_name[0] : '?'}
                            </div>
                        {/if}
                    </div>
                </div>
                <h3 class="font-bold text-xl text-gray-900">{user.full_name}</h3>
                {#if user.name_latin}
                    <p class="text-sm font-medium text-gray-500 mt-1">{user.name_latin}</p>
                {/if}
                <div class="mt-2 inline-flex items-center gap-1 bg-white px-3 py-1 rounded-full shadow-sm text-primary font-mono font-bold text-sm border border-blue-100">
                    📞 {user.phone_number || 'គ្មានលេខទូរស័ព្ទ'}
                </div>
            </div>
            
            <div class="p-5 space-y-3">
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div class="bg-gray-50 p-3 rounded-xl border border-gray-100"><div class="text-gray-500 mb-1 text-xs font-bold">ភេទ</div><div class="font-bold text-gray-900">{user.gender === 'Male' ? 'ប្រុស' : user.gender === 'Female' ? 'ស្រី' : (user.gender || '-')}</div></div>
                    <div class="bg-gray-50 p-3 rounded-xl border border-gray-100"><div class="text-gray-500 mb-1 text-xs font-bold">រាជធានី/ខេត្ត</div><div class="font-bold text-gray-900">{user.profile_data?.province || '-'}</div></div>
                    <div class="bg-gray-50 p-3 rounded-xl border border-gray-100 col-span-2"><div class="text-gray-500 mb-1 text-xs font-bold">មុខតំណែង / កម្រិតជំនាញ</div><div class="font-bold text-gray-900">{user.profile_data?.position || '-'}</div></div>
                    <div class="bg-gray-50 p-3 rounded-xl border border-gray-100 col-span-2"><div class="text-gray-500 mb-1 text-xs font-bold">កន្លែងធ្វើការ</div><div class="font-bold text-gray-900">{user.profile_data?.workplace || '-'}</div></div>
                </div>

                <div class="bg-rose-50 p-4 rounded-xl border border-rose-100">
                    <div class="text-rose-700 mb-1 text-xs font-bold">អាជ្ញាប័ណ្ណ</div>
                    <div class="font-bold text-gray-900">
                        {user.profile_data?.license_status || '-'}
                        {#if user.profile_data?.license_number}<span class="text-primary font-mono ml-2 block mt-1">Lic: {user.profile_data.license_number}</span>{/if}
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}