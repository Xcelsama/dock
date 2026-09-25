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
