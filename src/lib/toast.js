import { writable } from 'svelte/store';

export const toasts = writable([]);

export const addToast = (message, type = 'info', duration = 3000) => {
    const id = Math.floor(Math.random() * 10000);
    const toast = { id, message, type, duration };
    toasts.update((all) => [toast, ...all]);

    if (duration) {
        setTimeout(() => {
            dismissToast(id);
        }, duration);
    }
};

export const dismissToast = (id) => {
    toasts.update((all) => all.filter((t) => t.id !== id));
};