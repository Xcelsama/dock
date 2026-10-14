import { randomBytes } from "crypto";

// Pairing sessions only carry connection setup (WebRTC offer/answer and
// network candidates), a few KB of text. Files never pass through here.
export const PAIR_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i
export const PAIR_CODE_LENGTH = 10; // ~49 bits
export const PAIR_WAIT_TTL_SECONDS = 5 * 60; // how long a QR stays scannable
export const PAIR_JOINED_TTL_SECONDS = 2 * 60; // after a scan, time to finish connecting
export const PAIR_MAX_MESSAGES = 60;
export const PAIR_MAX_MESSAGE_BYTES = 16 * 1024;

export type PairRole = "host" | "guest";

export function newPairCode(): string {
  const bytes = randomBytes(PAIR_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < PAIR_CODE_LENGTH; i++) {
    out += PAIR_ALPHABET[bytes[i] % PAIR_ALPHABET.length];
  }
  return out;
}

export function isPairCode(code: string): boolean {
  return (
    code.length === PAIR_CODE_LENGTH &&
    [...code].every((c) => PAIR_ALPHABET.includes(c))
  );
}

export const sessionKey = (code: string) => `dock:pair:${code}`;
export const mailboxKey = (code: string, role: PairRole) => `dock:pair:${code}:${role}`;
