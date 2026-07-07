create extension if not exists pgcrypto;

create table if not exists public.course_enrollments (
    id uuid primary key default gen_random_uuid(),
    course_id uuid not null references public.courses(id) on delete cascade,
    user_id uuid not null references public.users(id) on delete cascade,
    status text not null default 'registered'
        check (status in ('registered', 'pending_payment', 'approved', 'rejected', 'cancelled', 'completed')),
    pricing_type text not null default 'free'
        check (pricing_type in ('free', 'paid')),
    price numeric(12, 2) not null default 0,
    original_price numeric(12, 2) not null default 0,
    discount_amount numeric(12, 2) not null default 0,
    final_price numeric(12, 2) not null default 0,
    currency text not null default 'KHR',
    payment_status text not null default 'not_required'
        check (payment_status in ('not_required', 'pending', 'approved', 'rejected', 'waived')),
    coupon_id uuid,
    coupon_code text,
    payment_proof_url text,
    payment_note text,
    waiver_reason text,
    waived_at timestamptz,
    waived_by uuid references public.users(id),
    registered_at timestamptz not null default now(),
    approved_at timestamptz,
    approved_by uuid references public.users(id),
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (course_id, user_id)
);

create index if not exists course_enrollments_course_id_idx on public.course_enrollments(course_id);
create index if not exists course_enrollments_user_id_idx on public.course_enrollments(user_id);
create index if not exists course_enrollments_status_idx on public.course_enrollments(status);

alter table public.course_enrollments add column if not exists original_price numeric(12, 2) not null default 0;
alter table public.course_enrollments add column if not exists discount_amount numeric(12, 2) not null default 0;
alter table public.course_enrollments add column if not exists final_price numeric(12, 2) not null default 0;
alter table public.course_enrollments add column if not exists coupon_id uuid;
alter table public.course_enrollments add column if not exists coupon_code text;
alter table public.course_enrollments add column if not exists waiver_reason text;
alter table public.course_enrollments add column if not exists waived_at timestamptz;
alter table public.course_enrollments add column if not exists waived_by uuid references public.users(id);

do $$
begin
    if exists (
        select 1 from pg_constraint
        where conname = 'course_enrollments_payment_status_check'
          and conrelid = 'public.course_enrollments'::regclass
    ) then
        alter table public.course_enrollments drop constraint course_enrollments_payment_status_check;
    end if;
end $$;

alter table public.course_enrollments
    add constraint course_enrollments_payment_status_check
    check (payment_status in ('not_required', 'pending', 'approved', 'rejected', 'waived'));

create table if not exists public.course_coupons (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    description text,
    course_id uuid references public.courses(id) on delete cascade,
    discount_type text not null default 'percent'
        check (discount_type in ('percent', 'amount')),
    discount_value numeric(12, 2) not null default 0,
    currency text not null default 'KHR',
    max_uses integer,
    used_count integer not null default 0,
    starts_at timestamptz,
    expires_at timestamptz,
    is_active boolean not null default true,
    created_by uuid references public.users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists course_coupons_code_idx on public.course_coupons(code);
create index if not exists course_coupons_course_id_idx on public.course_coupons(course_id);
create index if not exists course_coupons_is_active_idx on public.course_coupons(is_active);

create table if not exists public.access_attempts (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references public.users(id) on delete set null,
    course_id uuid references public.courses(id) on delete cascade,
    reason text not null,
    created_at timestamptz not null default now()
);

create index if not exists access_attempts_user_id_idx on public.access_attempts(user_id);
create index if not exists access_attempts_course_id_idx on public.access_attempts(course_id);
create index if not exists access_attempts_created_at_idx on public.access_attempts(created_at desc);
