export type ItemKind = "text" | "image" | "pdf" | "zip" | "file";

export interface DockItem {
  id: string;
  kind: ItemKind;
  name: string;
  size: number;
  mime: string | null;
  createdAt: string;
  saved: boolean;
  saving: boolean;
  removing: boolean;
  error: string | null;
  /** local blob URL, only present for items not yet saved (or previewable after save) */
  localUrl: string | null;
  /** raw File, kept in memory until saved */
  file: File | null;
  /** inline text content for text items */
  text: string | null;
  /** public URL once persisted to Supabase storage */
  remoteUrl: string | null;
  /** row id in the items table once saved */
  storageId: string | null;
  /** storage object path once saved */
  storagePath: string | null;
}
