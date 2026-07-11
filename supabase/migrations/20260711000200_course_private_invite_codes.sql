create extension if not exists pgcrypto;

create table if not exists public.course_invite_codes (
    id uuid primary key default gen_random_uuid(),
    course_id uuid not null references public.courses(id) on delete cascade,
    code text not null,
    description text,
    max_uses integer,
    used_count integer not null default 0,
    starts_at timestamptz,
    expires_at timestamptz,
    is_active boolean not null default true,
    auto_enroll boolean not null default false,
    created_by uuid references public.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists course_invite_codes_code_unique_idx
    on public.course_invite_codes(lower(code));

create index if not exists course_invite_codes_course_id_idx
    on public.course_invite_codes(course_id);

create index if not exists course_invite_codes_is_active_idx
    on public.course_invite_codes(is_active);

create table if not exists public.course_invite_redemptions (
    id uuid primary key default gen_random_uuid(),
    code_id uuid not null references public.course_invite_codes(id) on delete cascade,
    course_id uuid not null references public.courses(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    redeemed_at timestamptz not null default now()
);

create unique index if not exists course_invite_redemptions_code_user_unique_idx
    on public.course_invite_redemptions(code_id, user_id);

create unique index if not exists course_invite_redemptions_course_user_unique_idx
    on public.course_invite_redemptions(course_id, user_id);

create index if not exists course_invite_redemptions_user_id_idx
    on public.course_invite_redemptions(user_id);

alter table public.course_invite_codes enable row level security;
alter table public.course_invite_redemptions enable row level security;

drop policy if exists "Authenticated users can check active invite codes" on public.course_invite_codes;
drop policy if exists "Admins can manage invite codes" on public.course_invite_codes;
drop policy if exists "Users can read own invite redemptions" on public.course_invite_redemptions;
drop policy if exists "Users can redeem invite codes" on public.course_invite_redemptions;
drop policy if exists "Admins can manage invite redemptions" on public.course_invite_redemptions;

create policy "Admins can manage invite codes"
on public.course_invite_codes
for all
using (
    exists (
        select 1 from public.users
        where users.id = auth.uid()
          and users.role in ('admin', 'owner')
    )
)
with check (
    exists (
        select 1 from public.users
        where users.id = auth.uid()
          and users.role in ('admin', 'owner')
    )
);

create policy "Users can read own invite redemptions"
on public.course_invite_redemptions
for select
using (user_id = auth.uid());

create policy "Users can redeem invite codes"
on public.course_invite_redemptions
for insert
with check (user_id = auth.uid());

create policy "Admins can manage invite redemptions"
on public.course_invite_redemptions
for all
using (
    exists (
        select 1 from public.users
        where users.id = auth.uid()
          and users.role in ('admin', 'owner')
    )
)
with check (
    exists (
        select 1 from public.users
        where users.id = auth.uid()
          and users.role in ('admin', 'owner')
    )
);

create or replace function public.handle_course_invite_redemption()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    invite_record public.course_invite_codes%rowtype;
begin
    select *
    into invite_record
    from public.course_invite_codes
    where id = new.code_id
    for update;

    if not found then
        raise exception 'Invite code not found';
    end if;

    if invite_record.course_id <> new.course_id then
        raise exception 'Invite code does not match this course';
    end if;

    if invite_record.is_active is not true then
        raise exception 'Invite code is not active';
    end if;

    if invite_record.starts_at is not null and invite_record.starts_at > now() then
        raise exception 'Invite code is not open yet';
    end if;

    if invite_record.expires_at is not null and invite_record.expires_at < now() then
        raise exception 'Invite code has expired';
    end if;

    if invite_record.max_uses is not null and invite_record.used_count >= invite_record.max_uses then
        raise exception 'Invite code usage limit reached';
    end if;

    update public.course_invite_codes
    set used_count = used_count + 1,
        updated_at = now()
    where id = new.code_id;

    return new;
end;
$$;

drop trigger if exists course_invite_redemption_after_insert
on public.course_invite_redemptions;

create trigger course_invite_redemption_after_insert
after insert on public.course_invite_redemptions
for each row
execute function public.handle_course_invite_redemption();

create or replace function public.redeem_course_invite_code(p_invite_code text)
returns table(course_id uuid, auto_enroll boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
    invite_record public.course_invite_codes%rowtype;
    already_redeemed boolean;
begin
    if auth.uid() is null then
        raise exception 'Authentication required';
    end if;

    if p_invite_code is null or trim(p_invite_code) !~ '^[0-9]{4}$' then
        raise exception 'Invalid invite code';
    end if;

    select *
    into invite_record
    from public.course_invite_codes
    where lower(code) = lower(trim(p_invite_code))
      and is_active = true
    for update;

    if not found then
        raise exception 'Invalid invite code';
    end if;

    select exists (
        select 1
        from public.course_invite_redemptions
        where course_invite_redemptions.course_id = invite_record.course_id
          and course_invite_redemptions.user_id = auth.uid()
    )
    into already_redeemed;

    if already_redeemed then
        course_id := invite_record.course_id;
        auto_enroll := invite_record.auto_enroll;
        return next;
        return;
    end if;

    if invite_record.starts_at is not null and invite_record.starts_at > now() then
        raise exception 'Invite code is not open yet';
    end if;

    if invite_record.expires_at is not null and invite_record.expires_at < now() then
        raise exception 'Invite code has expired';
    end if;

    if invite_record.max_uses is not null and invite_record.used_count >= invite_record.max_uses then
        raise exception 'Invite code usage limit reached';
    end if;

    insert into public.course_invite_redemptions (code_id, course_id, user_id)
    values (invite_record.id, invite_record.course_id, auth.uid())
    on conflict (course_id, user_id) do nothing;

    course_id := invite_record.course_id;
    auto_enroll := invite_record.auto_enroll;
    return next;
end;
$$;

revoke all on function public.redeem_course_invite_code(text) from public;
grant execute on function public.redeem_course_invite_code(text) to authenticated;
