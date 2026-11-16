alter table public.courses
    add column if not exists allow_download boolean not null default false;
