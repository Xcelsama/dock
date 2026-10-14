import type { ItemKind } from "@/lib/types";
import { formatBytes } from "@/lib/format";
import {
  CHUNK_BYTES,
  CONNECT_TIMEOUT_MS,
  Control,
  HIGH_WATER,
  LOW_WATER,
  MAX_P2P_BYTES,
  READ_AHEAD_BYTES,
  RECEIVE_FLUSH_BYTES,
  Role,
  Signal,
  deviceLabel,
  normalizeCode,
} from "./protocol";

export type PeerStatus = "idle" | "waiting" | "connecting" | "connected" | "closed" | "failed";
export type TransferStatus = "queued" | "preparing" | "active" | "done" | "error" | "canceled";

export interface Transfer {
  id: string;
  direction: "send" | "receive";
  kind: ItemKind;
  name: string;
  size: number;
  bytes: number;
  status: TransferStatus;
  error: string | null;
  speedBps: number;
}

export interface PeerSnapshot {
  status: PeerStatus;
  role: Role | null;
  code: string | null;
  expiresAt: number | null;
  peerLabel: string | null;
  error: string | null;
  transfers: Transfer[];
  /** true when a TURN relay is configured on the server */
  relay: boolean;
}

export interface OutgoingPayload {
  /** Dock item this came from, handed back in onSent */
  itemId: string;
  kind: ItemKind;
  name: string;
  size: number;
  mime: string | null;
  createdAt: string;
  text?: string | null;
  /** Lazily produces the bytes (saved items are fetched only when their turn comes) */
  getBlob?: () => Promise<Blob>;
}

export interface PeerHandlers {
  onReceivedFile?: (file: File, meta: { kind: ItemKind; createdAt: string; peerLabel: string | null }) => void;
  onReceivedText?: (text: string, meta: { createdAt: string; peerLabel: string | null }) => void;
  onSent?: (info: { itemId: string; name: string; size: number; kind: ItemKind; peerLabel: string | null }) => void;
}

interface Outgoing {
  id: string;
  payload: OutgoingPayload;
  /** set when canceled locally or rejected/canceled remotely */
  abort: string | null;
}

interface Incoming {
  id: string;
  kind: ItemKind;
  name: string;
  size: number;
  mime: string | null;
  createdAt: string;
  received: number;
  pending: ArrayBuffer[];
  pendingBytes: number;
  blobs: Blob[];
}

const INITIAL: PeerSnapshot = {
  status: "idle",
  role: null,
  code: null,
  expiresAt: null,
  peerLabel: null,
  error: null,
  transfers: [],
  relay: false,
};

const MAX_TRANSFER_HISTORY = 20;
const WAIT_POLL_MS = 1500;
const NEGOTIATE_POLL_MS = 500;
const DEFAULT_ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302"] }];

/**
 * One device-to-device connection. The two devices find each other through a
 * short-lived mailbox in Redis (only connection setup passes through it), then
 * talk over a WebRTC data channel. File bytes go straight from one browser to
 * the other and never touch the server or the database.
 */
export class Peer {
  handlers: PeerHandlers = {};

  private snap: PeerSnapshot = INITIAL;
  private listeners = new Set<() => void>();

  // Bumped by every teardown so async work from an old connection can tell
  // it has been superseded and bail out.
  private generation = 0;
  private code: string | null = null;
  private cursor = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  private localCandidates: RTCIceCandidateInit[] = [];
  private candidateTimer: ReturnType<typeof setTimeout> | null = null;
  private descriptionSent = false;

  private queue: Outgoing[] = [];
  private active = new Map<string, Outgoing>();
  private sendingGen = -1;
  private incoming: Incoming | null = null;
  private acks = new Map<string, (r: { ok: boolean; error?: string }) => void>();
  private drainWaiters = new Set<{ resolve: () => void; reject: (e: Error) => void }>();
  private lastEmit = 0;
  private startedAt = new Map<string, number>();

  /* ---------- store plumbing (useSyncExternalStore) ---------- */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<PeerSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.emit();
  }

  private emit() {
    this.lastEmit = Date.now();
    this.listeners.forEach((l) => l());
  }

  private addTransfer(t: Transfer) {
    const transfers = [t, ...this.snap.transfers].slice(0, MAX_TRANSFER_HISTORY);
    this.set({ transfers });
  }

  private updateTransfer(id: string, patch: Partial<Transfer>, throttle = false) {
    const idx = this.snap.transfers.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const transfers = this.snap.transfers.slice();
    transfers[idx] = { ...transfers[idx], ...patch };
    this.snap = { ...this.snap, transfers };
    if (!throttle || Date.now() - this.lastEmit >= 100) this.emit();
  }

  private progress(id: string, bytes: number) {
    const started = this.startedAt.get(id) ?? Date.now();
    const seconds = Math.max(0.25, (Date.now() - started) / 1000);
    this.updateTransfer(id, { bytes, speedBps: bytes / seconds }, true);
  }

  /* ---------- public API ---------- */

  /** Show a QR code and wait for another device to scan it. */
  async host(): Promise<void> {
    this.teardown();
    const gen = this.generation;
    this.set({ status: "waiting", role: "host", code: null, expiresAt: null, peerLabel: null, error: null });
    try {
      const res = await fetch("/api/pair", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (gen !== this.generation) return;
      if (!res.ok || !data.code) throw new Error(data.error ?? "Couldn't start pairing.");
      this.code = data.code;
      this.cursor = 0;
      this.set({ code: data.code, expiresAt: Date.now() + data.ttl * 1000 });
      this.poll(gen, "host");
    } catch (err) {
      if (gen === this.generation) this.end("failed", err instanceof Error ? err.message : "Couldn't start pairing.");
    }
  }

  /** Join the device that is showing a code. */
  async join(rawCode: string): Promise<void> {
    this.teardown();
    const gen = this.generation;
    const code = normalizeCode(rawCode);
    this.code = code;
    this.cursor = 0;
    this.set({ status: "connecting", role: "guest", code, expiresAt: null, peerLabel: null, error: null });
    try {
      await this.signal("host", { type: "join" });
      if (gen !== this.generation) return;
      this.armConnectTimeout(gen);
      this.poll(gen, "guest");
    } catch (err) {
      if (gen === this.generation) this.end("failed", err instanceof Error ? err.message : "Couldn't join.");
    }
  }

  /** Queue something to send. It goes out as soon as the devices are connected. */
  enqueue(payload: OutgoingPayload): string {
    const id = crypto.randomUUID();
    this.queue.push({ id, payload, abort: null });
    this.addTransfer({
      id,
      direction: "send",
      kind: payload.kind,
      name: payload.name,
      size: payload.size,
      bytes: 0,
      status: "queued",
      error: null,
      speedBps: 0,
    });
    void this.pump();
    return id;
  }

  cancelTransfer(id: string) {
    const queuedIdx = this.queue.findIndex((o) => o.id === id);
    if (queuedIdx >= 0) {
      this.queue.splice(queuedIdx, 1);
      this.updateTransfer(id, { status: "canceled" });
      return;
    }
    const out = this.active.get(id);
    if (out) {
      out.abort = "Canceled";
      return;
    }
    if (this.incoming?.id === id) {
      this.sendControl({ t: "done", id, ok: false, error: "Canceled by the receiving device" });
      this.incoming = null;
      this.updateTransfer(id, { status: "canceled" });
    }
  }

  /** Leave the session and forget anything still queued. */
  disconnect() {
    if (this.dc?.readyState === "open") this.sendControl({ t: "bye" });
    if (this.snap.role === "guest" && this.snap.status !== "connected" && this.code) {
      void this.signal("host", { type: "bye" }).catch(() => {});
    }
    this.teardown();
    for (const o of this.queue) this.updateTransfer(o.id, { status: "canceled" });
    this.queue = [];
    this.set({ status: "idle", role: null, code: null, expiresAt: null, peerLabel: null, error: null });
  }

  clearFinished() {
    this.set({
      transfers: this.snap.transfers.filter((t) => t.status === "queued" || t.status === "preparing" || t.status === "active"),
    });
  }

  /* ---------- signaling ---------- */

  private async signal(to: Role, msg: Signal) {
    const res = await fetch(`/api/pair/${this.code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, msg }),
    });
    if (res.status === 404) throw new Error("That code has expired or isn't right. Ask for a fresh one.");
    if (!res.ok) throw new Error("Couldn't reach the pairing service.");
  }

  private poll(gen: number, role: Role) {
    const loop = async () => {
      if (gen !== this.generation) return;
      let delay = role === "host" ? WAIT_POLL_MS : NEGOTIATE_POLL_MS;
      try {
        const res = await fetch(`/api/pair/${this.code}?role=${role}&after=${this.cursor}`, { cache: "no-store" });
        // Once connected the pairing session is deleted on purpose, so a poll
        // that was already in flight will come back 404. That is not an error.
        if (gen !== this.generation || this.snap.status === "connected") return;
        if (res.status === 404) {
          this.end(
            "failed",
            role === "host"
              ? "This code expired. Generate a new one."
              : "That code has expired or isn't right. Ask for a fresh one."
          );
          return;
        }
        const data = (await res.json()) as { msgs: Signal[]; next: number };
        this.cursor = data.next;
        for (const msg of data.msgs) {
          await this.handleSignal(gen, role, msg);
          if (gen !== this.generation) return;
        }
        if (data.msgs.length || this.snap.status === "connecting") delay = NEGOTIATE_POLL_MS;
      } catch {
        delay = 2500; // transient network/parse error, keep trying until the code expires
      }
      if (gen !== this.generation || this.snap.status === "connected") return;
      this.pollTimer = setTimeout(loop, delay);
    };
    void loop();
  }

  private async handleSignal(gen: number, role: Role, msg: Signal) {
    switch (msg.type) {
      case "join":
        if (role === "host" && !this.pc) {
          this.armConnectTimeout(gen);
          await this.createConnection(gen, true);
        }
        break;
      case "offer":
        if (role === "guest" && !this.pc) {
          await this.createConnection(gen, false);
          const pc = this.pc as RTCPeerConnection | null;
          if (gen !== this.generation || !pc) return;
          await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
          await this.flushRemoteCandidates();
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await this.signal("host", { type: "answer", sdp: answer.sdp ?? "" });
          this.descriptionSent = true;
          this.flushLocalCandidates(gen, role);
        }
        break;
      case "answer":
        if (role === "host" && this.pc && !this.pc.remoteDescription) {
          await this.pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
          await this.flushRemoteCandidates();
        }
        break;
      case "ice":
        this.pendingRemoteCandidates.push(...msg.candidates);
        await this.flushRemoteCandidates();
        break;
      case "bye":
        this.end("closed", "The other device left.");
        break;
    }
  }

  private async flushRemoteCandidates() {
    const pc = this.pc;
    if (!pc || !pc.remoteDescription) return;
    const batch = this.pendingRemoteCandidates.splice(0);
    for (const c of batch) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        // a stale or unusable candidate is not fatal
      }
    }
  }

  private queueLocalCandidate(gen: number, role: Role, c: RTCIceCandidateInit) {
    this.localCandidates.push(c);
    if (!this.descriptionSent || this.candidateTimer) return;
    // Batch candidates so a handshake is a handful of requests, not a dozen.
    this.candidateTimer = setTimeout(() => this.flushLocalCandidates(gen, role), 250);
  }

  private flushLocalCandidates(gen: number, role: Role) {
    if (this.candidateTimer) clearTimeout(this.candidateTimer);
    this.candidateTimer = null;
    if (gen !== this.generation || !this.localCandidates.length) return;
    const candidates = this.localCandidates.splice(0);
    const to: Role = role === "host" ? "guest" : "host";
    this.signal(to, { type: "ice", candidates }).catch(() => {});
  }

  /* ---------- WebRTC ---------- */

  private async loadIce(): Promise<RTCIceServer[]> {
    try {
      const res = await fetch("/api/rtc-config");
      if (!res.ok) return DEFAULT_ICE;
      const data = await res.json();
      this.snap = { ...this.snap, relay: Boolean(data.relay) };
      return data.iceServers ?? DEFAULT_ICE;
    } catch {
      return DEFAULT_ICE;
    }
  }

  private async createConnection(gen: number, initiator: boolean) {
    const role: Role = initiator ? "host" : "guest";
    const iceServers = await this.loadIce();
    if (gen !== this.generation) return;

    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    this.descriptionSent = false;
    this.set({ status: "connecting" });

    pc.onicecandidate = (e) => {
      if (e.candidate) this.queueLocalCandidate(gen, role, e.candidate.toJSON());
    };
    pc.onconnectionstatechange = () => {
      if (gen !== this.generation) return;
      const state = pc.connectionState;
      if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
      if (state === "failed") {
        this.end(
          "failed",
          this.snap.relay
            ? "Couldn't connect, even through the relay. Try again."
            : "Couldn't connect directly. One of the networks blocks peer-to-peer (common on some mobile data and office Wi-Fi). A TURN relay server fixes this, see the README."
        );
      } else if (state === "closed") {
        if (this.snap.status === "connected") this.end("closed", "The connection closed.");
      } else if (state === "disconnected") {
        // Usually a blip that heals itself, so give it a few seconds.
        this.disconnectTimer = setTimeout(() => {
          if (gen === this.generation && pc.connectionState === "disconnected") {
            this.end("closed", "The connection was lost.");
          }
        }, 6000);
      }
    };

    if (initiator) {
      this.attachChannel(gen, role, pc.createDataChannel("dock", { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await this.signal("guest", { type: "offer", sdp: offer.sdp ?? "" });
      this.descriptionSent = true;
      this.flushLocalCandidates(gen, role);
    } else {
      pc.ondatachannel = (e) => this.attachChannel(gen, role, e.channel);
    }
  }

  private armConnectTimeout(gen: number) {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (gen === this.generation && this.snap.status !== "connected") {
        this.end("failed", "Timed out while connecting. Check both devices are online and try again.");
      }
    }, CONNECT_TIMEOUT_MS);
  }

  private attachChannel(gen: number, role: Role, dc: RTCDataChannel) {
    this.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.bufferedAmountLowThreshold = LOW_WATER;

    dc.onopen = () => {
      if (gen !== this.generation) return;
      if (this.connectTimer) clearTimeout(this.connectTimer);
      if (this.pollTimer) clearTimeout(this.pollTimer);
      this.set({ status: "connected", error: null, expiresAt: null });
      this.sendControl({ t: "hello", label: deviceLabel() });
      // Setup data is useless now, don't leave it sitting in Redis.
      if (role === "host" && this.code) {
        fetch(`/api/pair/${this.code}`, { method: "DELETE" }).catch(() => {});
      }
      void this.pump();
    };
    dc.onmessage = (e) => this.onMessage(gen, e.data);
    dc.onbufferedamountlow = () => {
      this.drainWaiters.forEach((w) => w.resolve());
      this.drainWaiters.clear();
    };
    dc.onclose = () => {
      if (gen === this.generation && this.snap.status === "connected") {
        this.end("closed", "The other device disconnected.");
      }
    };
  }

  private sendControl(msg: Control) {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(msg));
  }

  private waitForDrain(): Promise<void> {
    const dc = this.dc;
    if (!dc) return Promise.reject(new Error("Connection lost"));
    if (dc.bufferedAmount <= HIGH_WATER) return Promise.resolve();
    return new Promise((resolve, reject) => {
      // The "buffered amount low" event is the normal wake-up, but it has
      // been unreliable in some browsers/stacks (a missed event would stall
      // the transfer forever), so also check the buffer on a short timer.
      const waiter = {
        resolve: () => {
          clearInterval(timer);
          resolve();
        },
        reject: (e: Error) => {
          clearInterval(timer);
          reject(e);
        },
      };
      const timer = setInterval(() => {
        if (!this.dc || this.dc.bufferedAmount <= LOW_WATER) {
          this.drainWaiters.delete(waiter);
          waiter.resolve();
        }
      }, 40);
      this.drainWaiters.add(waiter);
    });
  }

  /* ---------- sending ---------- */

  private async pump() {
    const gen = this.generation;
    if (this.sendingGen === gen || this.snap.status !== "connected") return;
    this.sendingGen = gen;
    try {
      while (gen === this.generation && this.snap.status === "connected") {
        const next = this.queue.shift();
        if (!next) break;
        await this.runSend(gen, next);
      }
    } finally {
      if (this.sendingGen === gen) this.sendingGen = -1;
    }
  }

  private expectAck(id: string) {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => this.acks.set(id, resolve));
  }

  private async runSend(gen: number, out: Outgoing) {
    const { payload } = out;
    const id = out.id;
    this.active.set(id, out);
    this.startedAt.set(id, Date.now());
    const isText = payload.kind === "text" && payload.text != null;

    try {
      if (isText) {
        const ack = this.expectAck(id);
        this.updateTransfer(id, { status: "active" });
        this.sendControl({ t: "text", id, name: payload.name, text: payload.text ?? "", createdAt: payload.createdAt });
        const result = await ack;
        if (!result.ok) throw new Error(result.error ?? "The other device refused it");
        this.updateTransfer(id, { status: "done", bytes: payload.size });
      } else {
        this.updateTransfer(id, { status: "preparing" });
        if (!payload.getBlob) throw new Error("Nothing to send");
        const blob = await payload.getBlob();
        if (gen !== this.generation) throw new Error("Connection lost");
        if (out.abort) throw new Error(out.abort);
        if (blob.size > MAX_P2P_BYTES) throw new Error(`Too large to send directly (limit ${formatBytes(MAX_P2P_BYTES)})`);

        this.startedAt.set(id, Date.now());
        this.updateTransfer(id, { status: "active", size: blob.size, bytes: 0 });
        const ack = this.expectAck(id);
        this.sendControl({
          t: "file",
          id,
          kind: payload.kind,
          name: payload.name,
          size: blob.size,
          mime: payload.mime,
          createdAt: payload.createdAt,
        });
        await this.stream(gen, out, blob);
        this.sendControl({ t: "end", id });
        const result = await ack;
        if (!result.ok) throw new Error(result.error ?? "The other device refused it");
        this.updateTransfer(id, { status: "done", bytes: blob.size });
      }
      this.handlers.onSent?.({
        itemId: payload.itemId,
        name: payload.name,
        size: payload.size,
        kind: payload.kind,
        peerLabel: this.snap.peerLabel,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Transfer failed";
      const wasCanceled = out.abort === "Canceled";
      if (wasCanceled) this.sendControl({ t: "cancel", id });
      this.updateTransfer(id, { status: wasCanceled ? "canceled" : "error", error: wasCanceled ? null : message });
    } finally {
      this.acks.delete(id);
      this.active.delete(id);
      this.startedAt.delete(id);
    }
  }

  private async stream(gen: number, out: Outgoing, blob: Blob) {
    const dc = this.dc;
    if (!dc) throw new Error("Connection lost");
    const max = (this.pc as RTCPeerConnection & { sctp?: { maxMessageSize?: number } }).sctp?.maxMessageSize;
    const chunk = Math.max(1024, Math.min(CHUNK_BYTES, Number.isFinite(max) && max ? max : CHUNK_BYTES));
    let sent = 0;

    for (let offset = 0; offset < blob.size; offset += READ_AHEAD_BYTES) {
      const buf = await blob.slice(offset, Math.min(offset + READ_AHEAD_BYTES, blob.size)).arrayBuffer();
      for (let o = 0; o < buf.byteLength; o += chunk) {
        if (out.abort) throw new Error(out.abort);
        await this.waitForDrain();
        if (gen !== this.generation) throw new Error("Connection lost");
        const len = Math.min(chunk, buf.byteLength - o);
        dc.send(new Uint8Array(buf, o, len));
        sent += len;
        // "Sent" counts what has actually left, not what is waiting in the buffer.
        this.progress(out.id, Math.max(0, sent - dc.bufferedAmount));
      }
    }
  }

  /* ---------- receiving ---------- */

  private onMessage(gen: number, data: unknown) {
    if (gen !== this.generation) return;
    if (typeof data === "string") {
      let msg: Control;
      try {
        msg = JSON.parse(data) as Control;
      } catch {
        return;
      }
      this.onControl(msg);
      return;
    }
    if (data instanceof ArrayBuffer) this.onChunk(data);
  }

  private onControl(msg: Control) {
    switch (msg.t) {
      case "hello":
        this.set({ peerLabel: msg.label });
        break;

      case "file": {
        if (msg.size > MAX_P2P_BYTES) {
          this.sendControl({ t: "done", id: msg.id, ok: false, error: `Too large to receive (limit ${formatBytes(MAX_P2P_BYTES)})` });
          break;
        }
        this.incoming = {
          id: msg.id,
          kind: msg.kind,
          name: msg.name,
          size: msg.size,
          mime: msg.mime,
          createdAt: msg.createdAt,
          received: 0,
          pending: [],
          pendingBytes: 0,
          blobs: [],
        };
        this.startedAt.set(msg.id, Date.now());
        this.addTransfer({
          id: msg.id,
          direction: "receive",
          kind: msg.kind,
          name: msg.name,
          size: msg.size,
          bytes: 0,
          status: "active",
          error: null,
          speedBps: 0,
        });
        break;
      }

      case "end": {
        const inc = this.incoming;
        if (!inc || inc.id !== msg.id) break;
        this.incoming = null;
        this.startedAt.delete(inc.id);
        if (inc.received !== inc.size) {
          const error = "The file arrived incomplete";
          this.updateTransfer(inc.id, { status: "error", error });
          this.sendControl({ t: "done", id: inc.id, ok: false, error });
          break;
        }
        const file = new File([...inc.blobs, ...inc.pending], inc.name, {
          type: inc.mime ?? "",
          lastModified: Date.parse(inc.createdAt) || Date.now(),
        });
        this.updateTransfer(inc.id, { status: "done", bytes: inc.size });
        this.sendControl({ t: "done", id: inc.id, ok: true });
        this.handlers.onReceivedFile?.(file, { kind: inc.kind, createdAt: inc.createdAt, peerLabel: this.snap.peerLabel });
        break;
      }

      case "text": {
        const size = new Blob([msg.text]).size;
        this.addTransfer({
          id: msg.id,
          direction: "receive",
          kind: "text",
          name: msg.name,
          size,
          bytes: size,
          status: "done",
          error: null,
          speedBps: 0,
        });
        this.sendControl({ t: "done", id: msg.id, ok: true });
        this.handlers.onReceivedText?.(msg.text, { createdAt: msg.createdAt, peerLabel: this.snap.peerLabel });
        break;
      }

      case "done": {
        const ack = this.acks.get(msg.id);
        if (!msg.ok) {
          const out = this.active.get(msg.id);
          if (out && !out.abort) out.abort = msg.error ?? "The other device refused it";
        }
        ack?.({ ok: msg.ok, error: msg.error });
        break;
      }

      case "cancel":
        if (this.incoming?.id === msg.id) {
          this.incoming = null;
          this.startedAt.delete(msg.id);
          this.updateTransfer(msg.id, { status: "canceled" });
        }
        break;

      case "bye":
        this.end("closed", "The other device left.");
        break;
    }
  }

  private onChunk(buf: ArrayBuffer) {
    const inc = this.incoming;
    if (!inc) return; // chunks of a canceled transfer still in flight
    inc.pending.push(buf);
    inc.pendingBytes += buf.byteLength;
    inc.received += buf.byteLength;
    // Fold chunks into Blobs now and then so the browser can back them with
    // disk instead of holding hundreds of megabytes of loose buffers in RAM.
    if (inc.pendingBytes >= RECEIVE_FLUSH_BYTES) {
      inc.blobs.push(new Blob(inc.pending));
      inc.pending = [];
      inc.pendingBytes = 0;
    }
    this.progress(inc.id, inc.received);
  }

  /* ---------- lifecycle ---------- */

  /** The connection ended (cleanly or not). Keeps the transfer list and queue. */
  private end(status: "closed" | "failed", error: string) {
    const stillGoing = this.snap.transfers.filter((t) => t.status === "active" || t.status === "preparing");
    this.teardown();
    const transfers = this.snap.transfers.map((t) =>
      stillGoing.some((s) => s.id === t.id) ? { ...t, status: "error" as const, error: "Connection lost" } : t
    );
    this.set({ status, error, transfers });
  }

  private teardown() {
    this.generation++;
    for (const t of [this.pollTimer, this.connectTimer, this.disconnectTimer, this.candidateTimer]) {
      if (t) clearTimeout(t);
    }
    this.pollTimer = this.connectTimer = this.disconnectTimer = this.candidateTimer = null;

    if (this.dc) {
      this.dc.onopen = this.dc.onmessage = this.dc.onclose = this.dc.onbufferedamountlow = null;
      try {
        this.dc.close();
      } catch {}
    }
    if (this.pc) {
      this.pc.onicecandidate = this.pc.onconnectionstatechange = this.pc.ondatachannel = null;
      try {
        this.pc.close();
      } catch {}
    }
    this.dc = null;
    this.pc = null;
    this.pendingRemoteCandidates = [];
    this.localCandidates = [];
    this.descriptionSent = false;
    this.incoming = null;
    this.sendingGen = -1;

    const closed = new Error("Connection lost");
    this.drainWaiters.forEach((w) => w.reject(closed));
    this.drainWaiters.clear();
    this.acks.forEach((resolve) => resolve({ ok: false, error: "Connection lost" }));
    this.acks.clear();
  }
}
