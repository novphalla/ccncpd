alter table public.lesson_comments
    add column if not exists reply_to_id uuid references public.lesson_comments(id) on delete set null,
    add column if not exists is_resolved boolean not null default false,
    add column if not exists resolved_at timestamptz,
    add column if not exists resolved_by uuid references public.users(id) on delete set null;

create index if not exists lesson_comments_reply_to_idx
    on public.lesson_comments (reply_to_id)
    where reply_to_id is not null;

create index if not exists lesson_comments_lesson_page_idx
    on public.lesson_comments (lesson_id, is_pinned desc, created_at desc, id desc)
    where parent_id is null;

create table if not exists public.lesson_comment_subscriptions (
    user_id uuid not null references public.users(id) on delete cascade,
    lesson_id uuid not null references public.lessons(id) on delete cascade,
    course_id uuid not null references public.courses(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, lesson_id)
);

create index if not exists lesson_comment_subscriptions_lesson_idx
    on public.lesson_comment_subscriptions (lesson_id, user_id);

create table if not exists public.lesson_comment_mentions (
    comment_id uuid not null references public.lesson_comments(id) on delete cascade,
    mentioned_user_id uuid not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (comment_id, mentioned_user_id)
);

create index if not exists lesson_comment_mentions_user_idx
    on public.lesson_comment_mentions (mentioned_user_id, created_at desc);

create table if not exists public.lesson_comment_edits (
    id uuid primary key default gen_random_uuid(),
    comment_id uuid not null references public.lesson_comments(id) on delete cascade,
    editor_id uuid not null references public.users(id) on delete cascade,
    previous_body text not null,
    new_body text not null,
    edited_at timestamptz not null default now(),
    constraint lesson_comment_edits_previous_length check (char_length(previous_body) between 1 and 2000),
    constraint lesson_comment_edits_new_length check (char_length(new_body) between 1 and 2000)
);

create index if not exists lesson_comment_edits_comment_idx
    on public.lesson_comment_edits (comment_id, edited_at desc);

alter table public.lesson_comment_notifications
    drop constraint if exists lesson_comment_notifications_notification_type_check;

alter table public.lesson_comment_notifications
    add constraint lesson_comment_notifications_notification_type_check
    check (notification_type in ('reply', 'lesson_comment', 'mention', 'resolved'));

create or replace function public.validate_lesson_comment_context()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    lesson_course_id uuid;
    parent_comment public.lesson_comments%rowtype;
    reply_target public.lesson_comments%rowtype;
begin
    select lessons.course_id
      into lesson_course_id
      from public.lessons
     where lessons.id = new.lesson_id;

    if lesson_course_id is null or lesson_course_id <> new.course_id then
        raise exception 'Comment course does not match the lesson course';
    end if;

    if new.parent_id is not null then
        select * into parent_comment
          from public.lesson_comments
         where lesson_comments.id = new.parent_id;

        if parent_comment.id is null
           or parent_comment.lesson_id <> new.lesson_id
           or parent_comment.course_id <> new.course_id
           or parent_comment.parent_id is not null then
            raise exception 'Reply parent must be a top-level comment in the same lesson';
        end if;
    end if;

    if new.reply_to_id is not null then
        select * into reply_target
          from public.lesson_comments
         where lesson_comments.id = new.reply_to_id;

        if reply_target.id is null
           or reply_target.lesson_id <> new.lesson_id
           or reply_target.course_id <> new.course_id
           or new.parent_id is null
           or coalesce(reply_target.parent_id, reply_target.id) <> new.parent_id then
            raise exception 'Reply target must belong to the same discussion thread';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists lesson_comments_validate_context on public.lesson_comments;
create trigger lesson_comments_validate_context
    before insert or update of lesson_id, course_id, parent_id, reply_to_id
    on public.lesson_comments
    for each row execute function public.validate_lesson_comment_context();

alter table public.lesson_comment_subscriptions enable row level security;
alter table public.lesson_comment_mentions enable row level security;
alter table public.lesson_comment_edits enable row level security;

revoke all on table public.lesson_comment_subscriptions from anon, authenticated;
revoke all on table public.lesson_comment_mentions from anon, authenticated;
revoke all on table public.lesson_comment_edits from anon, authenticated;

grant all on table public.lesson_comment_subscriptions to service_role;
grant all on table public.lesson_comment_mentions to service_role;
grant all on table public.lesson_comment_edits to service_role;

comment on table public.lesson_comment_subscriptions is
    'Members following a lesson discussion. Managed only by authenticated server APIs.';
comment on table public.lesson_comment_mentions is
    'Validated users mentioned by a lesson comment.';
comment on table public.lesson_comment_edits is
    'Immutable audit history for lesson comment edits.';
