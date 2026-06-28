import { json } from '@sveltejs/kit';

export async function POST({ request }) {
    try {
        const body = await request.json();
        const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';

        if (!endpoint) {
            return json({ ok: false, error: 'Invalid subscription payload' }, { status: 400 });
        }

        // Placeholder: persist subscription to DB if needed.
        return json({ ok: true });
    } catch {
        return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
    }
}
