do $$
begin
    if to_regclass('public.lesson_progress') is not null
       and exists (
            select 1
            from public.lesson_progress
            group by user_id, lesson_id
            having count(*) > 1
       ) then
        raise exception 'Duplicate lesson_progress rows exist for (user_id, lesson_id). Merge duplicates before adding the ON CONFLICT constraint.';
    end if;

    if to_regclass('public.group_settings') is not null
       and exists (
            select 1
            from public.group_settings
            group by chat_id
            having count(*) > 1
       ) then
        raise exception 'Duplicate group_settings rows exist for chat_id. Merge duplicates before adding the ON CONFLICT constraint.';
    end if;
end $$;

do $$
begin
    if to_regclass('public.lesson_progress') is not null then
        create unique index if not exists lesson_progress_user_lesson_on_conflict_idx
            on public.lesson_progress(user_id, lesson_id);
    end if;

    if to_regclass('public.group_settings') is not null then
        create unique index if not exists group_settings_chat_id_on_conflict_idx
            on public.group_settings(chat_id);
    end if;
end $$;
