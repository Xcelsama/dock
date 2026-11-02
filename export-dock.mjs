// Run from inside the Dock project folder:  node export-dock.mjs
// Downloads every row + file from Supabase into ./dock-export
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

const URL_ =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://byzryvzvhenkzdrezcih.supabase.co";

// If you set SUPABASE_SERVICE_ROLE_KEY in your terminal it is used first.
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_Ib8f7hTNOQH2bUx21F6SHA_YCsZn31Y";

const sb = createClient(URL_, KEY, { auth: { persistSession: false } });
const BUCKET = "dock-files";
const OUT = "dock-export";

await fs.mkdir(path.join(OUT, "files"), { recursive: true });

const { data: rows, error } = await sb
  .from("dock_items")
  .select("*")
  .order("created_at");

if (error) {
  console.error("DB ERROR:", error.message);
  process.exit(1);
}
if (!rows.length) {
  console.error(
    "0 rows. Either the table is empty, the project is still restricted, or RLS blocks this key (need the service_role key)."
  );
  process.exit(1);
}

await fs.writeFile(path.join(OUT, "items.json"), JSON.stringify(rows, null, 2));
console.log(`Saved ${rows.length} rows to ${OUT}/items.json`);

const withFiles = rows.filter((r) => r.storage_path);
let ok = 0, skipped = 0, failed = 0;

for (const r of withFiles) {
  const dest = path.join(OUT, "files", r.storage_path);
  try {
    await fs.access(dest);
    skipped++;
    continue;
  } catch {}
  const { data, error: dlErr } = await sb.storage.from(BUCKET).download(r.storage_path);
  if (dlErr || !data) {
    failed++;
    console.error("FAIL", r.storage_path, dlErr?.message);
    continue;
  }
  await fs.writeFile(dest, Buffer.from(await data.arrayBuffer()));
  ok++;
  console.log(`ok ${ok + skipped}/${withFiles.length}`, r.storage_path);
}

console.log(`\nDone. downloaded ${ok}, skipped ${skipped}, failed ${failed}`);
