import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// ផ្នែកសំខាន់៖ បន្ទាត់នេះប្រាប់ Svelte ឱ្យស្គាល់ TypeScript (<script lang="ts">)
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			routes: {
				include: ['/*'],
				exclude: ['<all>']
			}
		}),
		csrf: {
			checkOrigin: false
		}
	}
};

export default config;
