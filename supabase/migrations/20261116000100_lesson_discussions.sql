create extension if not exists pgcrypto;

create table if not exists public.lesson_comments (
    id uuid primary key default gen_random_uuid(),
    lesson_id uuid not null references public.lessons(id) on delete cascade,
    course_id uuid not null references public.courses(id) on delete cascade,
    author_id uuid not null references public.users(id) on delete cascade,
    parent_id uuid references public.lesson_comments(id) on delete set null,
    body text not null,
    status text not null default 'visible'
        check (status in ('visible', 'hidden', 'deleted')),
    edited_at timestamptz,
    moderated_at timestamptz,
    moderated_by uuid references public.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint lesson_comments_body_length check (
        status = 'deleted'
        or char_length(btrim(body)) between 1 and 2000
    )
);

create table if not exists public.lesson_comment_reports (
    id uuid primary key default gen_random_uuid(),
    comment_id uuid not null references public.lesson_comments(id) on delete cascade,
    reporter_id uuid not null references public.users(id) on delete cascade,
    reason text not null
        check (reason in ('spam', 'harassment', 'privacy', 'misinformation', 'other')),
    details text,
    status text not null default 'pending'
        check (status in ('pending', 'reviewed', 'dismissed')),
    reviewed_at timestamptz,
    reviewed_by uuid references public.users(id) on delete set null,
    created_at timestamptz not null default now(),
    unique (comment_id, reporter_id),
    constraint lesson_comment_reports_details_length check (
        details is null or char_length(details) <= 500
    )
);

create index if not exists lesson_comments_lesson_created_idx
    on public.lesson_comments (lesson_id, created_at, id);

create index if not exists lesson_comments_course_idx
    on public.lesson_comments (course_id);

create index if not exists lesson_comments_author_created_idx
    on public.lesson_comments (author_id, created_at desc);

create index if not exists lesson_comments_parent_idx
    on public.lesson_comments (parent_id)
    where parent_id is not null;

create index if not exists lesson_comment_reports_pending_idx
    on public.lesson_comment_reports (status, created_at)
    where status = 'pending';

create or replace function public.validate_lesson_comment_context()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    lesson_course_id uuid;
    parent_comment public.lesson_comments%rowtype;
begin
    select lessons.course_id
      into lesson_course_id
      from public.lessons
     where lessons.id = new.lesson_id;

    if lesson_course_id is null or lesson_course_id <> new.course_id then
        raise exception 'Comment course does not match the lesson course';
    end if;

    if new.parent_id is not null then
        select *
          into parent_comment
          from public.lesson_comments
         where lesson_comments.id = new.parent_id;

        if parent_comment.id is null
           or parent_comment.lesson_id <> new.lesson_id
           or parent_comment.course_id <> new.course_id then
            raise exception 'Reply must belong to the same lesson and course';
        end if;

        if parent_comment.parent_id is not null then
            raise exception 'Only one reply level is supported';
        end if;
    end if;

    return new;
end;
$$;

create or replace function public.touch_lesson_comment_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists lesson_comments_validate_context on public.lesson_comments;
create trigger lesson_comments_validate_context
    before insert or update of lesson_id, course_id, parent_id
    on public.lesson_comments
    for each row execute function public.validate_lesson_comment_context();

drop trigger if exists lesson_comments_touch_updated_at on public.lesson_comments;
create trigger lesson_comments_touch_updated_at
    before update on public.lesson_comments
    for each row execute function public.touch_lesson_comment_updated_at();

alter table public.lesson_comments enable row level security;
alter table public.lesson_comment_reports enable row level security;

revoke all on table public.lesson_comments from anon, authenticated;
revoke all on table public.lesson_comment_reports from anon, authenticated;

grant all on table public.lesson_comments to service_role;
grant all on table public.lesson_comment_reports to service_role;

comment on table public.lesson_comments is
    'Moderated lesson discussions. Access is server-only through authenticated APIs.';

comment on table public.lesson_comment_reports is
    'Member reports for lesson comments. Access is restricted to server moderation APIs.';
