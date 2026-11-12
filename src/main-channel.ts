// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ChannelConnection } from "./channel.js";
import { RelapseError } from "./errors.js";
import { isRecord } from "./internal/json.js";
import { operation, type Operation, type WaitOptions } from "./internal/operation.js";
import { Transport, type CloseInfo } from "./internal/transport.js";
import { waitForEvent } from "./internal/wait-for.js";

export interface MainChannelOptions extends WaitOptions {
  socketPath: string;
}

export interface ExecuteOptions extends WaitOptions {
  name?: string;
}

export type MainRequest = {
  op: "execute";
  script_id: number;
  session: number;
  source: string;
  name?: string;
};

export interface MainHello {
  type: "hello";
  pid: number;
  profile: string;
  ready: boolean;
  session: number;
}

export interface MainStatus {
  type: "status";
  ready: boolean;
  session: number;
}

export interface ExecutionResult {
  type: "exec_result";
  script_id: number;
  phase: "submitted" | "error";
  detail?: string;
}

export interface LogEntry {
  type: "log";
  level: string;
  text: string;
}

export interface MainError {
  type: "error";
  detail: string;
}

export type MainMessage = MainHello | MainStatus | ExecutionResult | LogEntry | MainError;

export interface MainChannelEvents {
  message: [message: MainMessage];
  hello: [message: MainHello];
  status: [message: MainStatus];
  exec_result: [message: ExecutionResult];
  log: [message: LogEntry];
  close: [info: CloseInfo];
}

export class MainChannel extends EventEmitter<MainChannelEvents> implements ChannelConnection {
  readonly #transport: Transport;
  readonly #opening: Operation<void>;
  readonly #requests = new Map<number, Operation<void>>();
  readonly #pending = new Set<number>();
  #hello: Readonly<MainHello> | undefined;
  #ready = false;
  #session = 0;
  #nextId = 1;

  private constructor(options: MainChannelOptions, opening: Operation<void>) {
    super();
    this.#opening = opening;
    this.#transport = new Transport(options.socketPath, "@main", {
      message: message => this.#receive(message),
      close: info => this.#closed(info),
    });
  }

  /** Connects to @main and receives its initial hello, which may report ready: false. */
  static async connect(options: MainChannelOptions): Promise<MainChannel> {
    const opening = operation<void>(options, 5000);
    let channel: MainChannel;
    try {
      channel = new MainChannel(options, opening);
    } catch (error) {
      opening.resolve();
      await opening.promise.catch(() => {});
      throw error;
    }
    try {
      await Promise.all([
        channel.#transport.open(options).then(() => channel.#transport.resume()),
        opening.promise,
      ]);
      setImmediate(() => channel.#transport.resume());
      return channel;
    } catch (error) {
      channel.close();
      throw error;
    }
  }

  get socketPath(): string { return this.#transport.socketPath; }
  get name(): "@main" { return "@main"; }
  get connected(): boolean { return this.#transport.connected; }
  get maxMessageBytes(): number { return this.#transport.maxMessageBytes; }
  get hello(): Readonly<MainHello> { return this.#hello!; }
  get ready(): boolean { return this.connected && this.#ready; }
  get session(): number { return this.#session; }

  /** Validates and writes a request. Execution acknowledgements arrive as exec_result events. */
  async send(value: MainRequest): Promise<void> {
    const request = validateRequest(value);
    if (!this.connected) throw new RelapseError("disconnected", "Main channel is closed.");
    if (!this.ready) throw new RelapseError("not_ready", "Executor is not ready.");
    if (request.session !== this.#session) throw new RelapseError("session_changed", "Request targets a different executor session.");
    if (this.#pending.has(request.script_id)) throw new TypeError("This execution request ID is already pending.");
    if (this.#pending.size >= 16) throw new RelapseError("backpressure", "Too many pending executions.");

    this.#pending.add(request.script_id);
    this.#nextId = Math.max(this.#nextId, request.script_id + 1);
    try {
      await this.#transport.send(request);
    } catch (error) {
      this.#pending.delete(request.script_id);
      throw error;
    }
  }

  /** Waits for a future matching event. Check ready before waiting for a readiness transition. */
  waitFor<K extends keyof MainChannelEvents>(
    event: K,
    predicate?: (value: MainChannelEvents[K][0]) => boolean,
    options: WaitOptions = {},
  ): Promise<MainChannelEvents[K][0]> {
    return waitForEvent(this, event, this.connected, predicate, options);
  }

  /** Resolves on submission, not script completion. Timeout/abort cannot undo submission. */
  async execute(source: string, options: ExecuteOptions = {}): Promise<void> {
    if (this.#nextId > Number.MAX_SAFE_INTEGER) throw new RangeError("Execution request IDs exhausted.");
    const request = operation<void>(options, 10_000);
    const id = this.#nextId++;
    if (!request.settled) {
      this.#requests.set(id, request);
      this.send({
        op: "execute", script_id: id, session: this.#session,
        source, name: options.name ?? "relapse",
      }).catch(error => request.reject(error));
    }
    try {
      await request.promise;
    } finally {
      this.#requests.delete(id);
    }
  }

  async executeFile(path: string, options: ExecuteOptions = {}): Promise<void> {
    const source = await readFile(path, {
      encoding: "utf8",
      ...(options.signal ? { signal: options.signal } : {}),
    });
    await this.execute(source, { ...options, name: options.name ?? basename(path) });
  }

  close(): void {
    this.#transport.close();
  }

  #receive(value: unknown): void {
    let message: MainMessage;
    try {
      message = parseMessage(value);
      if ((!this.#hello && message.type !== "hello") || (this.#hello && message.type === "hello")) {
        throw new TypeError("Expected one initial hello message.");
      }
    } catch (error) {
      this.#transport.close(new RelapseError("protocol_error", "Invalid @main message.", { cause: error }));
      return;
    }

    switch (message.type) {
      case "hello":
        this.#hello = Object.freeze(message);
        this.#ready = message.ready;
        this.#session = message.session;
        this.#transport.pause();
        this.#opening.resolve();
        this.emit("hello", message);
        break;
      case "status":
        if (!message.ready || message.session !== this.#session) {
          for (const pending of this.#requests.values()) {
            pending.reject(new RelapseError("session_changed", "Executor session changed before acknowledgement."));
          }
          this.#requests.clear();
          this.#pending.clear();
        }
        this.#ready = message.ready;
        this.#session = message.session;
        this.emit("status", message);
        break;
      case "exec_result": {
        this.#pending.delete(message.script_id);
        const pending = this.#requests.get(message.script_id);
        this.#requests.delete(message.script_id);
        if (message.phase === "submitted") pending?.resolve();
        else pending?.reject(new RelapseError("execution_failed", message.detail ?? "Execution rejected."));
        this.emit("exec_result", message);
        break;
      }
      case "log":
        this.emit("log", message);
        break;
      case "error":
        this.emit("message", message);
        this.#transport.close(new RelapseError("protocol_error", message.detail));
        return;
    }
    this.emit("message", message);
  }

  #closed(info: CloseInfo): void {
    const error = info.error ?? new RelapseError("disconnected", "Main channel closed.");
    this.#opening.reject(error);
    for (const request of this.#requests.values()) request.reject(error);
    this.#requests.clear();
    this.#pending.clear();
    this.#ready = false;
    this.emit("close", info);
  }
}

function integer(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function validateRequest(value: unknown): MainRequest {
  if (!isRecord(value) || Object.keys(value).some(key =>
    !["op", "script_id", "session", "source", "name"].includes(key))) {
    throw new TypeError("Expected a main-channel execution request with only defined fields.");
  }
  const { op, script_id, session, source, name } = value;
  if (op !== "execute" || !integer(script_id, 1) || !integer(session, 0) || typeof source !== "string" ||
      (name !== undefined && (typeof name !== "string" || Buffer.byteLength(name) > 255))) {
    throw new TypeError("Expected execute, a positive script_id, a session, source text, and an optional name of at most 255 bytes.");
  }
  if (Buffer.from(source).toString("utf8") !== source ||
      (name !== undefined && Buffer.from(name).toString("utf8") !== name)) {
    throw new TypeError("Script source and name must contain valid Unicode.");
  }
  // Copy validated fields so serialization cannot use a caller's toJSON implementation.
  return { op, script_id, session, source, ...(name === undefined ? {} : { name }) };
}

function parseMessage(value: unknown): MainMessage {
  if (!isRecord(value)) throw new TypeError("Expected an object.");
  switch (value.type) {
    case "hello":
    case "status": {
      const { ready, session } = value;
      if (typeof ready !== "boolean" || !integer(session, ready ? 1 : 0)) break;
      if (value.type === "status") return { type: "status", ready, session };
      if (!integer(value.pid, 1) || typeof value.profile !== "string") break;
      return { type: "hello", ready, session, pid: value.pid, profile: value.profile };
    }
    case "exec_result": {
      const { script_id, phase, detail } = value;
      if (!integer(script_id, 1) || (phase !== "submitted" && phase !== "error") ||
          (detail !== undefined && typeof detail !== "string")) break;
      return { type: "exec_result", script_id, phase, ...(detail === undefined ? {} : { detail }) };
    }
    case "log":
      if (typeof value.level === "string" && typeof value.text === "string") {
        return { type: "log", level: value.level, text: value.text };
      }
      break;
    case "error":
      if (typeof value.detail === "string") return { type: "error", detail: value.detail };
      break;
  }
  throw new TypeError("Invalid main-channel message.");
}
