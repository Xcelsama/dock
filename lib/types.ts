export type ItemKind = "text" | "image" | "pdf" | "zip" | "file";

export interface DockItem {
  id: string;
  kind: ItemKind;
  name: string;
  size: number;
  mime: string | null;
  createdAt: string;

  /** persisted permanently in Supabase */
  saved: boolean;
  /** currently visible to other devices via the Redis relay */
  broadcast: boolean;
  /** arrived over a direct device-to-device (QR) transfer, never touched a server */
  viaP2p: boolean;
  /** set once a saved item has been moved to Trash; null otherwise */
  deletedAt: string | null;

  saving: boolean;
  removing: boolean;
  error: string | null;

  /** local blob URL, only present on the device that added the file */
  localUrl: string | null;
  /** raw File, only present on the device that added it, until saved */
  file: File | null;
  /** inline text content for text items */
  text: string | null;
  /** base64 payload, present once fetched from the Redis relay */
  content: string | null;

  /** same-origin URL (/api/saved/<id>/file) once persisted to Supabase */
  remoteUrl: string | null;
  /** row id in the Supabase table once saved (same as `id`) */
  storageId: string | null;
}

export interface RelayRecord {
  id: string;
  kind: ItemKind;
  name: string;
  size: number;
  mime: string | null;
  createdAt: string;
  text: string | null;
  content: string | null;
}

/** Shape returned by /api/saved. `remoteUrl` is a stable same-origin path
 *  (never a signed URL), so it can be cached by the browser and doesn't
 *  change between polls. */
export interface SavedRecord {
  id: string;
  kind: ItemKind;
  name: string;
  size: number;
  mime: string | null;
  createdAt: string;
  textContent: string | null;
  remoteUrl: string | null;
  deletedAt: string | null;
}
