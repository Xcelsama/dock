"use client";

import { DockItem } from "@/lib/types";
import { formatBytes } from "@/lib/format";

export interface TransferPrompt {
  key: string;
  direction: "sent" | "received";
  itemId: string;
  name: string;
  size: number;
  peerLabel: string | null;
}

interface Props {
  prompts: TransferPrompt[];
  items: Record<string, DockItem>;
  canSave: boolean;
  onSave: (id: string) => void;
  onDownload: (id: string) => void;
  onDismiss: (key: string) => void;
}

const MAX_VISIBLE = 3;

// Pops up after every successful device-to-device transfer. A direct
// transfer never touches the database, so this is the one place you decide
// whether to keep a permanent copy.
export default function TransferPrompts({ prompts, items, canSave, onSave, onDownload, onDismiss }: Props) {
  if (!prompts.length) return null;
  const visible = prompts.slice(-MAX_VISIBLE).reverse();
  const hidden = prompts.length - visible.length;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 p-3 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-96 sm:p-0"
      role="status"
      aria-live="polite"
    >
      {visible.map((p) => {
        const item = items[p.itemId];
        const received = p.direction === "received";
        const saved = item?.saved ?? false;
        const saving = item?.saving ?? false;

        return (
          <div key={p.key} className="rounded-md border border-border bg-surfaceRaised p-3 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">
                  {received ? "Received" : "Sent"} <span className="font-medium">{p.name}</span>
                </p>
                <p className="mt-0.5 text-xs text-faint">
                  {formatBytes(p.size)}
                  {p.peerLabel ? ` · ${received ? "from" : "to"} ${p.peerLabel}` : ""}
                </p>
              </div>
              <button
                onClick={() => onDismiss(p.key)}
                aria-label="Dismiss"
                className="shrink-0 text-lg leading-none text-muted hover:text-ink"
              >
                ×
              </button>
            </div>

            {saved ? (
              <p className="mt-2 text-xs text-accent">Saved to Dock ✓</p>
            ) : !item ? (
              <p className="mt-2 text-xs text-faint">This item has since been removed.</p>
            ) : (
              <>
                <p className="mt-2 text-xs text-muted">
                  {received
                    ? "It only exists on this device right now. Keep a permanent copy in Dock?"
                    : "Keep a permanent copy of this in Dock too?"}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {canSave && (
                    <button
                      onClick={() => onSave(p.itemId)}
                      disabled={saving}
                      className="rounded-sm bg-accent px-3 py-1.5 text-xs font-medium text-[#101314] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? "Saving…" : item.error ? "Try saving again" : "Save to Dock"}
                    </button>
                  )}
                  {received && (
                    <button
                      onClick={() => onDownload(p.itemId)}
                      className="rounded-sm bg-surface px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-borderStrong"
                    >
                      Download
                    </button>
                  )}
                  <button onClick={() => onDismiss(p.key)} className="px-2 py-1.5 text-xs text-muted hover:text-ink">
                    Not now
                  </button>
                </div>
                {!canSave && (
                  <p className="mt-2 text-xs text-faint">Saving isn&apos;t set up (Supabase), so download it to keep it.</p>
                )}
                {item.error && <p className="mt-2 text-xs text-warn">{item.error}</p>}
              </>
            )}
          </div>
        );
      })}
      {hidden > 0 && <p className="text-center text-xs text-faint">+{hidden} more</p>}
    </div>
  );
}
