-- Run this in the Supabase SQL editor for your project.
--
-- If you're upgrading an existing Dock deployment from before the
-- security fix (server-side service role instead of a client-side anon
-- key), see the "Migrating an existing project" note at the bottom —
-- running this file as-is on a fresh project is all you need for a new
-- one.

create table if not exists public.dock_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('text', 'image', 'pdf', 'zip', 'file')),
  name text not null,
  size bigint not null default 0,
  mime text,
  storage_path text,
  text_content text,
  created_at timestamptz not null default now(),
  -- Set when an item is moved to Trash. Null means "active". Nothing
  -- purges these automatically — a permanent delete from the Trash view
  -- is what actually removes the row and its file.
  deleted_at timestamptz
);

alter table public.dock_items enable row level security;

-- No policies are defined here on purpose. This table is only ever
-- touched by the Next.js server using the Supabase *service role* key,
-- which bypasses RLS entirely — the browser never talks to Supabase
-- directly. That's what makes the site's password gate meaningful.
-- (The previous version of this schema granted "anon read/insert/delete"
-- policies for a client-side anon key. Because that key ships inside the
-- app's public JS bundle, those policies effectively let anyone who
-- pulled the bundle read, write, and delete everything here without
-- ever passing the password gate. Don't add anon/authenticated policies
-- back unless you're deliberately calling Supabase from the browser
-- again.)

-- Storage bucket for uploaded files. Private, not public: files are
-- only ever served through short-lived signed URLs minted by the
-- server (see lib/supabase-admin.ts), never a stable public bucket URL.
insert into storage.buckets (id, name, public)
values ('dock-files', 'dock-files', false)
on conflict (id) do update set public = false;

-- Again: no anon/authenticated policies on storage.objects. All
-- uploads, downloads, and deletes go through the service-role client.

-- ---------------------------------------------------------------------
-- Migrating an existing project (one that used the old anon-key setup)
-- ---------------------------------------------------------------------
-- 1. Add the new column:
--      alter table public.dock_items add column if not exists deleted_at timestamptz;
-- 2. Lock the bucket down:
--      update storage.buckets set public = false where id = 'dock-files';
-- 3. Drop the old open policies:
--      drop policy if exists "anon read" on public.dock_items;
--      drop policy if exists "anon insert" on public.dock_items;
--      drop policy if exists "anon delete" on public.dock_items;
--      drop policy if exists "anon storage read" on storage.objects;
--      drop policy if exists "anon storage insert" on storage.objects;
--      drop policy if exists "anon storage delete" on storage.objects;
-- 4. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to your environment
--    (Project Settings > API > service_role secret) and remove the old
--    NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY vars.
-- 5. Redeploy. Existing rows and files keep working — old storage paths
--    are still valid, they just get served via signed URL now instead
--    of a public one.
