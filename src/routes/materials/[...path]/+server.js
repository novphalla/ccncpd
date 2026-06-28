import { error } from '@sveltejs/kit';
import { PUBLIC_R2_PUBLIC_URL } from '$env/static/public';

export async function GET({ params, platform, setHeaders }) {
    const key = params.path;

    // Dev fallback: no R2 bucket — proxy directly to R2 public URL
    if (!platform?.env?.BUCKET) {
        const r2Url = PUBLIC_R2_PUBLIC_URL.replace(/\/$/, '') + '/' + key;
        const res = await fetch(r2Url);
        if (!res.ok) throw error(res.status, 'File not found');
        setHeaders({
            'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000'
        });
        return new Response(res.body);
    }

    const object = await platform.env.BUCKET.get(key);
    if (!object) throw error(404, 'File not found');

    setHeaders({
        'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000'
    });

    return new Response(object.body);
}
