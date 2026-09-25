"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

// Point-of-app: get something from your phone to your PC (or back).
// Typing this site's URL into a phone is the annoying first step, so a
// scannable QR code of the current page removes it.
export default function ShareQr() {
  const [open, setOpen] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    QRCode.toDataURL(window.location.href, { margin: 1, width: 200 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-muted underline underline-offset-2 hover:text-ink"
      >
        {open ? "Hide QR" : "Scan on another device"}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-52 rounded-md border border-border bg-surface p-3 shadow-lg">
          {dataUrl ? (
            <img src={dataUrl} alt="QR code for this page" className="mx-auto h-40 w-40" />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center text-xs text-faint">
              Generating…
            </div>
          )}
          <p className="mt-2 break-all text-center text-[10px] text-faint">
            Scan with your other device's camera
          </p>
        </div>
      )}
    </div>
  );
}
