-- Public bucket for the engine's hero data. The daily GitHub Action uploads
-- snapshot.json (latest) and daily/<date>.json (one copy per day) with the
-- service key; anyone can read them through the public URL, and there are no
-- policies, so nobody else can write.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hero-data', 'hero-data', true, 52428800, array['application/json'])
on conflict (id) do nothing;
