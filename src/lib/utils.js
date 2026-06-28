import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
    return twMerge(clsx(inputs));
}

/**
 * Converts legacy /materials/<key> or bare <key> paths to full R2 public URLs.
 * Full https:// URLs are returned unchanged.
 */
export function normalizeAssetUrl(url, r2BaseUrl) {
    if (!url) return url;
    if (url.startsWith('http')) return url;
    if (url.startsWith('/materials/')) {
        // /materials/course_assets/file.jpg → https://r2.dev/course_assets/file.jpg
        return r2BaseUrl.replace(/\/$/, '') + '/' + url.slice('/materials/'.length);
    }
    // bare key e.g. course_assets/file.jpg
    return r2BaseUrl.replace(/\/$/, '') + '/' + url;
}

export function normalizeKhmerNumerals(str) {
    if (!str) return '';
    return str.replace(/[០-៩]/g, d => '0123456789'['០១២៣៤៥៦៧៨៩'.indexOf(d)]);
}

export function formatDate(dateString) {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('km-KH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export function formatPhoneNumber(phone) {
    if (!phone) return '';
    const cleaned = normalizeKhmerNumerals(phone).replace(/\D/g, '');
    // Format as 0XX XXX XXX
    if (cleaned.length >= 9) {
        return cleaned.replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
    }
    return cleaned;
}

export function truncateText(str, length = 30) {
    if (!str) return '';
    if (str.length <= length) return str;
    return str.slice(0, length) + '...';
}

export function formatCurrency(amount, currency = 'USD') {
    if (amount === null || amount === undefined) return '';
    const num = Number(amount);
    if (isNaN(num)) return '0';

    if (currency === 'KHR') {
        return num.toLocaleString('en-US') + ' ៛';
    }
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function hashPin(pin) {
    const normalized = normalizeKhmerNumerals(pin).trim();
    if (!normalized) return '';
    if (normalized.startsWith('sha256:')) return normalized;

    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const data = new TextEncoder().encode(normalized);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        return `sha256:${hashHex}`;
    }

    return normalized;
}

export async function compressImage(file, maxWidth = 800, quality = 0.8) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return file;
    }

    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.type === 'image/x-icon') {
        return file;
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (!blob) return reject(new Error('Compression failed'));
                    const newFile = new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), {
                        type: 'image/webp',
                        lastModified: Date.now(),
                    });
                    resolve(newFile);
                }, 'image/webp', quality);
            };
            img.onerror = (e) => reject(e);
        };
        reader.onerror = (e) => reject(e);
    });
}

export async function handleUpload(file, folder) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('folder', folder);

        const res = await fetch('/api/storage', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) {
            alert("បញ្ហាក្នុងការផ្ទុកឯកសារ: " + (data.error || res.statusText));
            return null;
        }
        return data.publicUrl;
    } catch (e) {
        console.error(e);
        alert("Upload failed: " + e.message);
        return null;
    }
}
