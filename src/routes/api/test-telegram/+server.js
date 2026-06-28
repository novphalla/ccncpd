// ទីតាំងត្រឹមត្រូវ: c:\Users\novph\ccn-cpd\src\routes\api\test-telegram\+server.js
import { json } from '@sveltejs/kit';

export async function GET({ platform }) {
    const botToken = platform?.env?.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const chatId = platform?.env?.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
        return json({
            success: false,
            error: 'សូមប្រាកដថា TELEGRAM_BOT_TOKEN និង TELEGRAM_CHAT_ID មាននៅក្នុងឯកសារ .env របស់អ្នក។'
        }, { status: 500 });
    }

    const testMessage = `✅ <b>Test Message</b>\n\nHello from your CCN-CPD Bot! 👋\nប្រសិនបើអ្នកបានទទួលសារនេះ មានន័យថាការរៀបចំរបស់អ្នកបានដំណើរការត្រឹមត្រូវ។\n\n<i>${new Date().toLocaleString('km-KH')}</i>`;

    try {
        const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: testMessage,
                parse_mode: 'HTML'
            })
        });

        const result = await response.json();

        if (!result.ok) {
            console.error('Telegram API Error:', result);
            return json({ success: false, error: `Telegram API Error: ${result.description}` }, { status: 400 });
        }

        return json({ success: true, message: `សារតេស្តត្រូវបានផ្ញើដោយជោគជ័យទៅកាន់ Chat ID: ${chatId}` });

    } catch (e) {
        console.error('Fetch Error:', e);
        return json({ success: false, error: `បរាជ័យក្នុងការផ្ញើសារ: ${e.message}` }, { status: 500 });
    }
}
