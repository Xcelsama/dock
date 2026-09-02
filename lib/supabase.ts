import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

// If env vars are missing, we still export a client-shaped object so the
// rest of the app doesn't need to branch everywhere. Calls will simply
// fail, and the UI already treats "not configured" as a distinct state.
export const supabase = supabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;

export const BUCKET = "dock-files";
export const TABLE = "dock_items";
