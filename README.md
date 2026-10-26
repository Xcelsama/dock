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
- Files bigger than 3 MB skip the live relay (Redis isn't built for
  large blobs) and stay on the uploading device only. Use **Send** to
  move those directly (see below) or **Save** to keep them.
- You can drop or paste files **anywhere on the page** (Ctrl/Cmd+V works
  for screenshots, copied images, and files copied from your file
  manager, even while the text box is focused). Pasted screenshots get
  a proper timestamped name. Dropping a folder shows a hint to zip it
  first instead of failing silently.
- **Live sync** (checkbox next to the search box) controls whether new
  items are copied to your other devices through the relay. Turn it off
  to keep everything on the device it was added on and move things only
  with Send or Save.
- The list shows **today and yesterday** (by your device's calendar),
  plus anything you've pinned. That keeps the first load small however
  much you've saved. **Show older items** at the bottom brings back
  everything else, a page at a time.
- **Pin** keeps an item at the top of the list, in its own **Pinned**
  section, however old it gets and on every device. Pinning something
  that isn't saved yet saves it first (a pin has to live somewhere
  permanent), so it needs Supabase. Pressing **Unpin** puts it back in
  the normal list. Trashing a pinned item keeps its pin, so Restore puts
  it back at the top.
- The search box filters by name/text. It looks through what's on screen;
  if nothing from today or yesterday matches, it offers **Show older
  items** so you can search further back.

Each item's badge tells you exactly which of the three states it's
in: **This device only**, **Live on your other devices**, **Saved**,
or **In Trash**.

## Send to another device (QR, direct)

Press **Send** on any item (or **Send to device** at the top) and a QR
code appears. Scan it with the other device's camera, it opens Dock and
connects, and the file goes straight from one device to the other.
**The file is never uploaded to Redis or Supabase.** It travels over an
encrypted peer-to-peer (WebRTC) connection. No hotspot or shared Wi-Fi
is needed; the two devices only need internet access.

- No camera? The code under the QR can be typed on the other device
  (**Send to another device > type the code**).
- Once connected, **either device can send**, and you can keep sending
  more files without scanning again. Closing the page ends the session.
- After every successful transfer a popup on both devices asks whether to
  **Save to Dock** (permanent copy in Supabase) or, on the receiving
  device, **Download** it. If you do nothing, the file only exists in
  that browser tab until you close it.
- Direct transfers work for files up to 1 GB, but the receiving browser
  holds the file in memory, so very large files can be a stretch on
  phones. Keep the page open and the screen on while it moves (Dock
  requests a screen wake lock while paired where the browser allows it).
- Pairing codes are single-use, expire after 5 minutes, and only relay
  the connection set-up (a few KB) through Upstash Redis. That is why
  Redis is required for this feature.

**When it can't connect:** most home, office and mobile networks work
with the free public STUN servers Dock uses by default. Some mobile
carriers and corporate networks block direct connections, and those
pairs need a TURN relay. Set `TURN_URLS`, `TURN_USERNAME` and
`TURN_CREDENTIAL` (see `.env.local.example`) with credentials from any
TURN provider. The traffic stays end-to-end encrypted; the relay just
forwards it. Without TURN, Dock shows a clear message instead of hanging.

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
   Trash and a `pinned_at` column for pins), its indexes, and the
   private `dock-files` storage bucket.
3. Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in
   `.env.local` — both found under **Project Settings > API**. Use the
   **service_role** secret, not the anon/public key.

**Important:** `SUPABASE_SERVICE_ROLE_KEY` must never be prefixed with
`NEXT_PUBLIC_` and must never be sent to the browser. Every read,
write, and delete against Supabase happens inside this app's own API
routes (`app/api/saved/**`), using that key server-side — the browser
never talks to Supabase directly. Files are served through `/api/saved/<id>/file`, which mints a
short-lived signed URL on demand and redirects to it, so there is no
public bucket URL and nothing signed is ever stored or listed.

> **Already running Dock, and adding pinning?** Run
> `supabase/pin-migration.sql` once in the Supabase SQL editor. It adds
> the `pinned_at` column and two small indexes, and is safe to run
> again. Until you do, Dock keeps working as before; pressing Pin just
> explains that this one-time update is needed.

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

## Performance notes

What makes the first load quick, roughly in order of how much it matters:

- **One request instead of three.** Opening the page used to call
  `/api/config`, `/api/items` and `/api/saved` separately, and on a
  serverless host each could be its own cold start. `/api/bootstrap` now
  answers all of it at once, asking Redis and Supabase side by side.
- **It starts before the app's code has loaded.** A tiny script in
  `app/layout.tsx` fires that request the moment the HTML arrives, so the
  answer is usually waiting by the time the page is ready to draw it.
- **Only today, yesterday and pins are loaded.** Older saved items and
  older live items stay on the server until you press **Show older
  items**. Pinned items are always included, whatever their age.
- **Files aren't downloaded just to draw the list.** The live list used to
  carry every file's full contents (up to several MB each), on every page
  load. Now it carries names and sizes only. A file's bytes are fetched
  from `/api/items/<id>/content` when it's previewed, downloaded, saved
  or sent, and the browser keeps what it has fetched.
- **Fewer round trips to Redis.** Metadata for all live items is read in
  one call (it was one call per item, one after another), and sharing an
  item is one round trip instead of two.
- **No bare "Loading…".** The list has its final shape from the first
  paint (placeholder rows), and the rows themselves only re-render when
  their own item changes, so typing in the search box stays smooth.
- **Database indexes** for the two lists the home screen asks for (see
  `supabase/schema.sql`).

Things that were already in place:

- The saved list doesn't ask Supabase for a signed URL per item on every
  poll. File links are stable same-origin paths that browsers can cache,
  so images stop re-downloading every few seconds.
- Devices only re-fetch the saved list when something actually changed
  (a version counter in Redis), instead of on every poll.
- Polling pauses while the tab is hidden, relaxes from 4 s to 12 s while
  nothing changes, and refreshes immediately when you come back.
- Your last list (today, yesterday and pins) is cached in the browser
  (`localStorage`, names and text only, never file contents) so repeat
  visits paint instantly while fresh data loads. Clearing site data
  clears it.
- The QR library and pairing UI load only when you open the pairing
  sheet.

One thing no code change can do for you: keep your servers close to your
data. In Vercel's project settings, set the **Function Region** to the
region your Supabase project and Upstash database are in (their
dashboards say where). If the function runs on another continent from
the database, every query pays that distance, and for a phone on a slow
connection it adds up.

## Known limits

- **Saving files over ~4.5 MB** from the browser fails when hosted on
  Vercel (its request-body cap applies to `/api/saved`). Dock shows a
  clear message and the file stays on the device; Download keeps it.
  Direct transfers themselves are not affected. Lifting this means
  uploading straight to Supabase Storage with signed upload URLs.

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
- **An in-app QR scanner** (the phone's own camera app already opens the
  link, which covers most cases). Needs `BarcodeDetector`, which iOS
  Safari lacks.
- **Web Share Target** (showing up in your phone's native share sheet)
  — only works for an installed PWA on Chrome/Android, and needs a
  dedicated endpoint to receive the shared payload. Straightforward to
  add later if it'd actually get used.

Both are reasonable follow-ups if you want them — just flagging that
this round focused on the security fix, Trash, and the
lower-effort/higher-payoff usability items.
