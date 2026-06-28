import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

// អ្នកអាចប្តូរទៅប្រើ Email Service (Resend/SendGrid) ឬ Telegram Bot
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID')
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL')

serve(async (req) => {
  try {
    const { record } = await req.json()

    // ករណីទី ១: ការចុះឈ្មោះសមាជិកថ្មី (New User Signup)
    if (record.email && !record.form_id) {
        const email = record.email
        const name = record.raw_user_meta_data?.name || record.raw_user_meta_data?.full_name || email
        
        console.log(`New user joined: ${email}`)

        if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
          const message = `🚀 សមាជិកថ្មីបានចុះឈ្មោះ!\n\n👤 ឈ្មោះ: ${name}\n📧 Email: ${email}\n📅 ថ្ងៃទី: ${new Date().toLocaleString()}`
          await sendTelegram(message)
        }
    }

    // ករណីទី ២: ការបញ្ជូន Form ថ្មី (New Form Submission)
    if (record.form_id && record.data) {
        console.log(`New form submission: ${record.form_id}`)
        
        let content = `📝 <b>មានអ្នកបំពេញបែបបទថ្មី!</b>\n`
        content += `🆔 Form ID: ${record.form_id}\n`
        content += `📅 ថ្ងៃទី: ${new Date().toLocaleString()}\n\n`
        content += `<b>ចម្លើយ:</b>\n`
        
        for (const [key, value] of Object.entries(record.data)) {
            if (key !== '_score') content += `- ${key}: ${value}\n`
        }

        // 1. ផ្ញើ Telegram
        if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) await sendTelegram(content)

        // 2. ផ្ញើ Email (Resend)
        if (RESEND_API_KEY && ADMIN_EMAIL) {
            await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${RESEND_API_KEY}`
                },
                body: JSON.stringify({
                    from: 'CCN1 LMS <onboarding@resend.dev>',
                    to: [ADMIN_EMAIL],
                    subject: `New Form Submission (ID: ${record.form_id})`,
                    html: content.replace(/\n/g, '<br>')
                })
            })
        }
    }

    return new Response(JSON.stringify({ message: "Notification sent" }), {
      headers: { "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})

async function sendTelegram(text: string) {
    if (!Deno.env.get('TELEGRAM_BOT_TOKEN') || !Deno.env.get('TELEGRAM_CHAT_ID')) return;
    await fetch(`https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: Deno.env.get('TELEGRAM_CHAT_ID'),
          text: text,
          parse_mode: 'HTML'
        })
    })
}