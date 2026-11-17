alter table public.private_messages
    add column if not exists reply_to_id uuid references public.private_messages(id) on delete set null,
    add column if not exists edited_at timestamptz,
    add column if not exists deleted_at timestamptz,
    add column if not exists attachment_key text,
    add column if not exists attachment_name text,
    add column if not exists attachment_type text,
    add column if not exists attachment_size bigint;

alter table public.private_messages
    alter column body set default '',
    drop constraint if exists private_messages_body_length;

alter table public.private_messages
    add constraint private_messages_content_check check (
        deleted_at is not null
        or char_length(btrim(body)) between 1 and 2000
        or attachment_key is not null
    ),
    add constraint private_messages_attachment_check check (
        (attachment_key is null and attachment_name is null and attachment_type is null and attachment_size is null)
        or (
            attachment_key is not null
            and attachment_name is not null
            and attachment_type is not null
            and attachment_size between 1 and 10485760
        )
    );

create index if not exists private_messages_reply_idx
    on public.private_messages (reply_to_id)
    where reply_to_id is not null;

create table if not exists public.private_message_reactions (
    message_id uuid not null references public.private_messages(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    emoji text not null check (emoji in ('👍', '❤️', '😂')),
    created_at timestamptz not null default now(),
    primary key (message_id, user_id)
);

create index if not exists private_message_reactions_message_idx
    on public.private_message_reactions (message_id, created_at);

create table if not exists public.private_conversation_settings (
    conversation_id uuid not null references public.private_conversations(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    muted boolean not null default false,
    archived_at timestamptz,
    updated_at timestamptz not null default now(),
    primary key (conversation_id, user_id)
);

create index if not exists private_conversation_settings_user_idx
    on public.private_conversation_settings (user_id, archived_at, updated_at desc);

create table if not exists public.private_chat_presence (
    user_id uuid primary key references public.users(id) on delete cascade,
    last_seen_at timestamptz not null default now()
);

create index if not exists private_chat_presence_seen_idx
    on public.private_chat_presence (last_seen_at desc);

alter table public.private_message_reactions enable row level security;
alter table public.private_conversation_settings enable row level security;
alter table public.private_chat_presence enable row level security;

revoke all on table public.private_message_reactions from anon, authenticated;
revoke all on table public.private_conversation_settings from anon, authenticated;
revoke all on table public.private_chat_presence from anon, authenticated;
grant all on table public.private_message_reactions to service_role;
grant all on table public.private_conversation_settings to service_role;
grant all on table public.private_chat_presence to service_role;

comment on table public.private_message_reactions is 'Server-managed emoji reactions for private messages.';
comment on table public.private_conversation_settings is 'Per-member mute and archive state for private conversations.';
comment on table public.private_chat_presence is 'Server-observed last activity for private chat presence.';
