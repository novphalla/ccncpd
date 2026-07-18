alter table public.student_quiz_results
    add column if not exists attempt_key uuid;

create unique index if not exists student_quiz_results_attempt_key_uidx
    on public.student_quiz_results (attempt_key)
    where attempt_key is not null;

-- Remove the client-trusting version. Its score, pass state and XP amount were
-- all supplied by the browser.
drop function if exists public.submit_quiz_and_update_xp(
    uuid, uuid, integer, boolean, jsonb, integer, integer, integer, text, jsonb, integer
);

create or replace function public.submit_quiz_and_update_xp(
    p_user_id uuid,
    p_course_id uuid,
    p_answers jsonb,
    p_type text,
    p_question_ids jsonb,
    p_attempt_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_index integer;
    v_total_questions integer;
    v_expected_questions integer;
    v_unique_questions integer;
    v_correct_count integer := 0;
    v_score integer;
    v_passing_score integer;
    v_passed boolean;
    v_xp_awarded integer;
    v_correct_answer jsonb;
    v_submitted_answer jsonb;
    v_result_id bigint;
    v_created_at timestamptz;
    v_new_xp integer;
    v_new_cpd_total numeric;
    v_existing_user_id uuid;
    v_existing_course_id uuid;
    v_existing_type text;
begin
    if p_attempt_key is null then
        raise exception 'attempt_key is required' using errcode = '22023';
    end if;

    if p_type not in ('pre', 'post') then
        raise exception 'Invalid quiz type' using errcode = '22023';
    end if;

    if auth.uid() is not null and auth.uid() <> p_user_id then
        raise exception 'Cannot submit a quiz for another user' using errcode = '42501';
    end if;

    if coalesce(jsonb_typeof(p_answers), '') <> 'array'
        or coalesce(jsonb_typeof(p_question_ids), '') <> 'array' then
        raise exception 'answers and question_ids must be arrays' using errcode = '22023';
    end if;

    v_total_questions := jsonb_array_length(p_question_ids);
    if v_total_questions < 1 or v_total_questions > 500
        or jsonb_array_length(p_answers) <> v_total_questions then
        raise exception 'Invalid quiz answer count' using errcode = '22023';
    end if;

    -- Serialize retries for the same attempt before checking the unique key.
    perform pg_advisory_xact_lock(hashtextextended(p_attempt_key::text, 0));

    select
        r.id,
        r.created_at,
        r.user_id,
        r.course_id,
        r.type,
        r.correct_count,
        r.score,
        r.passed
    into
        v_result_id,
        v_created_at,
        v_existing_user_id,
        v_existing_course_id,
        v_existing_type,
        v_correct_count,
        v_score,
        v_passed
    from public.student_quiz_results r
    where r.attempt_key = p_attempt_key;

    if found then
        if v_existing_user_id <> p_user_id
            or v_existing_course_id <> p_course_id
            or v_existing_type <> p_type then
            raise exception 'attempt_key is already used by a different quiz' using errcode = '23505';
        end if;

        select u.xp, u.cpd_total
        into v_new_xp, v_new_cpd_total
        from public.users u
        where u.id = p_user_id;

        v_xp_awarded := (v_correct_count * 10) + case when v_passed then 50 else 0 end;

        return jsonb_build_object(
            'result_id', v_result_id,
            'created_at', v_created_at,
            'correct_count', v_correct_count,
            'score', v_score,
            'passed', v_passed,
            'xp_awarded', v_xp_awarded,
            'new_xp', v_new_xp,
            'new_cpd_total', v_new_cpd_total,
            'duplicate', true
        );
    end if;

    select coalesce(c.quiz_passing_score, 70)
    into v_passing_score
    from public.courses c
    where c.id = p_course_id;

    if not found then
        raise exception 'Course not found' using errcode = 'P0002';
    end if;

    select count(*)
    into v_expected_questions
    from public.quiz_questions q
    where q.course_id = p_course_id;

    select count(distinct question_id)
    into v_unique_questions
    from jsonb_array_elements_text(p_question_ids) as submitted(question_id);

    if v_total_questions <> v_expected_questions
        or v_unique_questions <> v_total_questions then
        raise exception 'Quiz questions are missing or duplicated' using errcode = '22023';
    end if;

    for v_index in 0..(v_total_questions - 1) loop
        select to_jsonb(q.correct_answer)
        into v_correct_answer
        from public.quiz_questions q
        where q.id::text = p_question_ids ->> v_index
          and q.course_id = p_course_id;

        if not found then
            raise exception 'Question does not belong to this course' using errcode = '22023';
        end if;

        v_submitted_answer := p_answers -> v_index;
        if v_submitted_answer <> 'null'::jsonb
            and (
                v_correct_answer = v_submitted_answer
                or (
                    jsonb_typeof(v_correct_answer) = 'array'
                    and v_correct_answer @> jsonb_build_array(v_submitted_answer)
                )
            ) then
            v_correct_count := v_correct_count + 1;
        end if;
    end loop;

    v_score := round((v_correct_count::numeric / v_total_questions::numeric) * 100)::integer;
    v_passed := case when p_type = 'pre' then true else v_score >= v_passing_score end;
    v_xp_awarded := (v_correct_count * 10) + case when v_passed then 50 else 0 end;

    insert into public.student_quiz_results (
        user_id,
        course_id,
        score,
        passed,
        type,
        answers,
        question_ids,
        total_questions,
        correct_count,
        percentage,
        attempt_key
    ) values (
        p_user_id,
        p_course_id,
        v_score,
        v_passed,
        p_type,
        p_answers,
        p_question_ids,
        v_total_questions,
        v_correct_count,
        v_score,
        p_attempt_key
    )
    returning id, created_at into v_result_id, v_created_at;

    update public.users
    set xp = coalesce(xp, 0) + v_xp_awarded
    where id = p_user_id
    returning xp, cpd_total into v_new_xp, v_new_cpd_total;

    if not found then
        raise exception 'User not found' using errcode = 'P0002';
    end if;

    return jsonb_build_object(
        'result_id', v_result_id,
        'created_at', v_created_at,
        'correct_count', v_correct_count,
        'score', v_score,
        'passed', v_passed,
        'xp_awarded', v_xp_awarded,
        'new_xp', v_new_xp,
        'new_cpd_total', v_new_cpd_total,
        'duplicate', false
    );
end;
$$;

revoke all on function public.submit_quiz_and_update_xp(uuid, uuid, jsonb, text, jsonb, uuid) from public;
grant execute on function public.submit_quiz_and_update_xp(uuid, uuid, jsonb, text, jsonb, uuid)
    to anon, authenticated, service_role;
