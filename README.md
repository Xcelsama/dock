# Dock

A small tool for moving files and text between your own devices. Drop
something in on your phone, pick it up on your PC, or the other way
around.

## How it behaves

- Anything you add (a file or a block of text) shows up on your other
  devices within a few seconds, no setup beyond Redis required.
- Unsaved items are live, not permanent. They expire on their own
  after a while (24 hours by default), and disappear immediately if
  you press Remove.
- Pressing **Save** writes the item to Supabase for good, files go
  into Storage, text goes into the database. Saved items load on any
  device that opens the site, indefinitely.
- Files bigger than 4 MB skip the live relay (Redis isn't built for
  large blobs) and stay on the uploading device only, until you save
  them.

Each item's badge tells you exactly which of the three states it's
in: **This device only**, **Live on your other devices**, or **Saved**.

## Setup

### 1. Live sharing (Upstash Redis) — start here

This is what makes phone and PC see each other. Takes about two
minutes and Supabase isn't required for it to work.

1. Create a free database at [upstash.com](https://upstash.com) (Redis).
2. Open the database, copy the **REST URL** and **REST Token**.
3. Copy `.env.local.example` to `.env.local` and paste them into
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

That's enough to run the app and share things between devices, for as
long as the TTL allows. Nothing else is required yet.

### 2. Permanent storage (Supabase) — optional, add later

Only needed for the Save button.

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run `supabase/schema.sql` from this repo.
   It creates the `dock_items` table, the `dock-files` storage bucket,
   and the access policies both need.
3. Fill in `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   in `.env.local`, both found under Project Settings > API.

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
it. That's fine for a private link only you use, but don't post the
URL anywhere public, and add real authentication if you ever plan to.
