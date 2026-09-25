# Dock

A small tool for moving files and text between your own devices. Drop
something in on your phone, pick it up on your PC, or the other way
around. 

## How it behaves

- Anything you add (a file or a block of text) shows up in the list
  immediately and stays there while you're on the page.
- If you refresh or close the tab without saving, it's gone. Nothing
  is written anywhere unless you press **Save** on that item.
- Pressing Save uploads the file to Supabase Storage (or writes the
  text to the database) and marks the item as saved. Saved items load
  back in on any device that opens the site.
- Removing a saved item deletes it from Supabase too.

## Setup

1. Create a project at supabase.com.
2. Open the SQL editor and run `supabase/schema.sql` from this repo.
   It creates the `dock_items` table, the `dock-files` storage bucket,
   and the access policies both need.
3. Copy `.env.local.example` to `.env.local` and fill in your project
   URL and anon key, both found under Project Settings > API.
4. Install dependencies and run locally:

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
