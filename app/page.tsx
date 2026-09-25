"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Dropzone from "@/components/Dropzone";
import TextComposer from "@/components/TextComposer";
import ItemRow from "@/components/ItemRow";
import ShareQr from "@/components/ShareQr";
import { DockItem, RelayRecord, SavedRecord } from "@/lib/types";
import { kindFromFile } from "@/lib/format";
import { fileToBase64, base64ToBlob } from "@/lib/base64";
import { MAX_BROADCAST_BYTES } from "@/lib/relay-limits";

const POLL_MS = 4000;

const TTL_OPTIONS = [
  { label: "1 hour", value: 60 * 60 },
  { label: "24 hours", value: 24 * 60 * 60 },
  { label: "7 days", value: 7 * 24 * 60 * 60 },
];

function uid() {
  return crypto.randomUUID();
}

function mapSavedRecord(row: SavedRecord): DockItem {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    size: row.size,
    mime: row.mime,
    createdAt: row.createdAt,
    saved: true,
    broadcast: false,
    deletedAt: row.deletedAt,
    saving: false,
    removing: false,
    error: null,
    localUrl: null,
    file: null,
    text: row.textContent,
    content: null,
    remoteUrl: row.remoteUrl,
    storageId: row.id,
    storagePath: row.storagePath,
  };
}

export default function Page() {
  const [view, setView] = useState<"home" | "trash">("home");
  // Kept as a ref so the polling interval below (set up once on mount)
  // always checks the current tab without needing to be torn down and
  // rebuilt every time the user switches tabs.
  const viewRef = useRef(view);
  viewRef.current = view;

  const [query, setQuery] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState(TTL_OPTIONS[1].value);

  const [items, setItems] = useState<Record<string, DockItem>>({});
  const [loading, setLoading] = useState(true);
  const [liveConfigured, setLiveConfigured] = useState(true);
  const [supabaseConfigured, setSupabaseConfigured] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMoreSaved, setHasMoreSaved] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const savedCursorRef = useRef<string | null>(null);

  const [trashItems, setTrashItems] = useState<Record<string, DockItem>>({});
  const [trashLoading, setTrashLoading] = useState(false);
  const [hasMoreTrash, setHasMoreTrash] = useState(false);
  const trashRef = useRef(trashItems);
  trashRef.current = trashItems;
  const trashCursorRef = useRef<string | null>(null);

  const upsert = useCallback((next: DockItem, overwrite = true) => {
    setItems((prev) => {
      if (prev[next.id] && !overwrite) return prev;
      const existing = prev[next.id];
      return {
        ...prev,
        [next.id]: existing ? { ...existing, ...next } : next,
      };
    });
  }, []);

  const drop = useCallback((id: string) => {
    setItems((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  // Pull the permanent (non-trashed) list from our own API — never
  // Supabase directly, see lib/supabase-admin.ts for why. `more: true`
  // pages further back in time; a plain call refreshes the newest page
  // without disturbing how far "Load more" has already gone.
  const loadSaved = useCallback(
    async (opts?: { more?: boolean }) => {
      const more = opts?.more ?? false;
      const before = more ? savedCursorRef.current : null;
      const qs = new URLSearchParams();
      if (before) qs.set("before", before);

      const res = await fetch(`/api/saved?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error) setLoadError(body.error);
        return;
      }
      const { items: records, hasMore } = (await res.json()) as {
        items: SavedRecord[];
        hasMore: boolean;
      };

      for (const row of records) {
        upsert(mapSavedRecord(row), true);
      }

      if (more || savedCursorRef.current === null) {
        if (records.length) {
          savedCursorRef.current = records[records.length - 1].createdAt;
        }
        setHasMoreSaved(hasMore);
      }
    },
    [upsert]
  );

  // Pull whatever's currently live in the relay. Items already known
  // locally (added on this device) are left alone so we don't clobber
  // the in-memory File or object URL they carry.
  const loadLive = useCallback(async () => {
    const known = Object.keys(itemsRef.current);
    const qs = known.length ? `?known=${known.join(",")}` : "";
    const res = await fetch(`/api/items${qs}`, { cache: "no-store" });
    if (!res.ok) return;
    const { items: records } = (await res.json()) as { items: RelayRecord[] };

    for (const record of records) {
      const current = itemsRef.current[record.id];
      if (current) continue;

      upsert(
        {
          id: record.id,
          kind: record.kind,
          name: record.name,
          size: record.size,
          mime: record.mime,
          createdAt: record.createdAt,
          saved: false,
          broadcast: true,
          deletedAt: null,
          saving: false,
          removing: false,
          error: null,
          localUrl: null,
          file: null,
          text: record.text,
          content: record.content,
          remoteUrl: null,
          storageId: null,
          storagePath: null,
        },
        false
      );
    }
  }, [upsert]);

  const loadTrash = useCallback(async (opts?: { more?: boolean }) => {
    const more = opts?.more ?? false;
    const before = more ? trashCursorRef.current : null;
    const qs = new URLSearchParams({ trash: "1" });
    if (before) qs.set("before", before);

    setTrashLoading(true);
    try {
      const res = await fetch(`/api/saved?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const { items: records, hasMore } = (await res.json()) as {
        items: SavedRecord[];
        hasMore: boolean;
      };

      setTrashItems((prev) => {
        const next = more ? { ...prev } : {};
        for (const row of records) next[row.id] = mapSavedRecord(row);
        return next;
      });

      if (records.length) {
        trashCursorRef.current = records[records.length - 1].createdAt;
      }
      setHasMoreTrash(hasMore);
    } finally {
      setTrashLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view !== "trash") return;
    trashCursorRef.current = null;
    loadTrash();
  }, [view, loadTrash]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const configRes = await fetch("/api/config").catch(() => null);
      if (configRes?.ok) {
        const { redisConfigured, supabaseConfigured: sbConfigured } = await configRes.json();
        if (!cancelled) {
          setLiveConfigured(redisConfigured);
          setSupabaseConfigured(sbConfigured);
        }
      }
      await Promise.all([loadSaved(), loadLive()]);
      if (!cancelled) setLoading(false);
    }

    init();

    const interval = setInterval(() => {
      if (viewRef.current !== "home") return;
      loadSaved();
      loadLive();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const broadcast = useCallback(
    async (record: RelayRecord, itemTtlSeconds: number) => {
      try {
        const res = await fetch("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...record, ttlSeconds: itemTtlSeconds }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          upsert({ ...itemsRef.current[record.id], broadcast: false, error: body.error ?? "Couldn't share live." } as DockItem);
          return;
        }
        upsert({ ...itemsRef.current[record.id], broadcast: true } as DockItem);
      } catch {
        upsert({ ...itemsRef.current[record.id], broadcast: false, error: "Couldn't reach the live relay." } as DockItem);
      }
    },
    [upsert]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = uid();
        const createdAt = new Date().toISOString();
        const kind = kindFromFile(file);

        upsert({
          id,
          kind,
          name: file.name,
          size: file.size,
          mime: file.type || null,
          createdAt,
          saved: false,
          broadcast: false,
          deletedAt: null,
          saving: false,
          removing: false,
          error: null,
          localUrl: URL.createObjectURL(file),
          file,
          text: null,
          content: null,
          remoteUrl: null,
          storageId: null,
          storagePath: null,
        });

        if (file.size <= MAX_BROADCAST_BYTES) {
          fileToBase64(file).then((content) => {
            broadcast(
              {
                id,
                kind,
                name: file.name,
                size: file.size,
                mime: file.type || null,
                createdAt,
                text: null,
                content,
              },
              ttlSeconds
            );
          });
        } else {
          upsert({
            ...itemsRef.current[id],
            error: "Too large to share live, save it to send it across.",
          } as DockItem);
        }
      }
    },
    [upsert, broadcast, ttlSeconds]
  );

  const addText = useCallback(
    (text: string) => {
      const id = uid();
      const createdAt = new Date().toISOString();
      const size = new Blob([text]).size;
      const name = text.length > 40 ? `${text.slice(0, 40)}…` : text;

      upsert({
        id,
        kind: "text",
        name,
        size,
        mime: "text/plain",
        createdAt,
        saved: false,
        broadcast: false,
        deletedAt: null,
        saving: false,
        removing: false,
        error: null,
        localUrl: null,
        file: null,
        text,
        content: null,
        remoteUrl: null,
        storageId: null,
        storagePath: null,
      });

      broadcast({ id, kind: "text", name, size, mime: "text/plain", createdAt, text, content: null }, ttlSeconds);
    },
    [upsert, broadcast, ttlSeconds]
  );

  // Global paste-to-add: lets you paste a screenshot or a block of text
  // straight onto the page instead of only dragging files in. Skipped
  // while focus is inside an actual text field (the composer textarea,
  // the gate's password box) so normal typing/pasting there isn't
  // hijacked, and skipped outside the Home tab since there's nothing to
  // add items to from Trash.
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  const addTextRef = useRef(addText);
  addTextRef.current = addText;

  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (viewRef.current !== "home") return;

      const dt = e.clipboardData;
      if (!dt) return;

      const files = Array.from(dt.files ?? []);
      if (files.length) {
        e.preventDefault();
        addFilesRef.current(files);
        return;
      }

      const text = dt.getData("text/plain");
      if (text.trim()) {
        e.preventDefault();
        addTextRef.current(text.trim());
      }
    }

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const saveItem = useCallback(
    async (id: string) => {
      const item = itemsRef.current[id];
      if (!item || item.saved) return;

      if (!supabaseConfigured) {
        upsert({ ...item, error: "Supabase isn't configured yet." } as DockItem);
        return;
      }

      upsert({ ...item, saving: true, error: null });

      try {
        const form = new FormData();
        form.set("kind", item.kind);
        form.set("name", item.name);
        if (item.mime) form.set("mime", item.mime);

        if (item.kind === "text" && item.text) {
          form.set("textContent", item.text);
        } else {
          const blob: File | Blob | null =
            item.file ?? (item.content ? base64ToBlob(item.content, item.mime) : null);
          if (blob) form.set("file", blob, item.name);
        }

        const res = await fetch("/api/saved", { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Save failed");

        const saved: SavedRecord = body.item;
        upsert({
          ...item,
          saved: true,
          saving: false,
          deletedAt: null,
          remoteUrl: saved.remoteUrl,
          storageId: saved.id,
          storagePath: saved.storagePath,
        });

        if (item.broadcast) {
          fetch(`/api/items/${id}`, { method: "DELETE" }).catch(() => {});
        }
      } catch (err) {
        upsert({
          ...item,
          saving: false,
          error: err instanceof Error ? err.message : "Save failed",
        });
      }
    },
    [upsert, supabaseConfigured]
  );

  // For a not-yet-saved item, Remove just clears it (it was never
  // permanent). For a saved item, Remove moves it to Trash instead of
  // deleting it outright — the whole point of adding Trash was to stop
  // an accidental click from destroying something for good.
  const removeItem = useCallback(
    async (id: string) => {
      const item = itemsRef.current[id];
      if (!item) return;

      if (!item.saved) {
        if (item.localUrl) URL.revokeObjectURL(item.localUrl);
        if (item.broadcast) {
          fetch(`/api/items/${id}`, { method: "DELETE" }).catch(() => {});
        }
        drop(id);
        return;
      }

      if (!item.storageId) return;
      upsert({ ...item, removing: true });

      try {
        const res = await fetch(`/api/saved/${item.storageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "trash" }),
        });
        if (!res.ok) throw new Error("Couldn't move to trash");
        drop(id);
      } catch (err) {
        upsert({
          ...item,
          removing: false,
          error: err instanceof Error ? err.message : "Remove failed",
        });
      }
    },
    [upsert, drop]
  );

  const restoreItem = useCallback(async (id: string) => {
    const item = trashRef.current[id];
    if (!item || !item.storageId) return;
    setTrashItems((prev) => ({ ...prev, [id]: { ...item, removing: true } }));

    try {
      const res = await fetch(`/api/saved/${item.storageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      if (!res.ok) throw new Error("Couldn't restore");
      setTrashItems((prev) => {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      setTrashItems((prev) => ({
        ...prev,
        [id]: { ...item, removing: false, error: err instanceof Error ? err.message : "Restore failed" },
      }));
    }
  }, []);

  const purgeItem = useCallback(async (id: string) => {
    const item = trashRef.current[id];
    if (!item || !item.storageId) return;
    setTrashItems((prev) => ({ ...prev, [id]: { ...item, removing: true } }));

    try {
      const res = await fetch(`/api/saved/${item.storageId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setTrashItems((prev) => {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      setTrashItems((prev) => ({
        ...prev,
        [id]: { ...item, removing: false, error: err instanceof Error ? err.message : "Delete failed" },
      }));
    }
  }, []);

  const copyText = useCallback((id: string) => {
    const item = itemsRef.current[id];
    if (item?.text) navigator.clipboard.writeText(item.text);
  }, []);

  const q = query.trim().toLowerCase();
  const ordered = Object.values(items)
    .filter(
      (item) =>
        !q || item.name.toLowerCase().includes(q) || (item.text?.toLowerCase().includes(q) ?? false)
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const orderedTrash = Object.values(trashItems).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Dock</h1>
          <p className="mt-1 text-sm text-muted">
            Send files or text from your phone, pick them up on your PC.
            Nothing is kept for good unless you save it.
          </p>
        </div>
        <ShareQr />
      </header>

      {!liveConfigured && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Live sharing isn't set up yet, so items only show on this device.
          Add Upstash Redis to sync across devices, see the README.
        </div>
      )}

      {!supabaseConfigured && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Supabase isn't configured, so Save and Trash are disabled. Live
          sharing still works without it.
        </div>
      )}

      {loadError && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Couldn't load saved items: {loadError}
        </div>
      )}

      <nav className="flex items-center gap-1 border-b border-border text-sm">
        <button
          onClick={() => setView("home")}
          className={`-mb-px border-b-2 px-3 py-2 ${
            view === "home" ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Dock
        </button>
        <button
          onClick={() => setView("trash")}
          className={`-mb-px border-b-2 px-3 py-2 ${
            view === "trash" ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          Trash{orderedTrash.length ? ` (${orderedTrash.length})` : ""}
        </button>
      </nav>

      {view === "home" ? (
        <>
          <Dropzone onFiles={addFiles} />
          <TextComposer onAdd={addText} />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or text…"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-faint focus:border-borderStrong focus:outline-none"
            />
            <label className="flex shrink-0 items-center gap-2 text-xs text-muted">
              Live for
              <select
                value={ttlSeconds}
                onChange={(e) => setTtlSeconds(Number(e.target.value))}
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-borderStrong focus:outline-none"
              >
                {TTL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <section className="flex flex-col gap-2">
            {loading ? (
              <p className="py-6 text-center text-sm text-faint">Loading…</p>
            ) : ordered.length === 0 ? (
              <p className="py-6 text-center text-sm text-faint">
                {q ? "No items match your search." : "Nothing here yet. Drop a file or add some text above."}
              </p>
            ) : (
              <>
                {ordered.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onSave={saveItem}
                    onRemove={removeItem}
                    onCopy={copyText}
                  />
                ))}
                {hasMoreSaved && !q && (
                  <button
                    onClick={() => loadSaved({ more: true })}
                    className="mx-auto mt-2 text-xs text-muted underline underline-offset-2 hover:text-ink"
                  >
                    Load older saved items
                  </button>
                )}
              </>
            )}
          </section>
        </>
      ) : (
        <section className="flex flex-col gap-2">
          {trashLoading && orderedTrash.length === 0 ? (
            <p className="py-6 text-center text-sm text-faint">Loading…</p>
          ) : orderedTrash.length === 0 ? (
            <p className="py-6 text-center text-sm text-faint">Trash is empty.</p>
          ) : (
            <>
              <p className="text-xs text-faint">
                Items here still count as saved and take up storage until you delete them forever.
              </p>
              {orderedTrash.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  variant="trash"
                  onSave={saveItem}
                  onRemove={removeItem}
                  onCopy={copyText}
                  onRestore={restoreItem}
                  onPurge={purgeItem}
                />
              ))}
              {hasMoreTrash && (
                <button
                  onClick={() => loadTrash({ more: true })}
                  className="mx-auto mt-2 text-xs text-muted underline underline-offset-2 hover:text-ink"
                >
                  Load older trashed items
                </button>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
