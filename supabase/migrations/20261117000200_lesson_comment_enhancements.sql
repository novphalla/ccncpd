alter table public.lesson_comments
    add column if not exists is_pinned boolean not null default false,
    add column if not exists pinned_at timestamptz,
    add column if not exists pinned_by uuid references public.users(id) on delete set null;

create index if not exists lesson_comments_lesson_pinned_idx
    on public.lesson_comments (lesson_id, is_pinned desc, created_at)
    where status = 'visible';

create table if not exists public.lesson_comment_reactions (
    comment_id uuid not null references public.lesson_comments(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    reaction_type text not null check (reaction_type in ('like', 'love', 'helpful')),
    created_at timestamptz not null default now(),
    primary key (comment_id, user_id)
);

create index if not exists lesson_comment_reactions_comment_idx
    on public.lesson_comment_reactions (comment_id, reaction_type);

alter table public.lesson_comment_reactions enable row level security;
revoke all on table public.lesson_comment_reactions from anon, authenticated;
grant all on table public.lesson_comment_reactions to service_role;

comment on table public.lesson_comment_reactions is
    'Server-managed member reactions for lesson discussion comments.';
