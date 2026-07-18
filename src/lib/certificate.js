import QRCode from 'qrcode';
import { PUBLIC_R2_PUBLIC_URL } from '$env/static/public';
import { normalizeAssetProxyUrl } from '$lib/utils.js';

export async function drawCertificate(canvas, course, user, certId, dateStr, qrData, logoUrl) {
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = normalizeAssetProxyUrl(course.cert_template_url, PUBLIC_R2_PUBLIC_URL);

    await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("Image load failed"));
    });

    // កំណត់ទំហំ Canvas តាមទំហំរូបភាពដើម (Template)
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const config = course.cert_config || {};

    const loadFont = async (fontName, fontUrl) => {
        if (fontName === 'Custom' && fontUrl) {
            try {
                const fontFaceName = 'CustomFont_' + Math.random().toString(36).substr(2, 9);
                const proxiedFontUrl = normalizeAssetProxyUrl(fontUrl, PUBLIC_R2_PUBLIC_URL);
                const fontFace = new FontFace(fontFaceName, `url(${proxiedFontUrl})`);
                await fontFace.load();
                document.fonts.add(fontFace);
                return fontFaceName;
            } catch (e) {
                console.warn("Font load error", e);
                return 'Arial';
            }
        }
        return fontName || 'Arial';
    };

    // Helper សម្រាប់គូរអក្សរ
    const drawText = async (fieldConfig, text, defaultSize = 40) => {
        if (!fieldConfig || fieldConfig.visible === false || !text) return;
        const font = await loadFont(fieldConfig.font, fieldConfig.customFontUrl);
        ctx.font = `${fieldConfig.fontWeight || 'bold'} ${fieldConfig.fontSize || defaultSize}px "${font}"`;
        ctx.fillStyle = fieldConfig.color || '#000000';
        ctx.textAlign = fieldConfig.align || 'center';
        ctx.fillText(text, fieldConfig.x, fieldConfig.y);
    };

    // 1. ឈ្មោះសិស្ស
    if (config.name) {
        await drawText(config.name, user.full_name, 40);
    }

    // 2. ឈ្មោះឡាតាំង
    if (config.name_latin) {
        await drawText(config.name_latin, user.name_latin, 30);
    }

    // 3. លេខសម្គាល់ (ID)
    if (config.id) {
        await drawText(config.id, certId, 20);
    }

    // 4. កាលបរិច្ឆេទ
    if (config.date) {
        await drawText(config.date, dateStr, 20);
    }

    // 5. ចំណងជើងវគ្គសិក្សា (បើមាន)
    if (config.course_title) {
        await drawText(config.course_title, course.title, 30);
    }

    // 6. QR Code
    if (qrData && config.qr && config.qr.visible !== false) {
        const qrUrl = await QRCode.toDataURL(qrData, { width: config.qr.size, margin: 0, errorCorrectionLevel: 'H' });
        const qrImg = new Image();
        qrImg.src = qrUrl;
        await new Promise(r => qrImg.onload = r);
        
        const qrX = config.qr.x - config.qr.size/2;
        const qrY = config.qr.y - config.qr.size/2;
        ctx.drawImage(qrImg, qrX, qrY, config.qr.size, config.qr.size);

        if (logoUrl) {
            const logoImg = new Image();
            logoImg.crossOrigin = "Anonymous";
            logoImg.src = normalizeAssetProxyUrl(logoUrl, PUBLIC_R2_PUBLIC_URL);
            
            await new Promise(resolve => {
                logoImg.onload = () => {
                    const logoSize = config.qr.size * 0.22;
                    const logoX = qrX + (config.qr.size - logoSize) / 2;
                    const logoY = qrY + (config.qr.size - logoSize) / 2;
                    
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(logoX - 2, logoY - 2, logoSize + 4, logoSize + 4);
                    ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
                    resolve();
                };
                logoImg.onerror = resolve;
            });
        }
    }
}
