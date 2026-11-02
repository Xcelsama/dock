"use client";

import { useCallback, useEffect, useState } from "react";
import type { SavedRecord } from "@/lib/types";
import { formatBytes } from "@/lib/format";

// Files saved in the old Supabase project, before Dock moved to R2.
// Read-only. If Supabase is still restricted this page just shows the error;
// the rest of Dock is unaffected.

export default function LegacyPage() {
  const [items, setItems] = useState<SavedRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: "50" });
      if (before) qs.set("before", before);
      const res = await fetch(`/api/legacy?${qs.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't load old files.");
      if (body.configured === false) {
        throw new Error("The old Supabase project isn't configured on this deployment.");
      }
      setItems((prev) => (before ? [...prev, ...body.items] : body.items));
      setHasMore(Boolean(body.hasMore));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load old files.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function copyText(item: SavedRecord) {
    if (!item.textContent) return;
    try {
      await navigator.clipboard.writeText(item.textContent);
      setCopied(item.id);
      setTimeout(() => setCopied((c) => (c === item.id ? null : c)), 1500);
    } catch {
      // clipboard blocked: nothing to do
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium text-ink">Old files</h1>
        <a href="/" className="text-sm text-muted hover:text-ink">
          Back to Dock
        </a>
      </div>
      <p className="text-xs text-faint">
        Items saved in the old Supabase project. Open or download them from here; new saves go to R2.
      </p>

      {error && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          {error}{" "}
          <button className="underline" onClick={() => load()}>
            Try again
          </button>
        </div>
      )}

      <ul className="divide-y divide-border rounded-md border border-border bg-surface">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate text-ink">
                {item.name}
                {item.deletedAt ? <span className="ml-2 text-xs text-faint">(was in Trash)</span> : null}
              </p>
              <p className="text-xs text-faint">
                {item.kind} · {formatBytes(item.size)} · {new Date(item.createdAt).toLocaleDateString()}
              </p>
            </div>
            {item.remoteUrl ? (
              <>
                <a
                  href={item.remoteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-ink"
                >
                  Open
                </a>
                <a
                  href={`${item.remoteUrl}?download=1`}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-ink"
                >
                  Download
                </a>
              </>
            ) : item.textContent ? (
              <button
                onClick={() => copyText(item)}
                className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-ink"
              >
                {copied === item.id ? "Copied" : "Copy text"}
              </button>
            ) : null}
          </li>
        ))}
        {!loading && !error && items.length === 0 && (
          <li className="px-3 py-6 text-center text-xs text-faint">Nothing in the old project.</li>
        )}
        {loading && <li className="px-3 py-6 text-center text-xs text-faint">Loading…</li>}
      </ul>

      {hasMore && !loading && (
        <button
          onClick={() => load(items[items.length - 1]?.createdAt)}
          className="w-full rounded-md border border-border py-2 text-sm text-muted hover:text-ink"
        >
          Show more
        </button>
      )}
    </main>
  );
}
