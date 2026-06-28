import { json } from '@sveltejs/kit';

export async function POST({ request, platform }) {
    const TELEGRAM_BOT_TOKEN = platform?.env?.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = platform?.env?.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        return json({ error: 'Telegram not configured' }, { status: 503 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { message } = body;
    if (!message || typeof message !== 'string') {
        return json({ error: 'message field is required' }, { status: 400 });
    }
    if (message.length > 4096) {
        return json({ error: 'message too long (max 4096 chars)' }, { status: 400 });
    }

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
    });

    if (!res.ok) {
        return json({ error: 'Failed to send Telegram message' }, { status: 502 });
    }

    return json({ success: true });
}