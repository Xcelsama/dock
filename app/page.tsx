"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Dropzone from "@/components/Dropzone";
import TextComposer from "@/components/TextComposer";
import ItemRow from "@/components/ItemRow";
import TransferPrompts, { TransferPrompt } from "@/components/TransferPrompts";
import { PairIcon } from "@/components/icons";
import { usePeer } from "@/hooks/usePeer";
import { DockItem, RelayRecord, SavedRecord } from "@/lib/types";
import { blobForItem, itemFromRelay, itemFromSaved, makeItem } from "@/lib/items";
import { kindFromFile, formatBytes } from "@/lib/format";
import { fileToBase64, base64ToBlob } from "@/lib/base64";
import { downloadItem } from "@/lib/download";
import { extractFiles, hasFileItems } from "@/lib/clipboard";
import { MAX_BROADCAST_BYTES } from "@/lib/relay-limits";

// Loaded only when the pairing sheet is opened (it pulls in the QR library).
const PairModal = dynamic(() => import("@/components/PairModal"), { ssr: false });

const POLL_MS = 4000;
// While nothing changes, polling relaxes from 4s to 8s to 12s. Any activity,
// or coming back to the tab, snaps it back to 4s.
const MAX_IDLE_STEPS = 2;
const SAVED_CACHE_KEY = "dock:saved:v1";
const SHARE_LIVE_KEY = "dock:shareLive";
const MAX_CACHE_CHARS = 300_000;
const MAX_KNOWN_IDS = 150;

const TTL_OPTIONS = [
  { label: "1 hour", value: 60 * 60 },
  { label: "24 hours", value: 24 * 60 * 60 },
  { label: "7 days", value: 7 * 24 * 60 * 60 },
];

function uid() {
  return crypto.randomUUID();
}

function textName(text: string) {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function readSavedCache(): SavedRecord[] {
  try {
    const raw = localStorage.getItem(SAVED_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSavedCache(records: SavedRecord[]) {
  try {
    const json = JSON.stringify(records);
    if (records.length && json.length <= MAX_CACHE_CHARS) localStorage.setItem(SAVED_CACHE_KEY, json);
    else localStorage.removeItem(SAVED_CACHE_KEY);
  } catch {
    // storage full or blocked, the cache is only a nicety
  }
}

export default function Page() {
  const [view, setView] = useState<"home" | "trash">("home");
  // Refs let long-lived listeners/timers (set up once) see current values
  // without being torn down and rebuilt on every change.
  const viewRef = useRef(view);
  viewRef.current = view;

  const [query, setQuery] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState(TTL_OPTIONS[1].value);
  const ttlRef = useRef(ttlSeconds);
  ttlRef.current = ttlSeconds;
  const [shareLive, setShareLive] = useState(true);
  const shareLiveRef = useRef(shareLive);
  shareLiveRef.current = shareLive;

  const [items, setItems] = useState<Record<string, DockItem>>({});
  const [loading, setLoading] = useState(true);
  const [liveConfigured, setLiveConfigured] = useState(true);
  const [supabaseConfigured, setSupabaseConfigured] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMoreSaved, setHasMoreSaved] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const savedCursorRef = useRef<string | null>(null);
  const lastVersionRef = useRef<number | null>(null);
  const idleRef = useRef(0);
  // When each item finished saving on this device, so a list fetched before
  // that moment can't mistake it for "gone from the server".
  const savedAtRef = useRef(new Map<string, number>());

  const [trashItems, setTrashItems] = useState<Record<string, DockItem>>({});
  const [trashLoading, setTrashLoading] = useState(false);
  const [hasMoreTrash, setHasMoreTrash] = useState(false);
  const trashRef = useRef(trashItems);
  trashRef.current = trashItems;
  const trashCursorRef = useRef<string | null>(null);

  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pairOpen, setPairOpen] = useState(false);
  const [prompts, setPrompts] = useState<TransferPrompt[]>([]);

  const upsert = useCallback((next: DockItem, overwrite = true) => {
    setItems((prev) => {
      if (prev[next.id] && !overwrite) return prev;
      const existing = prev[next.id];
      return { ...prev, [next.id]: existing ? { ...existing, ...next } : next };
    });
  }, []);

  // Only touches an item that still exists, so a slow request finishing
  // after the item was removed can't resurrect a half-empty ghost.
  const patchItem = useCallback((id: string, patch: Partial<DockItem>) => {
    setItems((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
  }, []);

  const drop = useCallback((id: string) => {
    setItems((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    setTimeout(() => setNotice((current) => (current === message ? null : current)), 6000);
  }, []);

  /* ---------------- loading & syncing ---------------- */

  // Permanent list from our own API (never Supabase directly). A plain call
  // refreshes the newest page and reconciles it, so items trashed or deleted
  // on another device disappear here too; `more: true` pages further back.
  const loadSaved = useCallback(
    async (opts?: { more?: boolean }) => {
      const more = opts?.more ?? false;
      const before = more ? savedCursorRef.current : null;
      const startedAt = Date.now();
      const qs = new URLSearchParams();
      if (before) qs.set("before", before);

      const res = await fetch(`/api/saved?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error) setLoadError(body.error);
        return;
      }
      setLoadError(null);
      const { items: records, hasMore } = (await res.json()) as { items: SavedRecord[]; hasMore: boolean };

      const serverIds = new Set(records.map((r) => r.id));
      const oldest = records.length ? records[records.length - 1].createdAt : null;

      setItems((prev) => {
        const next = { ...prev };
        for (const row of records) {
          const fresh = itemFromSaved(row);
          const existing = prev[row.id];
          next[row.id] = existing
            ? {
                ...fresh,
                file: existing.file,
                localUrl: existing.localUrl,
                viaP2p: existing.viaP2p,
                saving: existing.saving,
                removing: existing.removing,
                error: existing.error,
              }
            : fresh;
        }
        if (!more) {
          for (const item of Object.values(prev)) {
            if (!item.saved || serverIds.has(item.id) || item.saving || item.removing) continue;
            if ((savedAtRef.current.get(item.id) ?? 0) >= startedAt) continue;
            const inRange = !hasMore || (oldest !== null && Date.parse(item.createdAt) >= Date.parse(oldest));
            if (inRange) delete next[item.id];
          }
        }
        return next;
      });

      if (!more) writeSavedCache(records);
      if (more || savedCursorRef.current === null) {
        if (records.length) savedCursorRef.current = records[records.length - 1].createdAt;
        setHasMoreSaved(hasMore);
      }
    },
    []
  );

  // Pull whatever is currently live in the relay. Items already known
  // locally are left alone so we don't clobber the File/object URL they carry.
  const loadLive = useCallback(async () => {
    const known = Object.values(itemsRef.current)
      .filter((i) => !i.saved)
      .slice(0, MAX_KNOWN_IDS)
      .map((i) => i.id);
    const qs = known.length ? `?known=${known.join(",")}` : "";
    const res = await fetch(`/api/items${qs}`, { cache: "no-store" });
    if (!res.ok) return { added: 0, savedVersion: null as number | null };
    const { items: records, savedVersion } = (await res.json()) as {
      items: RelayRecord[];
      savedVersion: number | null;
    };

    let added = 0;
    for (const record of records) {
      if (itemsRef.current[record.id]) continue;
      upsert(itemFromRelay(record), false);
      added++;
    }
    return { added, savedVersion: typeof savedVersion === "number" ? savedVersion : null };
  }, [upsert]);

  // One poll step. The saved list is only re-fetched when the server says
  // something in Supabase changed (or when forced), not on every tick.
  const refresh = useCallback(
    async (force = false) => {
      const { added, savedVersion } = await loadLive();
      const moved = savedVersion !== null && savedVersion !== lastVersionRef.current;
      if (savedVersion !== null) lastVersionRef.current = savedVersion;
      if (force || moved) await loadSaved();
      return added > 0 || moved;
    },
    [loadLive, loadSaved]
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const pokeRef = useRef<() => void>(() => {});

  const loadTrash = useCallback(async (opts?: { more?: boolean }) => {
    const more = opts?.more ?? false;
    const before = more ? trashCursorRef.current : null;
    const qs = new URLSearchParams({ trash: "1" });
    if (before) qs.set("before", before);

    setTrashLoading(true);
    try {
      const res = await fetch(`/api/saved?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const { items: records, hasMore } = (await res.json()) as { items: SavedRecord[]; hasMore: boolean };

      setTrashItems((prev) => {
        const next = more ? { ...prev } : {};
        for (const row of records) next[row.id] = itemFromSaved(row);
        return next;
      });

      if (records.length) trashCursorRef.current = records[records.length - 1].createdAt;
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
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Show last visit's saved list immediately, then update it from the network.
    try {
      setShareLive(localStorage.getItem(SHARE_LIVE_KEY) !== "0");
    } catch {}
    const cached = readSavedCache();
    if (cached.length) {
      setItems((prev) => {
        const next = { ...prev };
        for (const row of cached) if (!next[row.id]) next[row.id] = itemFromSaved(row);
        return next;
      });
      setLoading(false);
    }

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!cancelled) timer = setTimeout(tick, ms);
    };

    async function tick() {
      if (cancelled) return;
      if (document.visibilityState === "visible" && viewRef.current === "home") {
        try {
          const changed = await refreshRef.current(false);
          idleRef.current = changed ? 0 : Math.min(idleRef.current + 1, MAX_IDLE_STEPS);
        } catch {}
      }
      schedule(POLL_MS * (1 + idleRef.current));
    }

    // Back on the tab, or after local activity: refresh now, then resume.
    const poke = () => {
      if (document.visibilityState !== "visible") return;
      idleRef.current = 0;
      clearTimeout(timer);
      refreshRef.current(true).catch(() => {}).finally(() => schedule(POLL_MS));
    };
    pokeRef.current = poke;

    async function init() {
      // All three requests start together instead of config first, then data.
      const config = fetch("/api/config")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const live = loadLive()
        .then(({ savedVersion }) => {
          lastVersionRef.current = savedVersion;
        })
        .catch(() => {});
      const saved = loadSaved().catch(() => {});
      const cfg = await config;
      if (cfg && !cancelled) {
        setLiveConfigured(cfg.redisConfigured);
        setSupabaseConfigured(cfg.supabaseConfigured);
      }
      await Promise.all([live, saved]);
      if (!cancelled) setLoading(false);
      schedule(POLL_MS);
    }
    void init();

    document.addEventListener("visibilitychange", poke);
    window.addEventListener("focus", poke);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", poke);
      window.removeEventListener("focus", poke);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- adding things ---------------- */

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
          patchItem(record.id, { broadcast: false, error: body.error ?? "Couldn't share live." });
          return;
        }
        if (!itemsRef.current[record.id]) {
          // removed while it was uploading, don't leave it in the relay
          fetch(`/api/items/${record.id}`, { method: "DELETE" }).catch(() => {});
          return;
        }
        patchItem(record.id, { broadcast: true });
      } catch {
        patchItem(record.id, { broadcast: false, error: "Couldn't reach the live relay." });
      }
    },
    [patchItem]
  );

  // `share: false` keeps the file on this device only (used for direct
  // transfers, which must never be copied to the relay).
  const addFiles = useCallback(
    (files: File[], opts: { share?: boolean; viaP2p?: boolean } = {}): DockItem[] => {
      const share = opts.share ?? shareLiveRef.current;
      idleRef.current = 0;

      return files.map((file) => {
        const createdAt = new Date().toISOString();
        const item = makeItem({
          id: uid(),
          kind: kindFromFile(file),
          name: file.name,
          size: file.size,
          mime: file.type || null,
          createdAt,
          localUrl: URL.createObjectURL(file),
          file,
          viaP2p: opts.viaP2p ?? false,
        });
        upsert(item);

        if (share) {
          if (file.size <= MAX_BROADCAST_BYTES) {
            fileToBase64(file)
              .then((content) =>
                broadcast(
                  { id: item.id, kind: item.kind, name: item.name, size: item.size, mime: item.mime, createdAt, text: null, content },
                  ttlRef.current
                )
              )
              .catch(() => patchItem(item.id, { error: "Couldn't read that file." }));
          } else {
            patchItem(item.id, {
              error: `Too big for live sync (${formatBytes(MAX_BROADCAST_BYTES)} max). Use Send to transfer it directly.`,
            });
          }
        }
        return item;
      });
    },
    [upsert, patchItem, broadcast]
  );

  const addText = useCallback(
    (text: string, opts: { share?: boolean; viaP2p?: boolean } = {}): DockItem => {
      const share = opts.share ?? shareLiveRef.current;
      idleRef.current = 0;
      const createdAt = new Date().toISOString();
      const item = makeItem({
        id: uid(),
        kind: "text",
        name: textName(text),
        size: new Blob([text]).size,
        mime: "text/plain",
        createdAt,
        text,
        viaP2p: opts.viaP2p ?? false,
      });
      upsert(item);
      if (share) {
        broadcast(
          { id: item.id, kind: "text", name: item.name, size: item.size, mime: "text/plain", createdAt, text, content: null },
          ttlRef.current
        );
      }
      return item;
    },
    [upsert, broadcast]
  );

  /* ---------------- direct device-to-device ---------------- */

  const pushPrompt = useCallback((p: Omit<TransferPrompt, "key">) => {
    setPrompts((prev) => [...prev, { ...p, key: `${p.direction}-${p.itemId}-${Date.now()}` }]);
  }, []);

  const { peer, snap } = usePeer({
    onReceivedFile: (file, meta) => {
      const [item] = addFiles([file], { share: false, viaP2p: true });
      pushPrompt({ direction: "received", itemId: item.id, name: item.name, size: item.size, peerLabel: meta.peerLabel });
    },
    onReceivedText: (text, meta) => {
      const item = addText(text, { share: false, viaP2p: true });
      pushPrompt({ direction: "received", itemId: item.id, name: item.name, size: item.size, peerLabel: meta.peerLabel });
    },
    onSent: (info) => {
      pushPrompt({ direction: "sent", itemId: info.itemId, name: info.name, size: info.size, peerLabel: info.peerLabel });
    },
  });

  const queueSend = useCallback(
    (item: DockItem) => {
      peer.enqueue({
        itemId: item.id,
        kind: item.kind,
        name: item.name,
        size: item.size,
        mime: item.mime,
        createdAt: item.createdAt,
        text: item.kind === "text" ? item.text : null,
        getBlob: item.kind === "text" ? undefined : () => blobForItem(itemsRef.current[item.id] ?? item),
      });
    },
    [peer]
  );

  // Already paired: just send. Otherwise open the QR sheet with it queued.
  const ensureSession = useCallback(() => {
    const status = peer.getSnapshot().status;
    if (status === "connected") return;
    if (status !== "waiting" && status !== "connecting") void peer.host();
    setPairOpen(true);
  }, [peer]);

  const sendItem = useCallback(
    (id: string) => {
      const item = itemsRef.current[id];
      if (!item) return;
      queueSend(item);
      ensureSession();
    },
    [queueSend, ensureSession]
  );

  const sendFiles = useCallback(
    (files: File[]) => {
      for (const item of addFiles(files, { share: false })) queueSend(item);
    },
    [addFiles, queueSend]
  );

  // Opened from a scanned QR code: ?pair=<code> joins that session.
  const joinStarted = useRef(false);
  useEffect(() => {
    if (joinStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("pair");
    if (!code) return;
    joinStarted.current = true;
    params.delete("pair");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
    setPairOpen(true);
    void peer.join(code);
  }, [peer]);

  /* ---------------- drop & paste (page-wide) ---------------- */

  // Shared by paste and drop. Returns true if it took the data.
  const ingest = useCallback(
    (dt: DataTransfer): boolean => {
      const { files, folders } = extractFiles(dt);
      if (folders) showNotice("Folders can't be sent as they are. Zip the folder first, then add the zip.");
      if (files.length) {
        setView("home");
        addFiles(files);
        return true;
      }
      const text = dt.getData("text/plain")?.trim();
      if (text) {
        setView("home");
        addText(text);
        return true;
      }
      return folders > 0;
    },
    [addFiles, addText, showNotice]
  );
  const ingestRef = useRef(ingest);
  ingestRef.current = ingest;

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const dt = e.clipboardData;
      if (!dt) return;
      const target = e.target as HTMLElement | null;
      const inField =
        !!target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable);
      // Plain text pasted into a field stays normal. A file (screenshot,
      // copied file) is taken even when a field has focus, unless the
      // clipboard also carries text for that field.
      if (inField && (!hasFileItems(dt) || dt.getData("text/plain"))) return;
      if (ingestRef.current(dt)) e.preventDefault();
    }

    let depth = 0;
    const wanted = (e: DragEvent) => {
      const types = Array.from(e.dataTransfer?.types ?? []);
      if (types.includes("Files")) return true;
      // Dragging selected text around inside a text box is the browser's job.
      const tag = (e.target as HTMLElement | null)?.tagName;
      return types.includes("text/plain") && tag !== "TEXTAREA" && tag !== "INPUT";
    };
    const onEnter = (e: DragEvent) => {
      if (!wanted(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!wanted(e)) return;
      e.preventDefault(); // required, or the browser refuses the drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!wanted(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!wanted(e)) return;
      // Always cancel the default, otherwise a file dropped outside the box
      // makes the browser navigate away to open it.
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer) ingestRef.current(e.dataTransfer);
    };

    window.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  /* ---------------- save / remove / trash ---------------- */

  const saveItem = useCallback(
    async (id: string) => {
      const item = itemsRef.current[id];
      if (!item || item.saved || item.saving) return;

      if (!supabaseConfigured) {
        patchItem(id, { error: "Supabase isn't configured yet." });
        return;
      }

      patchItem(id, { saving: true, error: null });

      try {
        const form = new FormData();
        // Same id on the server, so this item stays one item (no duplicate
        // appears when the saved list refreshes).
        form.set("id", item.id);
        form.set("kind", item.kind);
        form.set("name", item.name);
        if (item.mime) form.set("mime", item.mime);

        if (item.kind === "text" && item.text) {
          form.set("textContent", item.text);
        } else {
          const blob: File | Blob | null = item.file ?? (item.content ? base64ToBlob(item.content, item.mime) : null);
          if (blob) form.set("file", blob, item.name);
        }

        const res = await fetch("/api/saved", { method: "POST", body: form });
        if (res.status === 413) {
          throw new Error(
            "Too big to save from the browser (uploads through the server are capped around 4.5 MB). It's still on this device, so use Download."
          );
        }
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Save failed");

        const saved: SavedRecord = body.item;
        savedAtRef.current.set(id, Date.now());
        patchItem(id, {
          saved: true,
          saving: false,
          deletedAt: null,
          remoteUrl: saved.remoteUrl,
          storageId: saved.id,
          viaP2p: false,
        });

        if (item.broadcast) {
          fetch(`/api/items/${id}`, { method: "DELETE" }).catch(() => {});
        }
      } catch (err) {
        patchItem(id, { saving: false, error: err instanceof Error ? err.message : "Save failed" });
      }
    },
    [patchItem, supabaseConfigured]
  );

  // For a not-yet-saved item, Remove just clears it (it was never
  // permanent). For a saved item, Remove moves it to Trash instead.
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
      patchItem(id, { removing: true });

      try {
        const res = await fetch(`/api/saved/${item.storageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "trash" }),
        });
        if (!res.ok) throw new Error("Couldn't move to trash");
        drop(id);
      } catch (err) {
        patchItem(id, { removing: false, error: err instanceof Error ? err.message : "Remove failed" });
      }
    },
    [patchItem, drop]
  );

  const patchTrash = useCallback((id: string, patch: Partial<DockItem>) => {
    setTrashItems((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));
  }, []);

  const dropTrash = useCallback((id: string) => {
    setTrashItems((prev) => {
      const { [id]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  const restoreItem = useCallback(
    async (id: string) => {
      const item = trashRef.current[id];
      if (!item?.storageId) return;
      patchTrash(id, { removing: true });
      try {
        const res = await fetch(`/api/saved/${item.storageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        });
        if (!res.ok) throw new Error("Couldn't restore");
        dropTrash(id);
      } catch (err) {
        patchTrash(id, { removing: false, error: err instanceof Error ? err.message : "Restore failed" });
      }
    },
    [patchTrash, dropTrash]
  );

  const purgeItem = useCallback(
    async (id: string) => {
      const item = trashRef.current[id];
      if (!item?.storageId) return;
      patchTrash(id, { removing: true });
      try {
        const res = await fetch(`/api/saved/${item.storageId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Delete failed");
        dropTrash(id);
      } catch (err) {
        patchTrash(id, { removing: false, error: err instanceof Error ? err.message : "Delete failed" });
      }
    },
    [patchTrash, dropTrash]
  );

  const copyText = useCallback((id: string) => {
    const item = itemsRef.current[id];
    if (item?.text) navigator.clipboard.writeText(item.text);
  }, []);

  const downloadById = useCallback((id: string) => {
    const item = itemsRef.current[id];
    if (item) downloadItem(item);
  }, []);

  const changeShareLive = useCallback((value: boolean) => {
    setShareLive(value);
    try {
      localStorage.setItem(SHARE_LIVE_KEY, value ? "1" : "0");
    } catch {}
  }, []);

  /* ---------------- render ---------------- */

  const q = query.trim().toLowerCase();
  const ordered = Object.values(items)
    .filter((item) => !q || item.name.toLowerCase().includes(q) || (item.text?.toLowerCase().includes(q) ?? false))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const orderedTrash = Object.values(trashItems).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const activeTransfer = snap.transfers.find((t) => t.status === "active");
  const pairLabel =
    snap.status === "connected"
      ? activeTransfer
        ? `${activeTransfer.direction === "send" ? "Sending" : "Receiving"} ${
            activeTransfer.size ? Math.min(100, Math.round((activeTransfer.bytes / activeTransfer.size) * 100)) : 0
          }%`
        : `Connected · ${snap.peerLabel ?? "device"}`
      : snap.status === "connecting" || snap.status === "waiting"
        ? "Pairing…"
        : "Send to device";

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-base/80 backdrop-blur-sm">
          <div className="rounded-md border border-dashed border-accent bg-surface px-8 py-6 text-sm text-ink">
            Drop to add to Dock
          </div>
        </div>
      )}

      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Dock</h1>
          <p className="mt-1 text-sm text-muted">
            Move files and text between your devices. Nothing is kept for good unless you save it.
          </p>
        </div>
        <button
          onClick={() => setPairOpen(true)}
          className={`flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            snap.status === "connected"
              ? "border-accentDim bg-accent/10 text-accent"
              : "border-border text-ink hover:border-borderStrong"
          }`}
        >
          <PairIcon />
          {pairLabel}
        </button>
      </header>

      {notice && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">{notice}</div>
      )}

      {!liveConfigured && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Redis isn&apos;t set up, so items only show on this device and QR pairing is unavailable. Add Upstash Redis, see the README.
        </div>
      )}

      {!supabaseConfigured && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Supabase isn&apos;t configured, so Save and Trash are disabled. Live sharing still works without it.
        </div>
      )}

      {loadError && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Couldn&apos;t load saved items: {loadError}
        </div>
      )}

      <nav className="flex items-center gap-1 border-b border-border text-sm">
        <button
          onClick={() => {
            setView("home");
            pokeRef.current();
          }}
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
          <Dropzone onFiles={(files) => addFiles(files)} active={dragging} />
          <TextComposer onAdd={(text) => addText(text)} />

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or text…"
              className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-faint focus:border-borderStrong focus:outline-none"
            />
            <div className="flex shrink-0 items-center gap-3 text-xs text-muted">
              <label className="flex items-center gap-1.5" title="Copies new items to your other devices through the live relay. Turn off to keep items on this device and send them directly instead.">
                <input
                  type="checkbox"
                  checked={shareLive}
                  onChange={(e) => changeShareLive(e.target.checked)}
                  className="accent-[#4FD1C5]"
                />
                Live sync
              </label>
              <label className="flex items-center gap-2">
                Live for
                <select
                  value={ttlSeconds}
                  disabled={!shareLive}
                  onChange={(e) => setTtlSeconds(Number(e.target.value))}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink focus:border-borderStrong focus:outline-none disabled:opacity-40"
                >
                  {TTL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <section className="flex flex-col gap-2">
            {loading ? (
              <p className="py-6 text-center text-sm text-faint">Loading…</p>
            ) : ordered.length === 0 ? (
              <p className="py-6 text-center text-sm text-faint">
                {q ? "No items match your search." : "Nothing here yet. Drop, paste, or add something above."}
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
                    onSend={sendItem}
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

      {pairOpen && (
        <PairModal
          snap={snap}
          onHost={() => void peer.host()}
          onJoin={(code) => void peer.join(code)}
          onSendFiles={sendFiles}
          onCancelTransfer={(id) => peer.cancelTransfer(id)}
          onClearFinished={() => peer.clearFinished()}
          onDisconnect={() => peer.disconnect()}
          onClose={() => setPairOpen(false)}
        />
      )}

      <TransferPrompts
        prompts={prompts}
        items={items}
        canSave={supabaseConfigured}
        onSave={saveItem}
        onDownload={downloadById}
        onDismiss={(key) => setPrompts((prev) => prev.filter((p) => p.key !== key))}
      />
    </main>
  );
}
