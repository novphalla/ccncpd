alter table if exists public.quiz_questions
    add column if not exists image_url text;

comment on column public.quiz_questions.image_url
    is 'Optional image URL shown with a quiz question.';

notify pgrst, 'reload schema';
