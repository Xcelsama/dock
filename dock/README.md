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
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   as environment variables in the Vercel project settings.
4. Deploy.

## A note on access

There's no login. The site works by having both your devices open the
same URL, so anyone who has that URL can read and write everything in
it. That's fine for a private link only you use, but don't post the
URL anywhere public, and add real authentication if you ever plan to.
