// static/sw.js

self.addEventListener('install', (event) => {
    // បង្ខំឱ្យ Service Worker ថ្មីដំណើរការភ្លាមៗដោយមិនបាច់រង់ចាំ
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // គ្រប់គ្រងទំព័រភ្លាមៗបន្ទាប់ពី Activate
    event.waitUntil(self.clients.claim());
});

// --- ផ្នែកទទួល Push Notification ---
self.addEventListener('push', (event) => {
    if (!event.data) return;
    let data;
    try {
        data = event.data.json();
    } catch {
        data = { title: 'CCN-CPD', body: event.data.text() };
    }
    const options = {
        body: data.body || 'អ្នកមានការជូនដំណឹងថ្មី',
        icon: '/logo.png', // ត្រូវប្រាកដថាមានរូបនេះក្នុង folder static
        badge: '/logo.png',
        vibrate: [100, 50, 100], // ញ័រទូរស័ព្ទ
        tag: data.tag || 'ccn-cpd',
        renotify: true,
        data: {
            url: new URL(data.url || '/', self.location.origin).href
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'CCN-CPD', options)
    );
});

// --- ផ្នែកចុចលើ Notification ---
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windowClients => {
            const targetUrl = event.notification.data?.url || self.location.origin;
            // បើកកម្មវិធីប្រសិនបើមានស្រាប់
            for (const client of windowClients) {
                if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
                    if ('navigate' in client) await client.navigate(targetUrl);
                    return client.focus();
                }
            }
            // បើមិនទាន់បើកទេ បើកផ្ទាំងថ្មី
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});
