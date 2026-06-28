<script>
  import "../app.css";
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import { page } from '$app/stores';
  import "@fontsource/siemreap";
  import { onMount } from 'svelte';

  onMount(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  });

  // @ts-ignore
  export let params = undefined; // SvelteKit router passes this during hydration
  $: void params;              // mark as used to silence unused-export warning
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5,       // 5 minutes — don't refetch if data is fresh
        refetchOnWindowFocus: false,     // don't refetch every time tab is focused
        refetchOnReconnect: false,       // don't refetch on network reconnect
        retry: 1,                        // only retry once on failure
      }
    }
  });
</script>

<svelte:head>
    <link rel="icon" href="/logo.png" />
    <link rel="icon" type="image/png" sizes="32x32" href="/logo.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/logo.png">
    <title>CCN-CPD</title>
    <!-- Google Fonts: Moul & Siemreap -->
    <link href="https://fonts.googleapis.com/css2?family=Moul&family=Siemreap&display=swap" rel="stylesheet">
</svelte:head>

<QueryClientProvider client={queryClient}>
  <div class="min-h-screen flex flex-col bg-base-100" data-theme="light">
    
    <!-- ================== ផ្នែកខាងលើ (Header) ================== -->
    <!-- bg-gradient-to-r គឺកូដបង្កើតពណ៌ខៀវដេញពីចាស់ទៅខ្ចី ដូចរូបរបស់បង -->
    <header class="bg-gradient-to-r from-[#0056b3] to-[#0099ff] text-white shadow-md">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center">
            
            <!-- រូប Logo (ត្រូវប្រាកដថាបងមានរូប ccn-logo.png ក្នុង folder static) -->
            <img 
                src="/ccn-logo.png" 
                alt="CCN Logo" 
                class="h-16 w-16 bg-white rounded-full p-1 shadow-sm"
                onerror="this.src='https://ui-avatars.com/api/?name=CCN&background=fff&color=0056b3'"
            />
            
            <!-- អក្សរចំណងជើង -->
            <div class="ml-4 flex flex-col flex-1">
                <h1 class="text-base sm:text-xl tracking-wide font-moul">
                    គណៈគិលានុបដ្ឋាកកម្ពុជា (គ.គិ.ក)
                </h1>
                <h2 class="text-sm sm:text-base text-blue-100 mt-1">
                    Cambodian Council of Nurses (C.C.N)
                </h2>
            </div>


            
        </div>
    </header>

    <!-- ================== ផ្នែកកណ្តាល (កន្លែងប្តូរទំព័រមេរៀន) ================== -->
    <!-- ពាក្យ <slot /> នេះសំខាន់ណាស់! វាជាកន្លែងដែលទំព័រផ្សេងៗនឹងលោតមកបង្ហាញនៅចន្លោះកណ្តាល -->
    <main class="flex-grow max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <slot /> 
    </main>

    <!-- ================== ផ្នែកខាងក្រោម (Footer Contact Bar) ================== -->
    <footer class="bg-white border-t border-gray-200 shadow-inner pb-12">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col sm:flex-row justify-between items-center text-[#0088ff] font-medium text-sm sm:text-base gap-2">
            
            <!-- ឈ្មោះក្រុមប្រឹក្សា -->
            <div class="flex items-center">
                <span>ក្រុមប្រឹក្សាគណៈគិលានុបដ្ឋាកភូមិភាគ១</span>
            </div>

            <!-- អ៊ីមែល និង លេខទូរស័ព្ទ (អាចចុចបាន) -->
            <div class="flex flex-col sm:flex-row gap-4 sm:gap-6">
                <!-- អ៊ីមែល -->
                <a href="mailto:ccnregional1@gmail.com" class="flex items-center hover:text-blue-800 transition">
                    <!-- Email Icon -->
                    <svg width="20" height="20" class="mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                    ccnregional1@gmail.com
                </a>

                <!-- ទូរស័ព្ទ -->
                <a href="tel:070767896" class="flex items-center hover:text-blue-800 transition">
                    <!-- Phone Icon -->
                    <svg width="20" height="20" class="mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"></path></svg>
                    070 767 896
                </a>
            </div>
            
        </div>
    </footer>

  </div>
</QueryClientProvider>