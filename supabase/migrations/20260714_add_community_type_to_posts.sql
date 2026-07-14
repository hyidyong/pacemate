ALTER TABLE public.posts
ADD COLUMN IF NOT EXISTS community_type text DEFAULT 'student';

UPDATE public.posts
SET community_type = 'student'
WHERE community_type IS NULL;

CREATE INDEX IF NOT EXISTS posts_community_type_idx
ON public.posts (community_type);
