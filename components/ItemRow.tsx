"use client";

import { useState } from "react";
import { DockItem } from "@/lib/types";
import { formatBytes, formatTime } from "@/lib/format";
import { KindIcon } from "./icons";

interface Props {
  item: DockItem;
  onSave: (id: string) => void;
  onRemove: (id: string) => void;
  onCopy: (id: string) => void;
}

function previewUrl(item: DockItem): string | undefined {
  if (item.remoteUrl) return item.remoteUrl;
  if (item.localUrl) return item.localUrl;
  if (item.content) return `data:${item.mime ?? "application/octet-stream"};base64,${item.content}`;
  return undefined;
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function ItemRow({ item, onSave, onRemove, onCopy }: Props) {
  const href = previewUrl(item);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const filename = item.kind === "text" ? `${item.name}.txt` : item.name;

  async function handleDownload() {
    setDownloadError(null);

    // Text items: build the file fresh from the in-memory string.
    if (item.kind === "text" && item.text) {
      const url = URL.createObjectURL(new Blob([item.text], { type: "text/plain" }));
      triggerDownload(url, filename);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }

    // Local blob: or data: URLs already honor the download attribute,
    // no fetch needed.
    if (item.localUrl) {
      triggerDownload(item.localUrl, filename);
      return;
    }
    if (item.content) {
      triggerDownload(
        `data:${item.mime ?? "application/octet-stream"};base64,${item.content}`,
        filename
      );
      return;
    }

    // Saved items live on the Supabase storage domain, a different
    // origin than the site itself, so the browser ignores `download`
    // on a plain link to it and just opens the file instead. Fetching
    // the bytes first and downloading from that in-memory copy avoids
    // the cross-origin restriction.
    if (item.remoteUrl) {
      setDownloading(true);
      try {
        const res = await fetch(item.remoteUrl);
        if (!res.ok) throw new Error("Download failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        triggerDownload(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch {
        setDownloadError("Couldn't download, opening it instead.");
        window.open(item.remoteUrl, "_blank");
      } finally {
        setDownloading(false);
      }
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-surface p-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surfaceRaised text-muted">
        <KindIcon kind={item.kind} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm text-ink">{item.name}</p>
          <span className="shrink-0 font-mono text-xs text-faint">
            {formatTime(item.createdAt)}
          </span>
        </div>

        {item.kind === "text" && item.text && (
          <p className="mt-1 line-clamp-2 text-xs text-muted">{item.text}</p>
        )}

        {item.kind === "image" && href && (
          <img
            src={href}
            alt={item.name}
            className="mt-2 max-h-40 rounded-sm border border-border object-contain"
          />
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-faint">
            {formatBytes(item.size)}
          </span>

          <StatusBadge item={item} />

          <div className="ml-auto flex items-center gap-3">
            {item.kind === "text" && (
              <button
                onClick={() => onCopy(item.id)}
                className="text-xs text-muted hover:text-ink"
              >
                Copy
              </button>
            )}

            <button
              onClick={handleDownload}
              disabled={downloading}
              className="text-xs text-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloading ? "Downloading…" : "Download"}
            </button>

            {!item.saved && (
              <button
                onClick={() => onSave(item.id)}
                disabled={item.saving}
                className="text-xs font-medium text-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {item.saving ? "Saving…" : "Save"}
              </button>
            )}

            <button
              onClick={() => onRemove(item.id)}
              disabled={item.removing}
              className="text-xs text-muted hover:text-warn disabled:cursor-not-allowed disabled:opacity-50"
            >
              {item.removing ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>

        {(item.error || downloadError) && (
          <p className="mt-2 text-xs text-warn">{item.error ?? downloadError}</p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ item }: { item: DockItem }) {
  if (item.saved) {
    return (
      <span className="rounded-sm bg-accentDim/20 px-1.5 py-0.5 text-[11px] text-accent">
        Saved
      </span>
    );
  }
  if (item.broadcast) {
    return (
      <span className="rounded-sm bg-surfaceRaised px-1.5 py-0.5 text-[11px] text-muted">
        Live on your other devices, not saved yet
      </span>
    );
  }
  return (
    <span className="rounded-sm bg-surfaceRaised px-1.5 py-0.5 text-[11px] text-muted">
      This device only, clears when you leave
    </span>
  );
}
