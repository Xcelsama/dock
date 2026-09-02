-- Run this in the Supabase SQL editor for your project.

create table if not exists public.dock_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('text', 'image', 'pdf', 'zip', 'file')),
  name text not null,
  size bigint not null default 0,
  mime text,
  storage_path text,
  text_content text,
  created_at timestamptz not null default now()
);

alter table public.dock_items enable row level security;

-- This app has no login screen by design, it's a personal bridge between
-- your own devices. That means anyone with the anon key can read and
-- write this table. Keep the URL private, or add real auth if that's
-- ever not good enough for what you're sending.
create policy "anon read" on public.dock_items
  for select using (true);

create policy "anon insert" on public.dock_items
  for insert with check (true);

create policy "anon delete" on public.dock_items
  for delete using (true);

-- Storage bucket for uploaded files. Create it once, then apply the
-- policies below so the anon key can upload, read, and delete.
insert into storage.buckets (id, name, public)
values ('dock-files', 'dock-files', true)
on conflict (id) do nothing;

create policy "anon storage read" on storage.objects
  for select using (bucket_id = 'dock-files');

create policy "anon storage insert" on storage.objects
  for insert with check (bucket_id = 'dock-files');

create policy "anon storage delete" on storage.objects
  for delete using (bucket_id = 'dock-files');
