alter table public.live_meetings
    add column if not exists course_id uuid references public.courses(id) on delete set null;

create index if not exists live_meetings_course_id_idx
    on public.live_meetings(course_id);
