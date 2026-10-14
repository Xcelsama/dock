const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

const GENERIC_NAME = /^(image|screenshot|blob|unnamed)?\.?(png|jpe?g|gif|webp|bmp)?$/i;

function stamp(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Pasted screenshots all arrive called "image.png"; give them a real name. */
function nameFile(file: File, index: number): File {
  if (file.name && !GENERIC_NAME.test(file.name)) return file;
  const ext = IMAGE_EXT[file.type] ?? (file.name.split(".").pop() || "bin");
  const suffix = index > 0 ? `-${index + 1}` : "";
  return new File([file], `pasted-${stamp(new Date())}${suffix}.${ext}`, {
    type: file.type,
    lastModified: file.lastModified || Date.now(),
  });
}

type EntryItem = DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null };

/**
 * Pulls files out of a paste or drop. Must be called synchronously inside the
 * event handler (the browser invalidates the data afterwards). Folders can't
 * be read as a single file, so they're counted and reported instead of
 * silently turning into broken zero-byte entries.
 */
export function extractFiles(dt: DataTransfer): { files: File[]; folders: number } {
  const files: File[] = [];
  let folders = 0;

  const fileItems = Array.from(dt.items ?? []).filter((i) => i.kind === "file");
  if (fileItems.length) {
    for (const item of fileItems) {
      const entry = (item as EntryItem).webkitGetAsEntry?.();
      if (entry?.isDirectory) {
        folders++;
        continue;
      }
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  } else {
    files.push(...Array.from(dt.files ?? []));
  }

  return { files: files.map(nameFile), folders };
}

export function hasFileItems(dt: DataTransfer | null): boolean {
  return Array.from(dt?.items ?? []).some((i) => i.kind === "file");
}
