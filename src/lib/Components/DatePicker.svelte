<script>
  import { DateFormatter, parseDate, getLocalTimeZone } from "@internationalized/date";
  import { Calendar, Popover } from "bits-ui";
  import { cn } from "$lib/utils";
  import { Calendar as CalendarIcon } from "lucide-svelte";

  export let value = null; // ទទួលតម្លៃជា String (YYYY-MM-DD)
  export let placeholder = "ជ្រើសរើសកាលបរិច្ឆេទ";

  let dateValue = undefined;
  const df = new DateFormatter("km-KH", { dateStyle: "medium" });

  // ធ្វើសមកាលកម្ម (Sync) រវាង String និង Date Object
  $: if (value) {
    try {
      dateValue = parseDate(value);
    } catch (e) {
      // បើ value មិនត្រឹមត្រូវ
    }
  } else {
    dateValue = undefined;
  }

  function handleDateChange(v) {
    dateValue = v;
    if (v) {
      value = v.toString(); // បម្លែងទៅជា YYYY-MM-DD វិញ
    } else {
      value = null;
    }
  }
</script>

<Popover.Root>
  <Popover.Trigger
    class={cn(
      "flex h-10 w-full items-center justify-start rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      !value && "text-gray-500"
    )}
  >
    <CalendarIcon class="mr-2 h-4 w-4 opacity-50" />
    {#if value && dateValue}
      {df.format(dateValue.toDate(getLocalTimeZone()))}
    {:else}
      {placeholder}
    {/if}
  </Popover.Trigger>
  <Popover.Content class="w-auto p-0 z-[9999]" sideOffset={4}>
    <div class="rounded-md border border-border bg-shad-popover p-3 text-shad-popover-foreground shadow-md outline-none">
      <Calendar.Root
        bind:value={dateValue}
        onValueChange={handleDateChange}
        class="p-0"
        let:months
        let:weekdays
      >
        <Calendar.Header class="flex items-center justify-between pt-1 relative pb-4">
          <Calendar.PrevButton class="inline-flex items-center justify-center rounded-md bg-transparent p-2 opacity-50 hover:opacity-100 border border-border hover:bg-shad-accent hover:text-shad-accent-foreground">
            <span class="text-xl font-bold">‹</span>
          </Calendar.PrevButton>
          <Calendar.Heading class="text-sm font-medium" />
          <Calendar.NextButton class="inline-flex items-center justify-center rounded-md bg-transparent p-2 opacity-50 hover:opacity-100 border border-border hover:bg-shad-accent hover:text-shad-accent-foreground">
            <span class="text-xl font-bold">›</span>
          </Calendar.NextButton>
        </Calendar.Header>
        
        <div class="flex flex-col space-y-4 sm:flex-row sm:space-x-4 sm:space-y-0">
          {#each months as month}
            <div class="space-y-4">
              <Calendar.Grid class="w-full border-collapse space-y-1">
                <Calendar.GridHead>
                  <Calendar.GridRow class="flex">
                    {#each weekdays as weekday}
                      <Calendar.HeadCell class="w-9 rounded-md text-[0.8rem] font-normal text-gray-500">
                        {weekday.slice(0, 2)}
                      </Calendar.HeadCell>
                    {/each}
                  </Calendar.GridRow>
                </Calendar.GridHead>
                <Calendar.GridBody>
                  {#each month.weeks as week}
                    <Calendar.GridRow class="flex w-full mt-2">
                      {#each week.dates as date}
                        <Calendar.Cell
                          {date}
                          class="relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([data-selected])]:bg-shad-accent"
                        >
                          <Calendar.Day
                            {date}
                            month={month.value}
                            class={cn(
                              "inline-flex h-9 w-9 items-center justify-center rounded-md p-0 font-normal transition-all hover:bg-shad-accent hover:text-shad-accent-foreground focus:bg-shad-accent focus:text-shad-accent-foreground data-[selected]:bg-shad-primary data-[selected]:text-shad-primary-foreground data-[disabled]:text-gray-300 data-[disabled]:pointer-events-none data-[outside-month]:text-gray-300 data-[outside-month]:pointer-events-none",
                              date.toString() === value && "bg-shad-primary text-shad-primary-foreground shadow-md"
                            )}
                          />
                        </Calendar.Cell>
                      {/each}
                    </Calendar.GridRow>
                  {/each}
                </Calendar.GridBody>
              </Calendar.Grid>
            </div>
          {/each}
        </div>
      </Calendar.Root>
    </div>
  </Popover.Content>
</Popover.Root>