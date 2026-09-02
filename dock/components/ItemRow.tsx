"use client";

import { DockItem } from "@/lib/types";
import { formatBytes, formatTime } from "@/lib/format";
import { KindIcon } from "./icons";

interface Props {
  item: DockItem;
  onSave: (id: string) => void;
  onRemove: (id: string) => void;
  onCopy: (id: string) => void;
}

export default function ItemRow({ item, onSave, onRemove, onCopy }: Props) {
  const downloadHref =
    item.remoteUrl ??
    item.localUrl ??
    (item.text
      ? URL.createObjectURL(new Blob([item.text], { type: "text/plain" }))
      : undefined);

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

        {item.kind === "image" && item.localUrl && (
          <img
            src={item.localUrl}
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

            {downloadHref && (
              <a
                href={downloadHref}
                download={item.kind === "text" ? `${item.name}.txt` : item.name}
                className="text-xs text-muted hover:text-ink"
              >
                Download
              </a>
            )}

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

        {item.error && (
          <p className="mt-2 text-xs text-warn">{item.error}</p>
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
  return (
    <span className="rounded-sm bg-surfaceRaised px-1.5 py-0.5 text-[11px] text-muted">
      Not saved, clears when you leave
    </span>
  );
}
