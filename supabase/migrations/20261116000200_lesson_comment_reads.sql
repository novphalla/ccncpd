create table if not exists public.lesson_comment_reads (
    user_id uuid not null references public.users(id) on delete cascade,
    lesson_id uuid not null references public.lessons(id) on delete cascade,
    last_read_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, lesson_id)
);

create index if not exists lesson_comment_reads_lesson_idx
    on public.lesson_comment_reads (lesson_id, last_read_at);

create index if not exists lesson_comments_visible_unread_idx
    on public.lesson_comments (lesson_id, created_at)
    where status = 'visible';

alter table public.lesson_comment_reads enable row level security;

revoke all on table public.lesson_comment_reads from anon, authenticated;
grant all on table public.lesson_comment_reads to service_role;

create or replace function public.get_lesson_comment_unread_counts(
    p_user_id uuid,
    p_course_ids uuid[]
)
returns table (
    course_id uuid,
    lesson_id uuid,
    unread_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        comments.course_id,
        comments.lesson_id,
        count(*)::bigint as unread_count
    from public.lesson_comments as comments
    left join public.lesson_comment_reads as reads
        on reads.user_id = p_user_id
       and reads.lesson_id = comments.lesson_id
    where comments.status = 'visible'
      and comments.author_id <> p_user_id
      and comments.course_id = any(p_course_ids)
      and comments.created_at > coalesce(reads.last_read_at, '-infinity'::timestamptz)
    group by comments.course_id, comments.lesson_id;
$$;

revoke all on function public.get_lesson_comment_unread_counts(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.get_lesson_comment_unread_counts(uuid, uuid[]) to service_role;

comment on table public.lesson_comment_reads is
    'Per-member read positions for lesson discussion unread badges.';
