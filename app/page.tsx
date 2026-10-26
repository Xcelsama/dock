"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Dropzone from "@/components/Dropzone";
import TextComposer from "@/components/TextComposer";
import ItemRow from "@/components/ItemRow";
import ListSkeleton from "@/components/ListSkeleton";
import TransferPrompts, { TransferPrompt } from "@/components/TransferPrompts";
import { PairIcon } from "@/components/icons";
import { usePeer } from "@/hooks/usePeer";
import { Bootstrap, DockItem, LiveListing, RelayUpload, SavedRecord, SavedWindow } from "@/lib/types";
import { blobForItem, itemFromRelay, itemFromSaved, makeItem } from "@/lib/items";
import { kindFromFile, formatBytes } from "@/lib/format";
import { fileToBase64 } from "@/lib/base64";
import { downloadItem } from "@/lib/download";
import { extractFiles, hasFileItems } from "@/lib/clipboard";
import { MAX_BROADCAST_BYTES } from "@/lib/relay-limits";
import { startOfYesterday } from "@/lib/window";

declare global {
  interface Window {
    /** The list request started by the inline script in app/layout.tsx. */
    __dockBoot?: Promise<Bootstrap | null>;
  }
}

// Loaded only when the pairing sheet is opened (it pulls in the QR library).
const PairModal = dynamic(() => import("@/components/PairModal"), { ssr: false });

const POLL_MS = 4000;
// While nothing changes, polling relaxes from 4s to 8s to 12s. Any activity,
// or coming back to the tab, snaps it back to 4s.
const MAX_IDLE_STEPS = 2;
// v2: the cache now holds the recent window plus pins, not a flat first page.
const SAVED_CACHE_KEY = "dock:saved:v2";
const OLD_SAVED_CACHE_KEY = "dock:saved:v1";
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
    localStorage.removeItem(OLD_SAVED_CACHE_KEY);
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

// Server data wins, but anything that only exists on this device (the File,
// its blob URL) and anything mid-flight (saving, removing, pinning) is kept.
function mergeSaved(existing: DockItem | undefined, row: SavedRecord): DockItem {
  const fresh = itemFromSaved(row);
  if (!existing) return fresh;
  return {
    ...fresh,
    file: existing.file,
    localUrl: existing.localUrl,
    viaP2p: existing.viaP2p,
    saving: existing.saving,
    removing: existing.removing,
    pinOp: existing.pinOp,
    error: existing.error,
    // A pin or unpin still on its way keeps the value the person just chose.
    pinnedAt: existing.pinOp ? existing.pinnedAt : fresh.pinnedAt,
  };
}

function fetchBootstrap(sinceIso: string): Promise<Bootstrap | null> {
  return fetch(`/api/bootstrap?since=${encodeURIComponent(sinceIso)}`, { cache: "no-store" })
    .then((r) => {
      // The password was changed (or the cookie cleared) while this tab was
      // open: the gate answered instead of the API. Go and unlock, rather
      // than reporting a connection problem.
      if (r.redirected && new URL(r.url).pathname === "/gate") {
        window.location.assign(r.url);
        return null;
      }
      return r.ok ? (r.json() as Promise<Bootstrap>) : null;
    })
    .catch(() => null);
}

// The inline script in app/layout.tsx usually has the request in flight (or
// finished) before this code even runs. Use it once; otherwise ask now.
function takeEarlyBootstrap(sinceIso: string): Promise<Bootstrap | null> {
  const early = window.__dockBoot;
  window.__dockBoot = undefined;
  return early ?? fetchBootstrap(sinceIso);
}

export default function Page() {
  const [view, setView] = useState<"home" | "trash">("home");
  // Refs let long-lived listeners/timers (set up once) see current values
  // without being torn down and rebuilt on every change.
  const viewRef = useRef(view);
  viewRef.current = view;

  const [query, setQuery] = useState("");
  // Typing stays instant; the list catches up a beat later.
  const deferredQuery = useDeferredValue(query);
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

  // The home list covers today and yesterday (this device's calendar) plus
  // pins. "Show older items" lifts that limit for the rest of the visit.
  const [showOlder, setShowOlder] = useState(false);
  const showOlderRef = useRef(showOlder);
  showOlderRef.current = showOlder;
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderLive, setHasOlderLive] = useState(false);
  const [cutoffMs, setCutoffMs] = useState(() => startOfYesterday().getTime());
  // Set when the last full load failed, so the next poll tries it again.
  const needsReloadRef = useRef(false);

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

  // Folds the server's answer for the home list into local state: recent
  // items, pins, and the removal of anything another device trashed or
  // deleted. Items older than the window are only kept when they're pinned
  // (or the person asked for older items).
  const applySaved = useCallback((win: SavedWindow, startedAt: number) => {
    setSupabaseConfigured(win.configured);

    const serverIds = new Set<string>();
    for (const row of win.items) serverIds.add(row.id);
    for (const row of win.pinned) serverIds.add(row.id);

    // Everything newer than this was in the response in full. If the window
    // was cut short, that's the oldest row we got, not the window's edge.
    const coveredFrom = Math.max(Date.parse(win.since), Date.parse(win.nextBefore ?? win.since));

    setItems((prev) => {
      const next = { ...prev };
      for (const row of win.items) next[row.id] = mergeSaved(prev[row.id], row);
      for (const row of win.pinned) next[row.id] = mergeSaved(prev[row.id], row);

      for (const item of Object.values(prev)) {
        if (!item.saved || serverIds.has(item.id)) continue;
        if (item.saving || item.removing || item.pinOp) continue;
        if ((savedAtRef.current.get(item.id) ?? 0) >= startedAt) continue;

        if (Date.parse(item.createdAt) >= coveredFrom) {
          delete next[item.id]; // inside what we just fetched, so it's gone
        } else if (!showOlderRef.current) {
          delete next[item.id]; // outside the window, comes back on request
        } else if (win.pinsReady && item.pinnedAt) {
          next[item.id] = { ...item, pinnedAt: null }; // an older item that's no longer pinned
        }
      }
      return next;
    });

    const seen = new Set<string>();
    const forCache: SavedRecord[] = [];
    for (const row of [...win.items, ...win.pinned]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        forCache.push(row);
      }
    }
    writeSavedCache(forCache);

    // Paging state belongs to the window until the person asks for older
    // items; after that a refresh mustn't send them back to the start.
    if (!showOlderRef.current) {
      savedCursorRef.current = win.nextBefore;
      setHasMoreSaved(win.hasMore);
    }
  }, []);

  // `more: true` pages further back from the cursor ("Show older items").
  // A plain call refreshes the home list: recent items plus pins. Resolves to
  // whether it worked, so a failed refresh gets tried again.
  const loadSaved = useCallback(
    async (opts?: { more?: boolean }): Promise<boolean> => {
      const more = opts?.more ?? false;
      const startedAt = Date.now();

      if (more) {
        const before = savedCursorRef.current;
        if (!before) return false;
        const res = await fetch(`/api/saved?${new URLSearchParams({ before })}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.error) setLoadError(body.error);
          return false;
        }
        const { items: records, hasMore } = (await res.json()) as { items: SavedRecord[]; hasMore: boolean };
        setItems((prev) => {
          const next = { ...prev };
          for (const row of records) next[row.id] = mergeSaved(prev[row.id], row);
          return next;
        });
        if (records.length) savedCursorRef.current = records[records.length - 1].createdAt;
        setHasMoreSaved(hasMore);
        return true;
      }

      const since = startOfYesterday().toISOString();
      const res = await fetch(`/api/saved?since=${encodeURIComponent(since)}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setLoadError(body.error ?? "Check your connection. Dock will keep trying.");
        return false;
      }
      setLoadError(null);
      applySaved((await res.json()) as SavedWindow, startedAt);
      return true;
    },
    [applySaved]
  );

  // Adds live items we haven't seen. Items already known locally are left
  // alone so we don't clobber the File/object URL they carry. Returns how
  // many were new.
  const applyLive = useCallback(
    (live: LiveListing) => {
      setLiveConfigured(live.configured);
      setHasOlderLive(live.hasOlder);
      let added = 0;
      for (const record of live.items) {
        if (itemsRef.current[record.id]) continue;
        upsert(itemFromRelay(record), false);
        added++;
      }
      return added;
    },
    [upsert]
  );

  // Pull whatever is currently live in the relay: metadata only, the file
  // bytes stay put until someone opens or downloads the file.
  const loadLive = useCallback(async () => {
    const known = Object.values(itemsRef.current)
      .filter((i) => !i.saved)
      .slice(0, MAX_KNOWN_IDS)
      .map((i) => i.id);
    const qs = new URLSearchParams();
    if (known.length) qs.set("known", known.join(","));
    if (!showOlderRef.current) qs.set("since", startOfYesterday().toISOString());
    const res = await fetch(`/api/items?${qs.toString()}`, { cache: "no-store" });
    if (!res.ok) return { added: 0, savedVersion: null as number | null };
    const live = (await res.json()) as LiveListing;
    return { added: applyLive(live), savedVersion: typeof live.savedVersion === "number" ? live.savedVersion : null };
  }, [applyLive]);

  // One poll step. The saved list is only re-fetched when the server says
  // something in Supabase changed (or when forced), not on every tick.
  const refresh = useCallback(
    async (force = false) => {
      const { added, savedVersion } = await loadLive();
      const moved = savedVersion !== null && savedVersion !== lastVersionRef.current;
      if (savedVersion !== null) lastVersionRef.current = savedVersion;
      if (force || moved) {
        // Stays set until a reload has actually worked, so a failed one
        // (offline, server error) is tried again on the next tick.
        needsReloadRef.current = true;
        if (await loadSaved()) needsReloadRef.current = false;
      }
      return added > 0 || moved;
    },
    [loadLive, loadSaved]
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const pokeRef = useRef<() => void>(() => {});

  // Lifts the two-day limit: pages further back through saved items and
  // lists older live ones too.
  const revealOlder = useCallback(async () => {
    showOlderRef.current = true;
    setShowOlder(true);
    setLoadingOlder(true);
    try {
      await Promise.all([loadSaved({ more: true }), loadLive()]);
    } catch {
      // the button is still there to try again
    } finally {
      setLoadingOlder(false);
    }
  }, [loadSaved, loadLive]);

  const loadMoreOlder = useCallback(async () => {
    setLoadingOlder(true);
    try {
      await loadSaved({ more: true });
    } catch {
      // the button is still there to try again
    } finally {
      setLoadingOlder(false);
    }
  }, [loadSaved]);

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

    // The window moves at midnight, so keep it current.
    const syncCutoff = () => {
      const next = startOfYesterday().getTime();
      setCutoffMs((prev) => (prev === next ? prev : next));
    };

    // Show last visit's list immediately, then update it from the network.
    try {
      setShareLive(localStorage.getItem(SHARE_LIVE_KEY) !== "0");
    } catch {}
    const cached = readSavedCache();
    if (cached.length) {
      const cutoff = startOfYesterday().getTime();
      const fresh = cached.filter((row) => row.pinnedAt || Date.parse(row.createdAt) >= cutoff);
      if (fresh.length) {
        setItems((prev) => {
          const next = { ...prev };
          for (const row of fresh) if (!next[row.id]) next[row.id] = itemFromSaved(row);
          return next;
        });
        setLoading(false);
      }
    }

    const schedule = (ms: number) => {
      clearTimeout(timer);
      if (!cancelled) timer = setTimeout(tick, ms);
    };

    async function tick() {
      if (cancelled) return;
      if (document.visibilityState === "visible" && viewRef.current === "home") {
        syncCutoff();
        try {
          const changed = await refreshRef.current(needsReloadRef.current);
          idleRef.current = changed ? 0 : Math.min(idleRef.current + 1, MAX_IDLE_STEPS);
        } catch {}
      }
      schedule(POLL_MS * (1 + idleRef.current));
    }

    // Back on the tab, or after local activity: refresh now, then resume.
    const poke = () => {
      if (document.visibilityState !== "visible") return;
      syncCutoff();
      idleRef.current = 0;
      clearTimeout(timer);
      refreshRef.current(true).catch(() => {}).finally(() => schedule(POLL_MS));
    };
    pokeRef.current = poke;

    async function init() {
      const startedAt = Date.now();
      const since = startOfYesterday().toISOString();
      // One request covers the relay, the recent saved items and the pins.
      // It usually started before this code loaded (see app/layout.tsx).
      let data = await takeEarlyBootstrap(since);
      if (!data && !cancelled) data = await fetchBootstrap(since);
      if (cancelled) return;

      if (data) {
        lastVersionRef.current = data.live.savedVersion;
        applyLive(data.live);
        applySaved(data.saved, startedAt);
        setLoadError(null);
        needsReloadRef.current = false;
      } else {
        needsReloadRef.current = true;
        setLoadError("Check your connection. Dock will keep trying.");
      }
      setLoading(false);
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
    async (record: RelayUpload, itemTtlSeconds: number) => {
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

  // `pin: true` saves and pins in one request, so pinning something that was
  // only live (or only on this device) doesn't need a second round trip.
  const saveItem = useCallback(
    async (id: string, opts: { pin?: boolean } = {}) => {
      const item = itemsRef.current[id];
      if (!item || item.saved || item.saving) return;

      if (!supabaseConfigured) {
        patchItem(id, { error: "Supabase isn't configured yet." });
        return;
      }

      const pin = opts.pin ?? false;
      patchItem(id, { saving: true, error: null, ...(pin ? { pinOp: "pin" as const } : {}) });

      try {
        const form = new FormData();
        // Same id on the server, so this item stays one item (no duplicate
        // appears when the saved list refreshes).
        form.set("id", item.id);
        form.set("kind", item.kind);
        form.set("name", item.name);
        if (item.mime) form.set("mime", item.mime);
        if (pin) form.set("pinned", "1");

        if (item.kind === "text" && item.text) {
          form.set("textContent", item.text);
        } else {
          // From this device it's the File itself; from another device it's
          // still in the relay, so its bytes are fetched now.
          form.set("file", await blobForItem(item), item.name);
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
          pinOp: null,
          deletedAt: null,
          pinnedAt: saved.pinnedAt ?? null,
          remoteUrl: saved.remoteUrl,
          storageId: saved.id,
          viaP2p: false,
        });

        if (item.broadcast) {
          fetch(`/api/items/${id}`, { method: "DELETE" }).catch(() => {});
        }
      } catch (err) {
        patchItem(id, {
          saving: false,
          pinOp: null,
          error: err instanceof Error ? err.message : "Save failed",
        });
      }
    },
    [patchItem, supabaseConfigured]
  );

  // Pinning keeps an item at the top of the list however old it gets, so it
  // has to live somewhere permanent: an unsaved item is saved as it's pinned.
  const pinItem = useCallback(
    async (id: string) => {
      const item = itemsRef.current[id];
      if (!item || item.pinnedAt || item.pinOp || item.saving) return;

      if (!supabaseConfigured) {
        patchItem(id, { error: "Pinning needs Supabase, which isn't set up yet." });
        return;
      }
      if (!item.saved) {
        await saveItem(id, { pin: true });
        return;
      }
      if (!item.storageId) return;

      // Shown as pinned straight away, put back if the server says no.
      const optimistic = new Date().toISOString();
      patchItem(id, { pinOp: "pin", pinnedAt: optimistic, error: null });
      try {
        const res = await fetch(`/api/saved/${item.storageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "pin" }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Couldn't pin that.");
        patchItem(id, { pinOp: null, pinnedAt: (body.item as SavedRecord | undefined)?.pinnedAt ?? optimistic });
      } catch (err) {
        patchItem(id, { pinOp: null, pinnedAt: null, error: err instanceof Error ? err.message : "Couldn't pin that." });
      }
    },
    [patchItem, saveItem, supabaseConfigured]
  );

  const unpinItem = useCallback(
    async (id: string) => {
      const item = itemsRef.current[id];
      if (!item || !item.pinnedAt || item.pinOp || !item.storageId) return;

      const previous = item.pinnedAt;
      patchItem(id, { pinOp: "unpin", pinnedAt: null, error: null });
      try {
        const res = await fetch(`/api/saved/${item.storageId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "unpin" }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? "Couldn't unpin that.");
        patchItem(id, { pinOp: null, pinnedAt: null });
      } catch (err) {
        patchItem(id, { pinOp: null, pinnedAt: previous, error: err instanceof Error ? err.message : "Couldn't unpin that." });
      }
    },
    [patchItem]
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

  const q = deferredQuery.trim().toLowerCase();

  // Pins first (most recently pinned on top), then everything from today and
  // yesterday, newest first. Rebuilt only when something it depends on moves.
  const { pinnedList, recentList } = useMemo(() => {
    const pinned: DockItem[] = [];
    const recent: DockItem[] = [];
    for (const item of Object.values(items)) {
      if (q && !item.name.toLowerCase().includes(q) && !(item.text?.toLowerCase().includes(q) ?? false)) continue;
      if (item.pinnedAt) pinned.push(item);
      else if (showOlder || Date.parse(item.createdAt) >= cutoffMs) recent.push(item);
    }
    pinned.sort((a, b) => Date.parse(b.pinnedAt as string) - Date.parse(a.pinnedAt as string));
    recent.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return { pinnedList: pinned, recentList: recent };
  }, [items, q, showOlder, cutoffMs]);

  const canShowOlder = !showOlder && (hasMoreSaved || hasOlderLive);
  const canLoadMore = showOlder && hasMoreSaved;

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

          <section className="flex flex-col gap-2" aria-busy={loading}>
            {loading ? (
              <ListSkeleton />
            ) : (
              <>
                {pinnedList.length === 0 && recentList.length === 0 && (
                  <p className="py-6 text-center text-sm text-faint">
                    {q
                      ? showOlder
                        ? "No items match your search."
                        : "Nothing from today or yesterday matches your search."
                      : "Nothing from today or yesterday. Drop, paste, or add something above."}
                  </p>
                )}

                {pinnedList.length > 0 && <h2 className="text-xs font-medium text-muted">Pinned</h2>}
                {pinnedList.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onSave={saveItem}
                    onRemove={removeItem}
                    onCopy={copyText}
                    onSend={sendItem}
                    canPin={supabaseConfigured}
                    onPin={pinItem}
                    onUnpin={unpinItem}
                  />
                ))}

                {pinnedList.length > 0 && recentList.length > 0 && (
                  <h2 className="mt-2 text-xs font-medium text-muted">
                    {showOlder ? "Everything else" : "Today and yesterday"}
                  </h2>
                )}
                {recentList.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    onSave={saveItem}
                    onRemove={removeItem}
                    onCopy={copyText}
                    onSend={sendItem}
                    canPin={supabaseConfigured}
                    onPin={pinItem}
                    onUnpin={unpinItem}
                  />
                ))}

                {(canShowOlder || canLoadMore) && (
                  <button
                    onClick={canShowOlder ? revealOlder : loadMoreOlder}
                    disabled={loadingOlder}
                    className="mx-auto mt-2 text-xs text-muted underline underline-offset-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingOlder ? "Loading…" : canShowOlder ? "Show older items" : "Load more"}
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
