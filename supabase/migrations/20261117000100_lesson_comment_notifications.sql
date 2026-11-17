create table if not exists public.lesson_comment_notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    actor_id uuid not null references public.users(id) on delete cascade,
    comment_id uuid not null references public.lesson_comments(id) on delete cascade,
    lesson_id uuid not null references public.lessons(id) on delete cascade,
    course_id uuid not null references public.courses(id) on delete cascade,
    notification_type text not null
        check (notification_type in ('reply', 'lesson_comment')),
    read_at timestamptz,
    created_at timestamptz not null default now(),
    unique (user_id, comment_id)
);

create index if not exists lesson_comment_notifications_user_created_idx
    on public.lesson_comment_notifications (user_id, created_at desc);

create index if not exists lesson_comment_notifications_user_unread_idx
    on public.lesson_comment_notifications (user_id, created_at desc)
    where read_at is null;

alter table public.lesson_comment_notifications enable row level security;

revoke all on table public.lesson_comment_notifications from anon, authenticated;
grant all on table public.lesson_comment_notifications to service_role;

comment on table public.lesson_comment_notifications is
    'Server-managed notifications for replies and new comments in lesson discussions.';
