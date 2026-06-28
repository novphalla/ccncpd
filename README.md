# CCN1 LMS

SvelteKit LMS application with:
- Phone + PIN login flow
- Course lessons + quizzes + certificate generation
- Admin dashboard for users/courses/meetings
- Telegram certificate sharing
- PWA install + service worker support

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` with:
```env
PUBLIC_SUPABASE_URL=...
PUBLIC_SUPABASE_ANON_KEY=...
PUBLIC_VAPID_PUBLIC_KEY=...
GEMINI_API_KEY=...
TELEGRAM_BOT_TOKEN=...
```

3. Run development server:
```bash
npm run dev
```

## Quality checks

```bash
npm run check
npm run build
```
