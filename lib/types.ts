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
  /** when the item was pinned; null if it isn't. Pinned items are always loaded and sit at the top. */
  pinnedAt: string | null;

  saving: boolean;
  removing: boolean;
  /** a pin or unpin request is in flight */
  pinOp: "pin" | "unpin" | null;
  error: string | null;

  /** local blob URL, only present on the device that added the file */
  localUrl: string | null;
  /** raw File, only present on the device that added it, until saved */
  file: File | null;
  /** inline text content for text items */
  text: string | null;
  /** base64 payload, only for items built on this device from a file or paste */
  content: string | null;

  /** same-origin URL for the bytes: /api/saved/<id>/file once persisted to
   *  Supabase, or /api/items/<id>/content while the item is only live in the
   *  relay. Files are never inlined into the list, they load when needed. */
  remoteUrl: string | null;
  /** row id in the Supabase table once saved (same as `id`) */
  storageId: string | null;
}

/** What the live relay lists for an item: everything except the file bytes. */
export interface RelayRecord {
  id: string;
  kind: ItemKind;
  name: string;
  size: number;
  mime: string | null;
  createdAt: string;
  text: string | null;
  /** true when the file bytes are in the relay (fetched from /api/items/<id>/content) */
  hasContent: boolean;
}

/** What a device sends when it shares an item live: the record plus the bytes. */
export type RelayUpload = Omit<RelayRecord, "hasContent"> & {
  content: string | null;
};

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
  pinnedAt: string | null;
}

/** First-page answer for the saved list: recent items plus every pin. */
export interface SavedWindow {
  configured: boolean;
  /** the lower bound the server used, echoed back */
  since: string;
  /** saved items created on/after `since`, newest first */
  items: SavedRecord[];
  /** every pinned item, most recently pinned first, whatever its age */
  pinned: SavedRecord[];
  /** false when the pinned query couldn't run (database not migrated yet) */
  pinsReady: boolean;
  /** more saved items exist beyond what's in `items` */
  hasMore: boolean;
  /** pass as `before` to /api/saved to page further back */
  nextBefore: string | null;
}

export interface LiveListing {
  configured: boolean;
  items: RelayRecord[];
  savedVersion: number | null;
  /** live items exist from before `since` (only set when `since` was given) */
  hasOlder: boolean;
}

export interface Bootstrap {
  live: LiveListing;
  saved: SavedWindow;
}
