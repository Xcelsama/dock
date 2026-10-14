"use client";

import { useEffect, useRef, useState } from "react";
import { PeerSnapshot, Transfer } from "@/lib/p2p/peer";
import { codeFromInput, formatCode } from "@/lib/p2p/protocol";
import { formatBytes } from "@/lib/format";

interface Props {
  snap: PeerSnapshot;
  onHost: () => void;
  onJoin: (code: string) => void;
  onSendFiles: (files: File[]) => void;
  onCancelTransfer: (id: string) => void;
  onClearFinished: () => void;
  onDisconnect: () => void;
  onClose: () => void;
}

export default function PairModal({
  snap,
  onHost,
  onJoin,
  onSendFiles,
  onCancelTransfer,
  onClearFinished,
  onDisconnect,
  onClose,
}: Props) {
  const [qr, setQr] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const fileInput = useRef<HTMLInputElement>(null);

  const { status, code } = snap;
  const link = code && typeof window !== "undefined" ? `${window.location.origin}/?pair=${code}` : null;

  // Closing while still waiting for a scan cancels the code (it would
  // otherwise keep polling in the background for nothing).
  function close() {
    if (status === "waiting") onDisconnect();
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (status === "waiting") onDisconnect();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status, onClose, onDisconnect]);

  // The QR library is only pulled in when a code is actually shown.
  useEffect(() => {
    if (!link || status !== "waiting") {
      setQr(null);
      return;
    }
    let cancelled = false;
    import("qrcode")
      .then((m) => m.default.toDataURL(link, { margin: 2, width: 288, errorCorrectionLevel: "M" }))
      .then((url) => {
        if (!cancelled) setQr(url);
      })
      .catch(() => {
        if (!cancelled) setQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [link, status]);

  useEffect(() => {
    if (status !== "waiting") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  const secondsLeft = snap.expiresAt ? Math.max(0, Math.ceil((snap.expiresAt - now) / 1000)) : null;
  const queued = snap.transfers.filter((t) => t.status === "queued").length;
  const finished = snap.transfers.some((t) => !["queued", "preparing", "active"].includes(t.status));

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pair a device"
        onMouseDown={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-lg border border-border bg-surface p-4 sm:max-w-md sm:rounded-md"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">
              {status === "connected" ? "Connected" : "Send to another device"}
            </h2>
            <p className="mt-1 text-xs text-muted">
              Files go straight from one device to the other. They aren&apos;t uploaded to the server or the database.
            </p>
          </div>
          <button onClick={close} aria-label="Close" className="text-xl leading-none text-muted hover:text-ink">
            ×
          </button>
        </div>

        {status === "idle" && (
          <div className="mt-4 flex flex-col gap-4">
            <button
              onClick={onHost}
              className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-[#101314] hover:opacity-90"
            >
              Show QR code
            </button>
            <JoinBox typed={typed} setTyped={setTyped} onJoin={onJoin} />
          </div>
        )}

        {status === "waiting" && (
          <div className="mt-4 flex flex-col items-center gap-3">
            {qr ? (
              // White background is deliberate: dark-on-light is what cameras scan most reliably.
              <img src={qr} alt="QR code to pair with this device" className="h-60 w-60 rounded-md bg-white" />
            ) : (
              <div className="flex h-60 w-60 items-center justify-center rounded-md bg-surfaceRaised text-xs text-faint">
                {code ? "Drawing code…" : "Getting a code…"}
              </div>
            )}
            <p className="text-center text-sm text-ink">
              Scan this with the other device&apos;s camera
              {queued > 0 ? ` to send ${queued === 1 ? "your file" : `${queued} files`}` : ""}.
            </p>
            {code && (
              <p className="font-mono text-lg tracking-widest text-ink" aria-label="Pairing code">
                {formatCode(code)}
              </p>
            )}
            <p className="text-xs text-faint">
              Waiting for the other device…{secondsLeft !== null ? ` Code expires in ${formatClock(secondsLeft)}.` : ""}
            </p>
            <p className="text-xs text-faint">
              No camera? Open Dock on the other device, choose <span className="text-muted">Send to another device</span>, and type the code.
            </p>
            <button onClick={close} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
              Cancel
            </button>
          </div>
        )}

        {status === "connecting" && (
          <div className="mt-6 flex flex-col items-center gap-3 pb-2">
            <p className="text-sm text-ink">Connecting to the other device…</p>
            <p className="text-xs text-faint">This usually takes a few seconds.</p>
            <button onClick={onDisconnect} className="text-xs text-muted underline underline-offset-2 hover:text-ink">
              Cancel
            </button>
          </div>
        )}

        {(status === "failed" || status === "closed") && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              {snap.error ?? "The connection ended."}
            </p>
            {queued > 0 && (
              <p className="text-xs text-muted">
                {queued === 1 ? "Your file is" : `Your ${queued} files are`} still queued and will go out as soon as a device connects.
              </p>
            )}
            <button
              onClick={onHost}
              className="rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-[#101314] hover:opacity-90"
            >
              Show a new QR code
            </button>
            <JoinBox typed={typed} setTyped={setTyped} onJoin={onJoin} />
          </div>
        )}

        {status === "connected" && (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-md bg-surfaceRaised px-3 py-2">
              <p className="flex min-w-0 items-center gap-2 text-sm text-ink">
                <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                <span className="truncate">{snap.peerLabel ?? "Another device"}</span>
              </p>
              <button onClick={onDisconnect} className="shrink-0 text-xs text-muted hover:text-warn">
                Disconnect
              </button>
            </div>

            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) onSendFiles(files);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-ink hover:border-borderStrong"
            >
              Choose files to send
            </button>
            <p className="text-xs text-faint">
              Either device can send. You can also tap <span className="text-muted">Send</span> on any item in your Dock. Keep this page open while files move.
            </p>
          </div>
        )}

        {snap.transfers.length > 0 && (
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted">Transfers</p>
              {finished && (
                <button onClick={onClearFinished} className="text-xs text-faint hover:text-ink">
                  Clear finished
                </button>
              )}
            </div>
            {snap.transfers.map((t) => (
              <TransferRow key={t.id} t={t} onCancel={onCancelTransfer} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JoinBox({
  typed,
  setTyped,
  onJoin,
}: {
  typed: string;
  setTyped: (v: string) => void;
  onJoin: (code: string) => void;
}) {
  const code = codeFromInput(typed);
  return (
    <div className="border-t border-border pt-3">
      <p className="text-xs text-muted">Other device is showing a code? Type it here instead of scanning.</p>
      <div className="mt-2 flex gap-2">
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.length === 10) onJoin(code);
          }}
          placeholder="abcde-fghij"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-border bg-base px-3 py-1.5 font-mono text-sm text-ink placeholder:text-faint focus:border-borderStrong focus:outline-none"
        />
        <button
          onClick={() => onJoin(code)}
          disabled={code.length !== 10}
          className="rounded-md bg-surfaceRaised px-3 py-1.5 text-xs font-medium text-ink hover:bg-borderStrong disabled:cursor-not-allowed disabled:opacity-40"
        >
          Connect
        </button>
      </div>
    </div>
  );
}

function TransferRow({ t, onCancel }: { t: Transfer; onCancel: (id: string) => void }) {
  const pct = t.size > 0 ? Math.min(100, Math.round((t.bytes / t.size) * 100)) : t.status === "done" ? 100 : 0;
  const live = t.status === "active" || t.status === "preparing" || t.status === "queued";
  const arrow = t.direction === "send" ? "↑" : "↓";

  let detail: string;
  switch (t.status) {
    case "queued":
      detail = "Waiting to connect…";
      break;
    case "preparing":
      detail = "Getting the file ready…";
      break;
    case "active":
      detail = `${pct}% · ${formatBytes(t.bytes)} of ${formatBytes(t.size)}${t.speedBps > 0 ? ` · ${formatBytes(t.speedBps)}/s` : ""}`;
      break;
    case "done":
      detail = `${t.direction === "send" ? "Sent" : "Received"} · ${formatBytes(t.size)}`;
      break;
    case "canceled":
      detail = "Canceled";
      break;
    default:
      detail = t.error ?? "Failed";
  }

  return (
    <div className="rounded-md bg-surfaceRaised px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm text-ink">
          <span className="mr-1.5 text-muted">{arrow}</span>
          {t.name}
        </p>
        {live && (
          <button onClick={() => onCancel(t.id)} className="shrink-0 text-xs text-muted hover:text-warn">
            Cancel
          </button>
        )}
      </div>
      {t.status === "active" && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
          <div className="h-full bg-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className={`mt-1 text-xs ${t.status === "error" ? "text-warn" : "text-faint"}`}>{detail}</p>
    </div>
  );
}

function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
