do $$
begin
    if to_regclass('public.course_enrollments') is not null
       and exists (
            select 1
            from public.course_enrollments
            group by course_id, user_id
            having count(*) > 1
       ) then
        raise exception 'Duplicate course_enrollments rows exist for (course_id, user_id). Merge duplicates before adding the ON CONFLICT constraint.';
    end if;

    if to_regclass('public.course_invite_redemptions') is not null
       and exists (
            select 1
            from public.course_invite_redemptions
            group by course_id, user_id
            having count(*) > 1
       ) then
        raise exception 'Duplicate course_invite_redemptions rows exist for (course_id, user_id). Merge duplicates before adding the ON CONFLICT constraint.';
    end if;

    if to_regclass('public.course_invite_redemptions') is not null
       and exists (
            select 1
            from public.course_invite_redemptions
            group by code_id, user_id
            having count(*) > 1
       ) then
        raise exception 'Duplicate course_invite_redemptions rows exist for (code_id, user_id). Merge duplicates before adding the ON CONFLICT constraint.';
    end if;

    if to_regclass('public.meeting_attendance') is not null
       and exists (
            select 1
            from public.meeting_attendance
            group by meeting_id, user_id
            having count(*) > 1
       ) then
        raise exception 'Duplicate meeting_attendance rows exist for (meeting_id, user_id). Merge duplicates before adding the ON CONFLICT constraint.';
    end if;
end $$;

do $$
begin
    if to_regclass('public.course_enrollments') is not null then
        create unique index if not exists course_enrollments_course_user_on_conflict_idx
            on public.course_enrollments(course_id, user_id);
    end if;

    if to_regclass('public.course_invite_redemptions') is not null then
        create unique index if not exists course_invite_redemptions_course_user_on_conflict_idx
            on public.course_invite_redemptions(course_id, user_id);

        create unique index if not exists course_invite_redemptions_code_user_on_conflict_idx
            on public.course_invite_redemptions(code_id, user_id);
    end if;

    if to_regclass('public.meeting_attendance') is not null then
        create unique index if not exists meeting_attendance_meeting_user_on_conflict_idx
            on public.meeting_attendance(meeting_id, user_id);
    end if;
end $$;
