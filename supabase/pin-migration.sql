-- Run this once in the Supabase SQL editor if your Dock project was set up
-- before pinning existed. A brand-new project doesn't need it:
-- supabase/schema.sql already includes everything below.
--
-- Safe to run more than once.

-- 1. Pinning. Pinned items are always loaded and shown at the top of the
--    list, however old they are. Null means "not pinned".
alter table public.dock_items add column if not exists pinned_at timestamptz;

-- 2. Indexes for the two lists the home screen asks for on every load:
--    recent items (today and yesterday) and the pinned items. They only
--    cover active rows, so Trash doesn't make them bigger.
create index if not exists dock_items_recent_idx
  on public.dock_items (created_at desc)
  where deleted_at is null;

create index if not exists dock_items_pinned_idx
  on public.dock_items (pinned_at desc)
  where pinned_at is not null and deleted_at is null;

-- 3. Make sure the API notices the new column straight away.
notify pgrst, 'reload schema';
