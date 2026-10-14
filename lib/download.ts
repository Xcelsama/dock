import { DockItem } from "@/lib/types";

export function triggerDownload(url: string, filename?: string) {
  const a = document.createElement("a");
  a.href = url;
  if (filename) a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadName(item: DockItem): string {
  return item.kind === "text" ? `${item.name}.txt` : item.name;
}

/** Saves an item to the device's own downloads, whichever form it's in. */
export function downloadItem(item: DockItem): boolean {
  const filename = downloadName(item);

  if (item.kind === "text" && item.text) {
    const url = URL.createObjectURL(new Blob([item.text], { type: "text/plain" }));
    triggerDownload(url, filename);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }
  if (item.localUrl) {
    triggerDownload(item.localUrl, filename);
    return true;
  }
  if (item.content) {
    triggerDownload(`data:${item.mime ?? "application/octet-stream"};base64,${item.content}`, filename);
    return true;
  }
  if (item.remoteUrl) {
    // The route behind this URL redirects to a signed Supabase URL that
    // carries a Content-Disposition: attachment header, so a plain
    // navigation downloads the file, no cross-origin blob fetching needed.
    triggerDownload(`${item.remoteUrl}?download=1`);
    return true;
  }
  return false;
}
