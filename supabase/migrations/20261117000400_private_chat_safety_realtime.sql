alter table public.private_messages
    add column if not exists delivered_at timestamptz;

alter table public.private_conversations
    add column if not exists realtime_topic uuid not null default gen_random_uuid();

create unique index if not exists private_conversations_realtime_topic_idx
    on public.private_conversations (realtime_topic);

create index if not exists private_messages_undelivered_idx
    on public.private_messages (conversation_id, sender_id, created_at)
    where delivered_at is null;

create table if not exists public.private_chat_blocks (
    blocker_id uuid not null references public.users(id) on delete cascade,
    blocked_id uuid not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id),
    constraint private_chat_blocks_distinct_users check (blocker_id <> blocked_id)
);

create index if not exists private_chat_blocks_blocked_idx
    on public.private_chat_blocks (blocked_id, blocker_id);

create table if not exists public.private_chat_reports (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid not null references public.users(id) on delete cascade,
    reported_user_id uuid not null references public.users(id) on delete cascade,
    conversation_id uuid not null references public.private_conversations(id) on delete cascade,
    message_id uuid references public.private_messages(id) on delete set null,
    reason text not null check (reason in ('spam', 'harassment', 'inappropriate', 'privacy', 'other')),
    details text,
    status text not null default 'pending' check (status in ('pending', 'reviewing', 'resolved', 'dismissed')),
    reviewed_by uuid references public.users(id) on delete set null,
    reviewed_at timestamptz,
    created_at timestamptz not null default now(),
    constraint private_chat_reports_distinct_users check (reporter_id <> reported_user_id),
    constraint private_chat_reports_details_length check (details is null or char_length(details) <= 1000)
);

create index if not exists private_chat_reports_status_created_idx
    on public.private_chat_reports (status, created_at desc);
create index if not exists private_chat_reports_reporter_created_idx
    on public.private_chat_reports (reporter_id, created_at desc);

create table if not exists public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.users(id) on delete cascade,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    user_agent text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint push_subscriptions_endpoint_length check (char_length(endpoint) between 10 and 2048),
    constraint push_subscriptions_key_length check (char_length(p256dh) between 20 and 512 and char_length(auth) between 8 and 256)
);

create index if not exists push_subscriptions_user_idx
    on public.push_subscriptions (user_id, updated_at desc);

alter table public.private_chat_blocks enable row level security;
alter table public.private_chat_reports enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on table public.private_chat_blocks from anon, authenticated;
revoke all on table public.private_chat_reports from anon, authenticated;
revoke all on table public.push_subscriptions from anon, authenticated;
grant all on table public.private_chat_blocks to service_role;
grant all on table public.private_chat_reports to service_role;
grant all on table public.push_subscriptions to service_role;

comment on table public.private_chat_blocks is 'Server-managed member blocks for private chat.';
comment on table public.private_chat_reports is 'Private chat abuse reports visible only to server-side moderation tools.';
comment on table public.push_subscriptions is 'Authenticated Web Push subscriptions for targeted notifications.';
