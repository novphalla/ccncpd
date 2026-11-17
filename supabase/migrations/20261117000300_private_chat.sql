create table if not exists public.private_conversations (
    id uuid primary key default gen_random_uuid(),
    participant_one uuid not null references public.users(id) on delete cascade,
    participant_two uuid not null references public.users(id) on delete cascade,
    last_message_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint private_conversations_distinct_participants check (participant_one <> participant_two),
    constraint private_conversations_ordered_participants check (participant_one < participant_two),
    unique (participant_one, participant_two)
);

create table if not exists public.private_messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.private_conversations(id) on delete cascade,
    sender_id uuid not null references public.users(id) on delete cascade,
    body text not null,
    read_at timestamptz,
    created_at timestamptz not null default now(),
    constraint private_messages_body_length check (char_length(btrim(body)) between 1 and 2000)
);

create index if not exists private_conversations_one_recent_idx
    on public.private_conversations (participant_one, last_message_at desc);
create index if not exists private_conversations_two_recent_idx
    on public.private_conversations (participant_two, last_message_at desc);
create index if not exists private_messages_conversation_created_idx
    on public.private_messages (conversation_id, created_at desc);
create index if not exists private_messages_unread_idx
    on public.private_messages (conversation_id, sender_id, created_at)
    where read_at is null;

create or replace function public.touch_private_conversation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    update public.private_conversations
       set last_message_at = new.created_at
     where id = new.conversation_id;
    return new;
end;
$$;

drop trigger if exists private_messages_touch_conversation on public.private_messages;
create trigger private_messages_touch_conversation
    after insert on public.private_messages
    for each row execute function public.touch_private_conversation();

alter table public.private_conversations enable row level security;
alter table public.private_messages enable row level security;
revoke all on table public.private_conversations from anon, authenticated;
revoke all on table public.private_messages from anon, authenticated;
grant all on table public.private_conversations to service_role;
grant all on table public.private_messages to service_role;

comment on table public.private_conversations is 'Server-managed one-to-one member conversations.';
comment on table public.private_messages is 'Server-managed private chat messages.';
