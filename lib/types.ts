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

  /** public URL once persisted to Supabase storage */
  remoteUrl: string | null;
  /** row id in the Supabase table once saved */
  storageId: string | null;
  /** storage object path once saved */
  storagePath: string | null;
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

/** Shape returned by /api/saved. Files no longer have a stable public
 *  URL — `remoteUrl` is a signed URL minted fresh for this response and
 *  expires within the hour, so it's never worth caching client-side. */
export interface SavedRecord {
  id: string;
  kind: ItemKind;
  name: string;
  size: number;
  mime: string | null;
  createdAt: string;
  textContent: string | null;
  storagePath: string | null;
  remoteUrl: string | null;
  deletedAt: string | null;
}
