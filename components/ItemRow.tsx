"use client";

import { memo } from "react";
import { DockItem } from "@/lib/types";
import { formatBytes, formatTime } from "@/lib/format";
import { downloadItem } from "@/lib/download";
import { KindIcon, PinIcon, RestoreIcon, SendIcon, TrashIcon } from "./icons";

interface Props {
  item: DockItem;
  onSave: (id: string) => void;
  onRemove: (id: string) => void;
  onCopy: (id: string) => void;
  /** Send straight to a paired device (opens the QR pairing if none yet). */
  onSend?: (id: string) => void;
  /** Pinning needs permanent storage, so this is off when Supabase isn't set up. */
  canPin?: boolean;
  onPin?: (id: string) => void;
  onUnpin?: (id: string) => void;
  /** Trash view: swaps Save/Remove for Restore/Delete forever. */
  variant?: "default" | "trash";
  onRestore?: (id: string) => void;
  onPurge?: (id: string) => void;
}

function previewUrl(item: DockItem): string | undefined {
  if (item.remoteUrl) return item.remoteUrl;
  if (item.localUrl) return item.localUrl;
  if (item.content) return `data:${item.mime ?? "application/octet-stream"};base64,${item.content}`;
  return undefined;
}

function ItemRow({
  item,
  onSave,
  onRemove,
  onCopy,
  onSend,
  canPin = false,
  onPin,
  onUnpin,
  variant = "default",
  onRestore,
  onPurge,
}: Props) {
  const href = previewUrl(item);
  const pinned = Boolean(item.pinnedAt) && variant !== "trash";
  const pinLabel =
    item.pinOp === "pin" ? "Pinning…" : item.pinOp === "unpin" ? "Unpinning…" : item.pinnedAt ? "Unpin" : "Pin";

  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-surface p-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-surfaceRaised text-muted">
        <KindIcon kind={item.kind} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-ink">
            {pinned && (
              <span className="shrink-0 text-accent" role="img" aria-label="Pinned">
                <PinIcon filled />
              </span>
            )}
            <span className="truncate">{item.name}</span>
          </p>
          <span className="shrink-0 font-mono text-xs text-faint">{formatTime(item.createdAt)}</span>
        </div>

        {item.kind === "text" && item.text && (
          <p className="mt-1 line-clamp-2 text-xs text-muted">{item.text}</p>
        )}

        {item.kind === "image" && href && (
          <img
            src={href}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className="mt-2 max-h-40 rounded-sm border border-border object-contain"
          />
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-xs text-faint">{formatBytes(item.size)}</span>

          <StatusBadge item={item} variant={variant} />

          <div className="ml-auto flex flex-wrap items-center gap-3">
            {item.kind === "text" && (
              <button onClick={() => onCopy(item.id)} className="text-xs text-muted hover:text-ink">
                Copy
              </button>
            )}

            {variant !== "trash" && onSend && (
              <button
                onClick={() => onSend(item.id)}
                className="flex items-center gap-1 text-xs font-medium text-accent hover:text-ink"
              >
                <SendIcon />
                Send
              </button>
            )}

            {variant !== "trash" && canPin && (
              <button
                onClick={() => (item.pinnedAt ? onUnpin?.(item.id) : onPin?.(item.id))}
                disabled={item.pinOp !== null || item.saving}
                title={
                  item.pinnedAt
                    ? "Take this off the pinned list"
                    : item.saved
                      ? "Keep this at the top, however old it gets"
                      : "Keep this at the top. It's saved first, so it isn't lost."
                }
                className={`flex items-center gap-1 text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                  item.pinnedAt ? "font-medium text-accent hover:text-ink" : "text-muted hover:text-ink"
                }`}
              >
                <PinIcon filled={Boolean(item.pinnedAt)} />
                {pinLabel}
              </button>
            )}

            <button onClick={() => downloadItem(item)} className="text-xs text-muted hover:text-ink">
              Download
            </button>

            {variant === "trash" ? (
              <>
                <button
                  onClick={() => onRestore?.(item.id)}
                  disabled={item.removing}
                  className="flex items-center gap-1 text-xs font-medium text-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RestoreIcon />
                  Restore
                </button>
                <button
                  onClick={() => onPurge?.(item.id)}
                  disabled={item.removing}
                  className="text-xs text-muted hover:text-warn disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {item.removing ? "Deleting…" : "Delete forever"}
                </button>
              </>
            ) : (
              <>
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
                  className="flex items-center gap-1 text-xs text-muted hover:text-warn disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <TrashIcon />
                  {item.removing ? "Removing…" : item.saved ? "Move to trash" : "Remove"}
                </button>
              </>
            )}
          </div>
        </div>

        {item.error && <p className="mt-2 text-xs text-warn">{item.error}</p>}
      </div>
    </div>
  );
}

// Rows only re-render when their own item changes. Typing in the search box,
// or a poll that found nothing new, no longer repaints every row (and every
// image) in the list.
export default memo(ItemRow);

function StatusBadge({ item, variant }: { item: DockItem; variant: "default" | "trash" }) {
  if (variant === "trash") {
    return <span className="rounded-sm bg-warn/10 px-1.5 py-0.5 text-[11px] text-warn">In Trash</span>;
  }
  if (item.saved) {
    return <span className="rounded-sm bg-accentDim/20 px-1.5 py-0.5 text-[11px] text-accent">Saved</span>;
  }
  if (item.broadcast) {
    return (
      <span className="rounded-sm bg-surfaceRaised px-1.5 py-0.5 text-[11px] text-muted">
        Live on your other devices, not saved yet
      </span>
    );
  }
  if (item.viaP2p) {
    return (
      <span className="rounded-sm bg-surfaceRaised px-1.5 py-0.5 text-[11px] text-muted">
        Received directly, this device only
      </span>
    );
  }
  return (
    <span className="rounded-sm bg-surfaceRaised px-1.5 py-0.5 text-[11px] text-muted">
      This device only, clears when you leave
    </span>
  );
}
