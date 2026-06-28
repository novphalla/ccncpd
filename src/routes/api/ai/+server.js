import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';

const MAX_PROMPT_LENGTH = 2000;

// System prompt that constrains AI to medical/nursing education scope
const SYSTEM_PROMPT = `You are an AI assistant for the CCN-CPD (Cambodian Council of Nurses - Continuing Professional Development) platform. 
You ONLY answer questions related to nursing, healthcare, medical education, CPD (continuing professional development), and Cambodian health regulations. 
Do not respond to questions outside this scope. Respond in Khmer (ភាសាខ្មែរ) unless the user writes in English.`;

export async function POST({ request }) {
    const { GEMINI_API_KEY } = env;
    if (!GEMINI_API_KEY) return json({ error: 'Server config missing' }, { status: 500 });

    // Validate Content-Type
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        return json({ error: 'Invalid content type' }, { status: 400 });
    }

    let prompt;
    try {
        const body = await request.json();
        prompt = body?.prompt;
    } catch {
        return json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Input validation
    if (!prompt || typeof prompt !== 'string') {
        return json({ error: 'Prompt is required' }, { status: 400 });
    }
    if (prompt.trim().length === 0) {
        return json({ error: 'Prompt cannot be empty' }, { status: 400 });
    }
    if (prompt.length > MAX_PROMPT_LENGTH) {
        return json({ error: `Prompt too long (max ${MAX_PROMPT_LENGTH} characters)` }, { status: 400 });
    }

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: {
                    parts: [{ text: SYSTEM_PROMPT }]
                },
                contents: [
                    { role: 'user', parts: [{ text: prompt }] }
                ]
            })
        });
        const data = await response.json();

        if (!response.ok) {
            console.error('Gemini API Error:', data);
            return json({ error: 'AI service encountered an error' }, { status: 502 });
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'AI មិនអាចឆ្លើយបានទេ';
        return json({ text });
    } catch (e) {
        console.error('Fetch Error:', e);
        return json({ error: 'AI service unavailable' }, { status: 503 });
    }
}