create index if not exists student_quiz_results_user_course_type_created_idx
    on public.student_quiz_results (user_id, course_id, type, created_at desc, id desc)
    include (passed, correct_count, score);

create index if not exists quiz_questions_course_sort_idx
    on public.quiz_questions (course_id, sort_order, id);

create index if not exists meeting_registrations_user_idx
    on public.meeting_registrations (user_id, meeting_id);

create index if not exists live_meetings_published_schedule_idx
    on public.live_meetings (is_published, scheduled_at desc)
    where deleted_at is null;

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
    v_total_questions integer;
    v_expected_questions integer;
    v_unique_questions integer;
    v_matched_questions integer;
    v_correct_count integer;
    v_score integer;
    v_passing_score integer;
    v_quiz_cooldown text;
    v_passed boolean;
    v_xp_awarded integer;
    v_result_id bigint;
    v_created_at timestamptz;
    v_new_xp integer;
    v_new_cpd_total numeric;
    v_existing_user_id uuid;
    v_existing_course_id uuid;
    v_existing_type text;
    v_last_passed boolean;
    v_last_created_at timestamptz;
    v_fail_count integer;
    v_cooldown_values text[];
    v_cooldown_value text;
    v_cooldown_minutes numeric;
    v_retry_at timestamptz;
begin
    if auth.role() <> 'service_role' then
        raise exception 'Quiz submission must use the authenticated server endpoint' using errcode = '42501';
    end if;

    if p_attempt_key is null then
        raise exception 'attempt_key is required' using errcode = '22023';
    end if;

    if p_type not in ('pre', 'post') then
        raise exception 'Invalid quiz type' using errcode = '22023';
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

    -- Serialize all submissions for one user/course, including different attempt keys.
    perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_course_id::text || ':' || p_type, 0));

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

    select coalesce(c.quiz_passing_score, 70), c.quiz_cooldown
    into v_passing_score, v_quiz_cooldown
    from public.courses c
    where c.id = p_course_id;

    if not found then
        raise exception 'Course not found' using errcode = 'P0002';
    end if;

    if p_type = 'pre' and exists (
        select 1 from public.student_quiz_results r
        where r.user_id = p_user_id and r.course_id = p_course_id and r.type = 'pre'
    ) then
        raise exception 'QUIZ_ALREADY_COMPLETED' using errcode = 'P0001';
    end if;

    if p_type = 'post' then
        select r.passed, r.created_at
        into v_last_passed, v_last_created_at
        from public.student_quiz_results r
        where r.user_id = p_user_id and r.course_id = p_course_id and r.type = 'post'
        order by r.created_at desc
        limit 1;

        if found and v_last_passed then
            raise exception 'QUIZ_ALREADY_COMPLETED' using errcode = 'P0001';
        end if;

        if found and not v_last_passed then
            select count(*)::integer
            into v_fail_count
            from public.student_quiz_results failed
            where failed.user_id = p_user_id
              and failed.course_id = p_course_id
              and failed.type = 'post'
              and not failed.passed
              and failed.created_at > coalesce((
                  select max(passed_result.created_at)
                  from public.student_quiz_results passed_result
                  where passed_result.user_id = p_user_id
                    and passed_result.course_id = p_course_id
                    and passed_result.type = 'post'
                    and passed_result.passed
              ), '-infinity'::timestamptz);

            v_cooldown_values := regexp_split_to_array(coalesce(nullif(trim(v_quiz_cooldown), ''), '60'), '\s*,\s*');
            v_cooldown_value := v_cooldown_values[least(greatest(v_fail_count, 1), cardinality(v_cooldown_values))];
            v_cooldown_minutes := case
                when v_cooldown_value ~ '^\d+(\.\d+)?$' then v_cooldown_value::numeric
                else 60
            end;
            v_retry_at := v_last_created_at + (v_cooldown_minutes * interval '1 minute');

            if v_retry_at > now() then
                raise exception 'QUIZ_COOLDOWN:%', to_char(v_retry_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                    using errcode = 'P0001';
            end if;
        end if;
    end if;

    select count(*)::integer
    into v_expected_questions
    from public.quiz_questions q
    where q.course_id = p_course_id;

    with submitted as (
        select ids.question_id, selected.answer, ids.ordinality
        from jsonb_array_elements_text(p_question_ids) with ordinality as ids(question_id, ordinality)
        join jsonb_array_elements(p_answers) with ordinality as selected(answer, ordinality)
          using (ordinality)
    ), scored as (
        select
            submitted.question_id,
            q.id as matched_id,
            submitted.answer,
            to_jsonb(q.correct_answer) as correct_answer
        from submitted
        left join public.quiz_questions q
          on q.id::text = submitted.question_id
         and q.course_id = p_course_id
    )
    select
        count(distinct question_id)::integer,
        count(matched_id)::integer,
        count(*) filter (
            where answer <> 'null'::jsonb
              and (
                  correct_answer = answer
                  or (jsonb_typeof(correct_answer) = 'array' and correct_answer @> jsonb_build_array(answer))
              )
        )::integer
    into v_unique_questions, v_matched_questions, v_correct_count
    from scored;

    if v_total_questions <> v_expected_questions
        or v_unique_questions <> v_total_questions
        or v_matched_questions <> v_total_questions then
        raise exception 'Quiz questions are missing, duplicated or invalid' using errcode = '22023';
    end if;

    v_score := round((v_correct_count::numeric / v_total_questions::numeric) * 100)::integer;
    v_passed := case when p_type = 'pre' then true else v_score >= v_passing_score end;
    v_xp_awarded := (v_correct_count * 10) + case when v_passed then 50 else 0 end;

    insert into public.student_quiz_results (
        user_id, course_id, score, passed, type, answers, question_ids,
        total_questions, correct_count, percentage, attempt_key
    ) values (
        p_user_id, p_course_id, v_score, v_passed, p_type, p_answers, p_question_ids,
        v_total_questions, v_correct_count, v_score, p_attempt_key
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

revoke all on function public.submit_quiz_and_update_xp(uuid, uuid, jsonb, text, jsonb, uuid)
    from public, anon, authenticated;
grant execute on function public.submit_quiz_and_update_xp(uuid, uuid, jsonb, text, jsonb, uuid)
    to service_role;

create or replace function public.get_quiz_attempt_summary(p_user_id uuid)
returns table (
    id bigint,
    course_id uuid,
    passed boolean,
    created_at timestamptz,
    type text,
    fail_count integer,
    latest_passed_id bigint,
    latest_passed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
    with latest as (
        select distinct on (r.course_id, r.type)
            r.id, r.course_id, r.passed, r.created_at, r.type
        from public.student_quiz_results r
        where r.user_id = p_user_id
        order by r.course_id, r.type, r.created_at desc, r.id desc
    )
    select
        latest.id,
        latest.course_id,
        latest.passed,
        latest.created_at,
        latest.type,
        coalesce(failures.fail_count, 0)::integer,
        latest_passed.id,
        latest_passed.created_at
    from latest
    left join lateral (
        select passed_result.id, passed_result.created_at
        from public.student_quiz_results passed_result
        where passed_result.user_id = p_user_id
          and passed_result.course_id = latest.course_id
          and passed_result.type = latest.type
          and passed_result.passed
        order by passed_result.created_at desc, passed_result.id desc
        limit 1
    ) latest_passed on true
    left join lateral (
        select count(*)::integer as fail_count
        from public.student_quiz_results failed
        where failed.user_id = p_user_id
          and failed.course_id = latest.course_id
          and failed.type = latest.type
          and not failed.passed
          and failed.created_at > coalesce(latest_passed.created_at, '-infinity'::timestamptz)
    ) failures on true
    order by latest.created_at desc;
$$;

revoke all on function public.get_quiz_attempt_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_quiz_attempt_summary(uuid) to service_role;

-- Legacy PIN verification is now exposed only through /api/auth/legacy-session.
do $$
declare
    v_function regprocedure;
begin
    for v_function in
        select p.oid::regprocedure
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'verify_pin'
    loop
        execute format(
            'revoke all on function %s from public, anon, authenticated',
            v_function
        );
        execute format('grant execute on function %s to service_role', v_function);
    end loop;
end;
$$;
