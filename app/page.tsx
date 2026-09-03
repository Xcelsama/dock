"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Dropzone from "@/components/Dropzone";
import TextComposer from "@/components/TextComposer";
import ItemRow from "@/components/ItemRow";
import { DockItem, RelayRecord } from "@/lib/types";
import { kindFromFile } from "@/lib/format";
import { fileToBase64, base64ToBlob } from "@/lib/base64";
import { supabase, supabaseConfigured, BUCKET, TABLE } from "@/lib/supabase";
import { MAX_BROADCAST_BYTES } from "@/lib/relay-limits";

const POLL_MS = 4000;

function uid() {
  return crypto.randomUUID();
}

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_");
}

export default function Page() {
  const [items, setItems] = useState<Record<string, DockItem>>({});
  const [loading, setLoading] = useState(true);
  const [liveConfigured, setLiveConfigured] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

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

  // Pull the permanent list from Supabase.
  const loadSaved = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setLoadError(error.message);
      return;
    }

    for (const row of data ?? []) {
      const remoteUrl = row.storage_path
        ? supabase.storage.from(BUCKET).getPublicUrl(row.storage_path).data
            .publicUrl
        : null;

      upsert(
        {
          id: row.id,
          kind: row.kind,
          name: row.name,
          size: row.size,
          mime: row.mime,
          createdAt: row.created_at,
          saved: true,
          broadcast: false,
          saving: false,
          removing: false,
          error: null,
          localUrl: null,
          file: null,
          text: row.text_content,
          content: null,
          remoteUrl,
          storageId: row.id,
          storagePath: row.storage_path,
        },
        true
      );
    }
  }, [upsert]);

  // Pull whatever's currently live in the relay. Items already known
  // locally (added on this device) are left alone so we don't clobber
  // the in-memory File or object URL they carry.
  const loadLive = useCallback(async () => {
    const res = await fetch("/api/items", { cache: "no-store" });
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

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const configRes = await fetch("/api/config").catch(() => null);
      if (configRes?.ok) {
        const { redisConfigured } = await configRes.json();
        if (!cancelled) setLiveConfigured(redisConfigured);
      }
      await Promise.all([loadSaved(), loadLive()]);
      if (!cancelled) setLoading(false);
    }

    init();
    const interval = setInterval(() => {
      loadSaved();
      loadLive();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loadSaved, loadLive]);

  const broadcast = useCallback(
    async (record: RelayRecord) => {
      try {
        const res = await fetch("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(record),
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
            broadcast({
              id,
              kind,
              name: file.name,
              size: file.size,
              mime: file.type || null,
              createdAt,
              text: null,
              content,
            });
          });
        } else {
          upsert({
            ...itemsRef.current[id],
            error: "Too large to share live, save it to send it across.",
          } as DockItem);
        }
      }
    },
    [upsert, broadcast]
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

      broadcast({ id, kind: "text", name, size, mime: "text/plain", createdAt, text, content: null });
    },
    [upsert, broadcast]
  );

  const saveItem = useCallback(
    async (id: string) => {
      if (!supabase) {
        upsert({ ...itemsRef.current[id], error: "Supabase isn't configured yet." } as DockItem);
        return;
      }

      const item = itemsRef.current[id];
      if (!item || item.saved) return;

      upsert({ ...item, saving: true, error: null });

      try {
        let storagePath: string | null = null;
        const blob: File | Blob | null =
          item.file ?? (item.content ? base64ToBlob(item.content, item.mime) : null);

        if (blob) {
          storagePath = `${Date.now()}-${safeName(item.name)}`;
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, blob, {
              contentType: item.mime ?? undefined,
              upsert: false,
            });
          if (uploadError) throw uploadError;
        }

        const { data, error: insertError } = await supabase
          .from(TABLE)
          .insert({
            kind: item.kind,
            name: item.name,
            size: item.size,
            mime: item.mime,
            storage_path: storagePath,
            text_content: item.text,
          })
          .select()
          .single();

        if (insertError) throw insertError;

        const remoteUrl = storagePath
          ? supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl
          : null;

        upsert({
          ...item,
          saved: true,
          saving: false,
          storageId: data.id,
          storagePath,
          remoteUrl,
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
    [upsert]
  );

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

      if (!supabase) return;
      upsert({ ...item, removing: true });

      try {
        if (item.storagePath) {
          await supabase.storage.from(BUCKET).remove([item.storagePath]);
        }
        if (item.storageId) {
          await supabase.from(TABLE).delete().eq("id", item.storageId);
        }
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

  const copyText = useCallback((id: string) => {
    const item = itemsRef.current[id];
    if (item?.text) navigator.clipboard.writeText(item.text);
  }, []);

  const ordered = Object.values(items).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-lg font-semibold text-ink">Dock</h1>
        <p className="mt-1 text-sm text-muted">
          Send files or text from your phone, pick them up on your PC.
          Nothing is kept for good unless you save it.
        </p>
      </header>

      {!liveConfigured && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Live sharing isn't set up yet, so items only show on this device.
          Add Upstash Redis to sync across devices, see the README.
        </div>
      )}

      {!supabaseConfigured && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Supabase isn't configured, so Save is disabled. Live sharing still
          works without it.
        </div>
      )}

      {loadError && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Couldn't load saved items: {loadError}
        </div>
      )}

      <Dropzone onFiles={addFiles} />
      <TextComposer onAdd={addText} />

      <section className="flex flex-col gap-2">
        {loading ? (
          <p className="py-6 text-center text-sm text-faint">Loading…</p>
        ) : ordered.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">
            Nothing here yet. Drop a file or add some text above.
          </p>
        ) : (
          ordered.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onSave={saveItem}
              onRemove={removeItem}
              onCopy={copyText}
            />
          ))
        )}
      </section>
    </main>
  );
}
