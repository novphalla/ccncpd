<script>
	import { Select } from "bits-ui";
	import { cn } from "$lib/utils";
	import { Check, ChevronDown } from "lucide-svelte";
	import { fly } from "svelte/transition";

	export let value = undefined;
	export let placeholder = "ជ្រើសរើស...";
	export let items = []; // Array of objects { value: any, label: string }
	export let disabled = false;
	
	let className = undefined;
	export { className as class };
</script>

<Select.Root bind:value {disabled}>
	<Select.Trigger
		class={cn(
			"flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
			className
		)}
	>
		<Select.Value {placeholder} class="text-left" />
		<ChevronDown class="h-4 w-4 opacity-50" />
	</Select.Trigger>
	<Select.Content
		class="z-[9999] min-w-[8rem] overflow-hidden rounded-md border border-border bg-shad-popover text-shad-popover-foreground shadow-md outline-none"
		transition={fly}
		transitionConfig={{ duration: 200, y: -5 }}
		sideOffset={4}
		sameWidth={true}
	>
		<div class="max-h-[300px] overflow-y-auto p-1">
			{#each items as item}
				<Select.Item
					value={item.value}
					label={item.label}
					class="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-shad-accent focus:text-shad-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
				>
					<div class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
						<Select.ItemIndicator>
							<Check class="h-4 w-4" />
						</Select.ItemIndicator>
					</div>
					{item.label}
				</Select.Item>
			{/each}
		</div>
	</Select.Content>
</Select.Root>