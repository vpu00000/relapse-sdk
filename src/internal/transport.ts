// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import { Socket } from "node:net";
import { isAbsolute } from "node:path";
import { RelapseError } from "../errors.js";
import { encodeJson, isRecord, type JsonValue } from "./json.js";
import { operation, type Operation, type WaitOptions } from "./operation.js";

const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;
const MAX_QUEUED_MESSAGES = 256;
const MAX_OPENING_BYTES = 4096;

export interface CloseInfo {
  reason: "local" | "peer" | "error";
  error?: RelapseError;
}

interface Handlers {
  message(value: unknown): void;
  close(info: CloseInfo): void;
}

export class Transport {
  readonly #socket = new Socket();
  readonly #handlers: Handlers;
  readonly #header = Buffer.alloc(4);
  readonly #writes = new Set<(error: RelapseError) => void>();
  #opening: Operation<void> | undefined;
  #opened = false;
  #closed = false;
  #paused = false;
  #headerUsed = 0;
  #body: Buffer | undefined;
  #bodyUsed = 0;
  #rest: Buffer | undefined;
  #queuedBytes = 0;
  #maxMessageBytes = MAX_OPENING_BYTES;

  constructor(
    readonly socketPath: string,
    readonly name: string,
    handlers: Handlers,
  ) {
    if (!isAbsolute(socketPath) || socketPath.includes("\0") || Buffer.byteLength(socketPath) >= 108) {
      throw new TypeError("Expected an absolute Unix socket path shorter than 108 bytes.");
    }
    if (!name || Buffer.byteLength(name) > 255 || /[\x00-\x1f\x7f]/u.test(name) ||
        Buffer.from(name).toString("utf8") !== name) {
      throw new TypeError("Channel names must contain 1–255 UTF-8 bytes without control characters.");
    }
    this.#handlers = handlers;
    this.#socket.on("data", (data: Buffer) => this.#receive(data));
    this.#socket.on("error", error => {
      this.#finish({ reason: "error", error: new RelapseError(
        this.#opened ? "disconnected" : "connection_failed", error.message, { cause: error },
      ) });
    });
    this.#socket.on("end", () => {
      if (this.#headerUsed || this.#body) this.#invalid("Connection ended in the middle of a frame.");
      else this.#finish({ reason: "peer" });
    });
    this.#socket.on("close", () => this.#finish({ reason: "peer" }));
  }

  get connected(): boolean { return this.#opened && !this.#closed; }
  get maxMessageBytes(): number { return this.#maxMessageBytes; }

  async open(options: WaitOptions): Promise<void> {
    this.#opening = operation<void>(options, 5000);
    try {
      if (!this.#opening.settled) {
        this.#socket.connect(this.socketPath, () => {
          const body = encodeJson({ version: 1, channel: this.name });
          this.#socket.write(this.#frame(body));
        });
      }
      await this.#opening.promise;
    } catch (error) {
      this.#finish({ reason: "error", error: error instanceof RelapseError ? error :
        new RelapseError("connection_failed", "Could not connect to Relapse.", { cause: error }) });
      throw error;
    }
  }

  pause(): void {
    this.#paused = true;
    this.#socket.pause();
  }

  resume(): void {
    if (this.#closed) return;
    this.#paused = false;
    const rest = this.#rest;
    this.#rest = undefined;
    if (rest) this.#receive(rest);
    if (!this.#paused && !this.#closed) this.#socket.resume();
  }

  async send(value: JsonValue): Promise<void> {
    if (!this.connected) throw new RelapseError("disconnected", "Channel is closed.");
    const body = encodeJson(value);
    if (body.length > this.#maxMessageBytes) {
      throw new RelapseError("message_too_large", `Message exceeds ${this.#maxMessageBytes} bytes.`);
    }
    const size = body.length + 4;
    if (this.#writes.size >= MAX_QUEUED_MESSAGES || this.#queuedBytes + size > MAX_QUEUED_BYTES) {
      throw new RelapseError("backpressure", "Channel send queue is full.");
    }
    await new Promise<void>((resolve, reject) => {
      const fail = (error: RelapseError) => reject(error);
      this.#writes.add(fail);
      this.#queuedBytes += size;
      this.#socket.write(this.#frame(body), error => {
        this.#writes.delete(fail);
        this.#queuedBytes -= size;
        if (error) reject(new RelapseError("disconnected", error.message, { cause: error }));
        else resolve();
      });
    });
  }

  close(error?: RelapseError): void {
    this.#finish(error ? { reason: "error", error } : { reason: "local" });
  }

  #frame(body: Buffer): Buffer {
    const frame = Buffer.allocUnsafe(body.length + 4);
    frame.writeUInt32BE(body.length);
    body.copy(frame, 4);
    return frame;
  }

  #receive(data: Buffer): void {
    let offset = 0;
    while (offset < data.length && !this.#closed) {
      if (this.#paused) {
        this.#rest = data.subarray(offset);
        return;
      }
      if (this.#headerUsed < 4) {
        const amount = Math.min(4 - this.#headerUsed, data.length - offset);
        data.copy(this.#header, this.#headerUsed, offset, offset + amount);
        offset += amount;
        this.#headerUsed += amount;
        if (this.#headerUsed < 4) return;
        const size = this.#header.readUInt32BE();
        if (size === 0 || size > this.#maxMessageBytes) {
          this.#invalid("Invalid channel frame length.");
          return;
        }
        this.#body = Buffer.allocUnsafe(size);
      }
      const body = this.#body!;
      const amount = Math.min(body.length - this.#bodyUsed, data.length - offset);
      data.copy(body, this.#bodyUsed, offset, offset + amount);
      offset += amount;
      this.#bodyUsed += amount;
      if (this.#bodyUsed < body.length) return;
      this.#headerUsed = this.#bodyUsed = 0;
      this.#body = undefined;

      let message: unknown;
      try {
        message = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body));
      } catch {
        this.#invalid("Expected a UTF-8 JSON message.");
        return;
      }
      if (!this.#opened) this.#handshake(message);
      else this.#handlers.message(message);
    }
  }

  #handshake(message: unknown): void {
    if (!isRecord(message) || typeof message.ok !== "boolean") {
      this.#invalid("Expected a channel handshake response.");
      return;
    }
    if (!message.ok) {
      if (typeof message.error !== "string") this.#invalid("Invalid channel rejection.");
      else this.close(new RelapseError("channel_rejected", message.error));
      return;
    }
    if (message.version !== 1 || typeof message.max_message_bytes !== "number" ||
        !Number.isInteger(message.max_message_bytes) || message.max_message_bytes <= 0 ||
        message.max_message_bytes > 0xffff_ffff) {
      this.#invalid("Unsupported channel version or invalid message limit.");
      return;
    }
    this.#maxMessageBytes = Math.min(message.max_message_bytes, MAX_MESSAGE_BYTES);
    this.#opened = true;
    // Let connect() callers attach listeners before delivering coalesced frames.
    this.pause();
    this.#opening?.resolve();
  }

  #invalid(message: string): void {
    this.close(new RelapseError("protocol_error", message));
  }

  #finish(info: CloseInfo): void {
    if (this.#closed) return;
    this.#closed = true;
    const error = info.error ?? new RelapseError("disconnected", "Channel closed.");
    this.#opening?.reject(error);
    for (const fail of this.#writes) fail(error);
    this.#writes.clear();
    this.#body = this.#rest = undefined;
    this.#socket.destroy();
    this.#handlers.close(info);
  }
}
