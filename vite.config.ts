import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	return {
		plugins: [sveltekit()],
		optimizeDeps: {
			include: [
				'chart.js',
				'html2canvas',
				'jspdf',
				'canvas-confetti',
				'qrcode',
				'marked',
				'clsx',
				'tailwind-merge',
				'@supabase/supabase-js'
			]
		},
		server: {
			warmup: {
				clientFiles: [
					'./src/routes/+layout.svelte',
					'./src/routes/+page.svelte',
					'./src/lib/supabaseClient.js'
				]
			},
			proxy: {
				'/materials': {
					target: env.PUBLIC_R2_PUBLIC_URL,
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/materials/, '')
				}
			}
		}
	}
});
