# Dock

A small tool for moving files and text between your own devices. Drop
something in on your phone, pick it up on your PC, or the other way
around.

## How it behaves

- Anything you add (a file or a block of text) shows up on your other
  devices within a few seconds, no setup beyond Redis required.
- Unsaved items are live, not permanent. They expire on their own
  after a while (24 hours by default — pick 1 hour, 24 hours, or 7 days
  per item from the dropdown), and disappear immediately if you press
  Remove.
- Pressing **Save** writes the item to Supabase for good, files go
  into Storage, text goes into the database. Saved items load on any
  device that opens the site, indefinitely.
- Removing a *saved* item moves it to **Trash** instead of deleting it
  outright — it still counts as saved and takes up storage until you
  delete it forever from the Trash tab, or restore it back.
- Files bigger than 4 MB skip the live relay (Redis isn't built for
  large blobs) and stay on the uploading device only, until you save
  them.
- You can paste files or text directly onto the page (Ctrl/Cmd+V), not
  just drag-and-drop, and there's a "Scan on another device" button
  that shows a QR code of the current page for quick phone access.
- The search box filters by name/text; "Load older…" pages further
  back through saved items and Trash instead of fetching everything at
  once.

Each item's badge tells you exactly which of the three states it's
in: **This device only**, **Live on your other devices**, **Saved**,
or **In Trash**.

## Setup

### 1. Live sharing (Upstash Redis) — start here

This is what makes phone and PC see each other. Takes about two
minutes and Supabase isn't required for it to work.

1. Create a free database at [upstash.com](https://upstash.com) (Redis).
2. Open the database, copy the **REST URL** and **REST Token**.
3. Copy `.env.local.example` to `.env.local` and paste them into
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

That's enough to run the app and share things between devices, for as
long as the TTL allows. Nothing else is required yet. This same Redis
instance is also used to rate-limit password attempts against `/gate`
(10 tries per 5 minutes per IP) — if Redis isn't configured, that
limit simply doesn't apply.

### 2. Permanent storage + Trash (Supabase) — optional, add later

Only needed for Save and Trash.

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run `supabase/schema.sql` from this repo.
   It creates the `dock_items` table (with a `deleted_at` column for
   Trash) and the private `dock-files` storage bucket.
3. Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in
   `.env.local` — both found under **Project Settings > API**. Use the
   **service_role** secret, not the anon/public key.

**Important:** `SUPABASE_SERVICE_ROLE_KEY` must never be prefixed with
`NEXT_PUBLIC_` and must never be sent to the browser. Every read,
write, and delete against Supabase happens inside this app's own API
routes (`app/api/saved/**`), using that key server-side — the browser
never talks to Supabase directly. Files are served through short-lived
signed URLs minted per request, not a public bucket URL.

> **Upgrading from an older version of Dock?** The previous schema
> used a client-side anon key with open Row Level Security policies —
> meaning anyone who pulled the app's public JS bundle could read,
> write, and delete everything in Supabase directly, bypassing the
> site's password gate entirely. `supabase/schema.sql` now includes a
> migration section at the bottom with the exact steps to lock an
> existing project down (drop the old policies, make the bucket
> private, switch env vars). Do that before relying on the gate again.

### Run it

```
npm install
npm run dev
```

## Deploying to Vercel

1. Push this project to a GitHub repo.
2. Import it in Vercel.
3. Add whichever environment variables you've set up (Redis first,
   Supabase whenever you're ready) in the Vercel project settings.
4. Deploy.

## A note on access

There's no login. The site works by having both your devices open the
same URL, so anyone who has that URL can read and write everything in
it. Unlike the original version, the underlying Supabase project is no
longer reachable on its own if someone extracts a key from the app's
JS — there is no client-side key to extract anymore. The site's shared
password (`SITE_PASSWORD`) is genuinely the only thing standing
between an unknown visitor and your data, so keep it private, don't
post the URL anywhere public, and add real per-user authentication if
that's ever not good enough for what you're sending.

## What's intentionally not here

A couple of ideas came up that didn't make it into this pass, on
purpose rather than by omission:

- **Multiple rooms/boards** (separate namespaces on one deployment) —
  touches the Redis keys, the Supabase schema, and the access model all
  at once. Worth doing as its own focused change rather than folded in
  here.
- **Web Share Target** (showing up in your phone's native share sheet)
  — only works for an installed PWA on Chrome/Android, and needs a
  dedicated endpoint to receive the shared payload. Straightforward to
  add later if it'd actually get used.

Both are reasonable follow-ups if you want them — just flagging that
this round focused on the security fix, Trash, and the
lower-effort/higher-payoff usability items.
