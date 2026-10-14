import type { ItemKind } from "@/lib/types";

export const CHUNK_BYTES = 64 * 1024;
export const READ_AHEAD_BYTES = 1024 * 1024;
export const HIGH_WATER = 4 * 1024 * 1024; // pause sending above this much buffered
export const LOW_WATER = 1024 * 1024; // resume below this
export const RECEIVE_FLUSH_BYTES = 8 * 1024 * 1024; // fold chunks into a Blob this often
export const MAX_P2P_BYTES = 1024 * 1024 * 1024; // 1 GB, receiver holds the file in memory
export const CONNECT_TIMEOUT_MS = 25_000;

export type Role = "host" | "guest";

/** Messages exchanged through the Redis mailbox, only to set up the connection. */
export type Signal =
  | { type: "join" }
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidates: RTCIceCandidateInit[] }
  | { type: "bye" };

/** Text frames on the data channel. File bytes follow as binary frames. */
export type Control =
  | { t: "hello"; label: string }
  | { t: "file"; id: string; kind: ItemKind; name: string; size: number; mime: string | null; createdAt: string }
  | { t: "text"; id: string; name: string; text: string; createdAt: string }
  | { t: "end"; id: string }
  | { t: "done"; id: string; ok: boolean; error?: string }
  | { t: "cancel"; id: string }
  | { t: "bye" };

export function normalizeCode(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function formatCode(code: string): string {
  return code.length > 5 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

/** Pulls a pairing code out of a pasted link or a typed code. */
export function codeFromInput(input: string): string {
  try {
    const url = new URL(input.trim());
    const fromUrl = url.searchParams.get("pair");
    if (fromUrl) return normalizeCode(fromUrl);
  } catch {
    // not a URL, treat as a typed code
  }
  return normalizeCode(input);
}

export function deviceLabel(): string {
  if (typeof navigator === "undefined") return "device";
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "Chromebook"
              : /Linux/.test(ua)
                ? "Linux"
                : "device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "browser";
  return `${os} · ${browser}`;
}
