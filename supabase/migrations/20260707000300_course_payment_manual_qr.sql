alter table public.course_enrollments add column if not exists payment_reference text;
alter table public.course_enrollments add column if not exists payment_provider text;
alter table public.course_enrollments add column if not exists payment_submitted_at timestamptz;

create index if not exists course_enrollments_payment_reference_idx
    on public.course_enrollments(payment_reference);
