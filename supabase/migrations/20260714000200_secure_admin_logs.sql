alter table if exists public.admin_logs enable row level security;

revoke all on table public.admin_logs from anon;
revoke all on table public.admin_logs from authenticated;