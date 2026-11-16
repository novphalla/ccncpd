# CCN CPD — Maintenance Notes

កាលបរិច្ឆេទពិនិត្យ៖ 16 វិច្ឆិកា 2026

## ស្ថានភាពបច្ចុប្បន្ន

- Upgrade ជាដំណាក់កាលទៅ `Svelte 5.57.3`, `SvelteKit 2.70.4`, `Vite 7.3.8` និង `jsPDF 4.2.1` រួចរាល់។
- `npm run check` ជោគជ័យ៖ 0 errors និង 141 warnings ក្នុង 17 files។
- `npm run build` និង preview smoke test ជោគជ័យ។
- Production dependency audit (`npm audit --omit=dev`) មិនមាន Critical, High ឬ Moderate vulnerabilities ទៀតទេ; នៅសល់ 8 Low។
- Full audit រួមទាំង development tooling នៅសល់ 29 issues៖ 6 High, 13 Moderate និង 10 Low។ វាភាគច្រើនមកពី Capacitor assets/PWA/build tooling ហើយមិនត្រូវបានដាក់ក្នុង production bundle ដោយផ្ទាល់ទេ។
- មិនបានប្រើ `npm audit fix --force` ទេ។
- Android project ត្រូវការ JDK 21 និង `ANDROID_HOME` ដែលចង្អុលទៅ Android SDK។ JDK 27 មិនត្រូវនឹង Gradle 8.14 ហើយ JDK 17 មិនអាច compile Java source 21 បានទេ។

## អ្វីដែលត្រូវធ្វើបន្ទាប់

- [ ] កែ accessibility warnings ជាបណ្តើរៗ៖ label/input association, keyboard handlers, ARIA roles និង video captions។
- [ ] បំបែក bundle ធំៗដោយ dynamic imports/code splitting។
- [ ] បន្ថែម automated tests សម្រាប់ login, enrollment, lesson progress, quiz, certificate/PDF និង admin permissions។
- [ ] តាមដាន development dependency advisories និង upgrade ពេល upstream packages ចេញកំណែដែលបានជួសជុល។
- [ ] សាកល្បង Android app លើឧបករណ៍ពិត និងរៀបចំ signed Android App Bundle (`.aab`) មុនដាក់ Play Store។
- [ ] Deploy ទៅ staging និងធ្វើ regression test មុន production release។

## Regression checklist

- [ ] Login/logout និង session restore
- [ ] Course enrollment, invite code, coupon និង payment proof
- [ ] Lesson progress, file download និង video playback
- [ ] Pre-test, post-test និង score history
- [ ] Certificate generation, Khmer font, QR និង PDF download
- [ ] Admin dashboard, activity logs និង permissions
- [ ] PWA install/update និង Android navigation

## ពាក្យបញ្ជាសម្រាប់ផ្ទៀងផ្ទាត់

```bash
npm run check
npm run build
npm audit --omit=dev
git status --short
```

## ការប្រុងប្រយ័ត្ន

- កុំប្រើ `npm audit fix --force` លើ branch `main`។
- កុំរត់ Supabase migrations ថ្មីដោយមិនពិនិត្យលំដាប់ និង database backup មុន។
- កុំ commit `.env`, access tokens, signing keys ឬ diagnostic scripts ដែលអាចកែ production data។
- កុំ deploy ពេលមាន uncommitted changes ដែលមិនទាន់បាន validate។
