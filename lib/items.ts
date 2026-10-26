import { base64ToBlob } from "@/lib/base64";
import { DockItem, RelayRecord, SavedRecord } from "@/lib/types";

type Required = Pick<DockItem, "id" | "kind" | "name" | "size" | "createdAt">;

/** One place that knows the "blank" shape of an item, so callers only
 *  spell out what's different. */
export function makeItem(init: Required & Partial<DockItem>): DockItem {
  return {
    mime: null,
    saved: false,
    broadcast: false,
    viaP2p: false,
    deletedAt: null,
    pinnedAt: null,
    saving: false,
    removing: false,
    pinOp: null,
    error: null,
    localUrl: null,
    file: null,
    text: null,
    content: null,
    remoteUrl: null,
    storageId: null,
    ...init,
  };
}

export function itemFromSaved(row: SavedRecord): DockItem {
  return makeItem({
    id: row.id,
    kind: row.kind,
    name: row.name,
    size: row.size,
    mime: row.mime,
    createdAt: row.createdAt,
    saved: true,
    deletedAt: row.deletedAt,
    pinnedAt: row.pinnedAt ?? null,
    text: row.textContent,
    remoteUrl: row.remoteUrl,
    storageId: row.id,
  });
}

export function itemFromRelay(record: RelayRecord): DockItem {
  return makeItem({
    id: record.id,
    kind: record.kind,
    name: record.name,
    size: record.size,
    mime: record.mime,
    createdAt: record.createdAt,
    broadcast: true,
    text: record.text,
    // The bytes aren't in the list. They load from this URL when the file is
    // previewed, downloaded, saved or sent.
    remoteUrl: record.hasContent ? `/api/items/${record.id}/content` : null,
  });
}

/** The bytes of an item, wherever they live right now. */
export async function blobForItem(item: DockItem): Promise<Blob> {
  if (item.file) return item.file;
  if (item.content) return base64ToBlob(item.content, item.mime);
  if (item.remoteUrl) {
    const res = await fetch(item.remoteUrl);
    if (!res.ok) throw new Error("Couldn't load that file. It may have expired.");
    return res.blob();
  }
  throw new Error("Nothing to send");
}
