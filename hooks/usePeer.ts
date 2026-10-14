"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Peer, PeerHandlers } from "@/lib/p2p/peer";

/** Owns the single Peer for the page and the browser-level niceties around it. */
export function usePeer(handlers: PeerHandlers) {
  const [peer] = useState(() => new Peer());

  // Always call the latest handlers without rebuilding the connection.
  useEffect(() => {
    peer.handlers = handlers;
  });

  const snap = useSyncExternalStore(peer.subscribe, peer.getSnapshot, peer.getSnapshot);
  const connected = snap.status === "connected";
  const busy = snap.transfers.some((t) => t.status === "active" || t.status === "preparing");

  // A transfer dies if the phone's screen locks, so keep it awake while paired.
  useEffect(() => {
    if (!connected || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) next.release().catch(() => {});
        else lock = next;
      } catch {
        // not allowed (battery saver etc.), nothing to do
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release().catch(() => {});
    };
  }, [connected]);

  // Leaving mid-transfer would silently kill it, so ask first.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => {
    const leave = () => peer.disconnect();
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, [peer]);

  return { peer, snap };
}
