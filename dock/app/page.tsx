"use client";

import { useCallback, useEffect, useState } from "react";
import Dropzone from "@/components/Dropzone";
import TextComposer from "@/components/TextComposer";
import ItemRow from "@/components/ItemRow";
import { DockItem } from "@/lib/types";
import { kindFromFile } from "@/lib/format";
import { supabase, supabaseConfigured, BUCKET, TABLE } from "@/lib/supabase";

function uid() {
  return crypto.randomUUID();
}

export default function Page() {
  const [items, setItems] = useState<DockItem[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Load previously saved items from Supabase on first render. These are
  // the only items that survive a refresh, since everything else lives
  // in component state until it's explicitly saved.
  useEffect(() => {
    async function load() {
      if (!supabase) {
        setLoadingSaved(false);
        return;
      }
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        setLoadError(error.message);
        setLoadingSaved(false);
        return;
      }

      const saved: DockItem[] = (data ?? []).map((row) => {
        const remoteUrl = row.storage_path
          ? supabase!.storage.from(BUCKET).getPublicUrl(row.storage_path).data
              .publicUrl
          : null;
        return {
          id: row.id,
          kind: row.kind,
          name: row.name,
          size: row.size,
          mime: row.mime,
          createdAt: row.created_at,
          saved: true,
          saving: false,
          removing: false,
          error: null,
          localUrl: null,
          file: null,
          text: row.text_content,
          remoteUrl,
          storageId: row.id,
          storagePath: row.storage_path,
        };
      });

      setItems(saved);
      setLoadingSaved(false);
    }
    load();
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const next: DockItem[] = files.map((file) => ({
      id: uid(),
      kind: kindFromFile(file),
      name: file.name,
      size: file.size,
      mime: file.type || null,
      createdAt: new Date().toISOString(),
      saved: false,
      saving: false,
      removing: false,
      error: null,
      localUrl: URL.createObjectURL(file),
      file,
      text: null,
      remoteUrl: null,
      storageId: null,
      storagePath: null,
    }));
    setItems((prev) => [...next, ...prev]);
  }, []);

  const addText = useCallback((text: string) => {
    const item: DockItem = {
      id: uid(),
      kind: "text",
      name: text.length > 40 ? `${text.slice(0, 40)}…` : text,
      size: new Blob([text]).size,
      mime: "text/plain",
      createdAt: new Date().toISOString(),
      saved: false,
      saving: false,
      removing: false,
      error: null,
      localUrl: null,
      file: null,
      text,
      remoteUrl: null,
      storageId: null,
      storagePath: null,
    };
    setItems((prev) => [item, ...prev]);
  }, []);

  const patchItem = useCallback((id: string, patch: Partial<DockItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  }, []);

  const saveItem = useCallback(
    async (id: string) => {
      if (!supabase) {
        patchItem(id, {
          error: "Supabase isn't configured. Check your environment variables.",
        });
        return;
      }

      const item = items.find((it) => it.id === id);
      if (!item || item.saved) return;

      patchItem(id, { saving: true, error: null });

      try {
        let storagePath: string | null = null;

        if (item.file) {
          const safeName = item.file.name.replace(/[^\w.\-]+/g, "_");
          storagePath = `${Date.now()}-${safeName}`;
          const { error: uploadError } = await supabase.storage
            .from(BUCKET)
            .upload(storagePath, item.file, {
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
          ? supabase.storage.from(BUCKET).getPublicUrl(storagePath).data
              .publicUrl
          : null;

        patchItem(id, {
          saved: true,
          saving: false,
          storageId: data.id,
          storagePath,
          remoteUrl,
        });
      } catch (err) {
        patchItem(id, {
          saving: false,
          error: err instanceof Error ? err.message : "Save failed",
        });
      }
    },
    [items, patchItem]
  );

  const removeItem = useCallback(
    async (id: string) => {
      const item = items.find((it) => it.id === id);
      if (!item) return;

      if (!item.saved) {
        if (item.localUrl) URL.revokeObjectURL(item.localUrl);
        setItems((prev) => prev.filter((it) => it.id !== id));
        return;
      }

      if (!supabase) return;
      patchItem(id, { removing: true });

      try {
        if (item.storagePath) {
          await supabase.storage.from(BUCKET).remove([item.storagePath]);
        }
        if (item.storageId) {
          await supabase.from(TABLE).delete().eq("id", item.storageId);
        }
        setItems((prev) => prev.filter((it) => it.id !== id));
      } catch (err) {
        patchItem(id, {
          removing: false,
          error: err instanceof Error ? err.message : "Remove failed",
        });
      }
    },
    [items, patchItem]
  );

  const copyText = useCallback(
    (id: string) => {
      const item = items.find((it) => it.id === id);
      if (item?.text) navigator.clipboard.writeText(item.text);
    },
    [items]
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-lg font-semibold text-ink">Dock</h1>
        <p className="mt-1 text-sm text-muted">
          Send files or text from your phone, pick them up on your PC.
          Nothing is kept unless you save it.
        </p>
      </header>

      {!supabaseConfigured && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Supabase environment variables are missing, so Save is disabled.
          Files still work for this session, you just can't persist them yet.
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
        {loadingSaved ? (
          <p className="py-6 text-center text-sm text-faint">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">
            Nothing here yet. Drop a file or add some text above.
          </p>
        ) : (
          items.map((item) => (
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
