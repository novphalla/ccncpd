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

    const data = event.data.json();
    const options = {
        body: data.body,
        icon: '/logo.png', // ត្រូវប្រាកដថាមានរូបនេះក្នុង folder static
        badge: '/logo.png',
        vibrate: [100, 50, 100], // ញ័រទូរស័ព្ទ
        data: {
            url: self.location.origin // URL ដែលត្រូវបើកពេលចុច
        }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// --- ផ្នែកចុចលើ Notification ---
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            // បើកកម្មវិធីប្រសិនបើមានស្រាប់
            for (let client of windowClients) {
                if (client.url === '/' && 'focus' in client) return client.focus();
            }
            // បើមិនទាន់បើកទេ បើកផ្ទាំងថ្មី
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});