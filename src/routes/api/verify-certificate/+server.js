import { json } from '@sveltejs/kit';
import { serviceClient } from '$lib/server/requestAuth';

const PUBLIC_CACHE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600';

function validUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function response(body, status = 200) {
    return json(body, {
        status,
        headers: {
            'Cache-Control': status === 200 || status === 404 ? PUBLIC_CACHE : 'no-store'
        }
    });
}

export async function GET({ url, platform }) {
    const userId = url.searchParams.get('u');
    const courseId = url.searchParams.get('c');

    if (!validUuid(userId) || !validUuid(courseId)) {
        return response({ valid: false, error: 'Invalid certificate parameters' }, 400);
    }

    const supabase = serviceClient(platform);
    if (!supabase) {
        return response({ valid: false, error: 'Verification service unavailable' }, 503);
    }

    try {
        const { data, error } = await supabase
            .from('student_quiz_results')
            .select(`
                id,
                created_at,
                score,
                type,
                users!inner(full_name, name_latin),
                courses!inner(title)
            `)
            .eq('user_id', userId)
            .eq('course_id', courseId)
            .eq('passed', true)
            .or('type.eq.post,type.is.null')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            console.error('Certificate verification query failed:', error);
            return response({ valid: false, error: 'Verification query failed' }, 500);
        }

        if (!data) {
            return response({ valid: false }, 404);
        }

        return response({
            valid: true,
            certificateId: `CCN-${String(data.id).padStart(3, '0')}`,
            completionDate: data.created_at,
            score: Number(data.score) || 0,
            student: data.users,
            course: data.courses
        });
    } catch (error) {
        console.error('Certificate verification service error:', error);
        return response({ valid: false, error: 'Verification service error' }, 500);
    }
}
