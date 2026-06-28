// src/routes/api/telegram/setup/+server.js
import { json } from '@sveltejs/kit';

// ប្តូរពី POST មក GET វិញ ដើម្បីងាយស្រួលចុច Setup តាមរយៈ Browser
export async function GET({ platform, url }) {
    // បន្ថែម process.env ដើម្បីឱ្យស្គាល់ការកំណត់ក្នុងម៉ាស៊ីន (Local)
    const TELEGRAM_BOT_TOKEN = platform?.env?.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_WEBHOOK_SECRET = platform?.env?.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;

    if (!TELEGRAM_BOT_TOKEN) {
        return json({ error: 'Telegram not configured' }, { status: 503 });
    }

    const webhookUrl = `${url.origin}/api/telegram/webhook`;
    const payload = { url: webhookUrl };
    if (TELEGRAM_WEBHOOK_SECRET) {
        payload.secret_token = TELEGRAM_WEBHOOK_SECRET;
    }

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    return json(data, { status: res.ok ? 200 : 502 });
}
