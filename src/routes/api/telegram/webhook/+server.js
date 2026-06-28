import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabaseClient'; // ត្រូវការបើអ្នកចង់រក្សាទុកការកំណត់ក្នុង Database

export async function POST({ request, platform }) {
    const TELEGRAM_BOT_TOKEN = platform?.env?.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_WEBHOOK_SECRET = platform?.env?.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;

    if (!TELEGRAM_BOT_TOKEN) {
        return json({ error: 'Telegram not configured' }, { status: 503 });
    }

    // ការពារសុវត្ថិភាព៖ ផ្ទៀងផ្ទាត់ថា Request នេះពិតជាមកពី Telegram មែន
    const secretToken = request.headers.get('x-telegram-bot-api-secret-token');
    if (TELEGRAM_WEBHOOK_SECRET && secretToken !== TELEGRAM_WEBHOOK_SECRET) {
        return json({ error: 'Unauthorized (Invalid Secret Token)' }, { status: 403 });
    }

    try {
        const update = await request.json();

        // ប្រសិនបើមានសារ ឬ សកម្មភាពនៅក្នុង Group
        if (update.message) {
            const chatId = update.message.chat.id;

            // ១. មុខងារស្វាគមន៍សមាជិកថ្មី (Welcome Module)
            if (update.message.new_chat_members) {
                // ទាញយកសារស្វាគមន៍ដែលបានកំណត់ពី Database (បើមាន)
                const { data: settings } = await supabase.from('group_settings').select('welcome_text, welcome_enabled').eq('chat_id', chatId.toString()).maybeSingle();

                // ផ្ញើសារលុះត្រាតែមុខងារស្វាគមន៍មិនត្រូវបានបិទ (undefined ឬ true គឺផ្ញើ)
                if (settings?.welcome_enabled !== false) {
                    for (const newMember of update.message.new_chat_members) {
                        // កុំស្វាគមន៍ Bot (រាប់បញ្ចូលទាំងខ្លួនឯង និង Bot ផ្សេងទៀត)
                        if (newMember.is_bot) continue;

                        const memberName = newMember.first_name + (newMember.last_name ? ` ${newMember.last_name}` : '');
                        
                        // ប្រើប្រាស់សារពី Database (ជំនួសពាក្យ {name} និង {title}) បើគ្មានទេប្រើសារធម្មតា
                        const welcomeText = settings?.welcome_text 
                            ? settings.welcome_text.replace(/{name}/g, `<b>${memberName}</b>`).replace(/{title}/g, update.message.chat.title || '')
                            : `ជំរាបសួរ <b>${memberName}</b>! សូមស្វាគមន៍មកកាន់ក្រុម ${update.message.chat.title || ''}។`;
                        
                        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, welcomeText);
                    }
                }
            }

            // ២. មុខងារលាសមាជិកដែលចាកចេញ (Goodbye Module)
            if (update.message.left_chat_member) {
                const leftMember = update.message.left_chat_member;
                const memberName = leftMember.first_name + (leftMember.last_name ? ` ${leftMember.last_name}` : '');
                
                const goodbyeText = `លាហើយ <b>${memberName}</b>! សង្ឃឹមថានឹងបានជួបគ្នាម្ដងទៀត។`;
                await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, goodbyeText);
            }

            // ៣. មុខងារចាប់ Command របស់ Admin (ឧ. /setwelcome)
            if (update.message.text) {
                const text = update.message.text;

                if (text.startsWith('/setwelcome')) {
                    const newWelcomeMsg = text.replace('/setwelcome', '').trim();
                    if (newWelcomeMsg) {
                        // រក្សាទុក ឬធ្វើបច្ចុប្បន្នភាពសារស្វាគមន៍ថ្មី ចូលទៅកាន់ Database
                        const { error } = await supabase.from('group_settings').upsert(
                            { chat_id: chatId.toString(), welcome_text: newWelcomeMsg, updated_at: new Date().toISOString() },
                            { onConflict: 'chat_id' }
                        );
                        
                        if (error) await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, `❌ មានបញ្ហាពេលរក្សាទុក: ${error.message}`);
                        else await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, `✅ សារស្វាគមន៍ត្រូវបានកំណត់ដោយជោគជ័យ!\n(ចំណាំ: អ្នកអាចប្រើអថេរ <code>{name}</code> សម្រាប់ឈ្មោះ និង <code>{title}</code> សម្រាប់ឈ្មោះក្រុម)`);
                    } else {
                        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, `⚠️ សូមបញ្ចូលសារដែលអ្នកចង់កំណត់ពីក្រោយ។\nឧទាហរណ៍៖ <code>/setwelcome សួស្តីសមាជិកថ្មី!</code>`);
                    }
                } else if (text.startsWith('/welcome')) {
                    const cmd = text.replace('/welcome', '').trim().toLowerCase();
                    let isEnabled = null;
                    
                    if (cmd === 'on' || cmd === 'yes') isEnabled = true;
                    else if (cmd === 'off' || cmd === 'no') isEnabled = false;

                    if (isEnabled !== null) {
                        const { error } = await supabase.from('group_settings').upsert(
                            { chat_id: chatId.toString(), welcome_enabled: isEnabled, updated_at: new Date().toISOString() },
                            { onConflict: 'chat_id' }
                        );
                        
                        if (error) await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, `❌ មានបញ្ហាពេលរក្សាទុក: ${error.message}`);
                        else await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, `✅ មុខងារស្វាគមន៍ត្រូវបាន <b>${isEnabled ? 'បើក (ON)' : 'បិទ (OFF)'}</b> ដោយជោគជ័យ!`);
                    } else {
                        await sendTelegramMessage(TELEGRAM_BOT_TOKEN, chatId, `⚠️ សូមប្រើបញ្ជា: \n<code>/welcome on</code> ដើម្បីបើក ឬ\n<code>/welcome off</code> ដើម្បីបិទ`);
                    }
                }
            }
        }

        return json({ success: true });
    } catch (e) {
        console.error('Webhook error:', e);
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
}

async function sendTelegramMessage(token, chatId, text) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'HTML' })
    });
}