// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import { EventEmitter } from "node:events";
import { Transport, type CloseInfo } from "./internal/transport.js";
import type { JsonValue } from "./internal/json.js";
import type { WaitOptions } from "./internal/operation.js";
import { waitForEvent } from "./internal/wait-for.js";

export interface ChannelConnection {
  readonly socketPath: string;
  readonly name: string;
  readonly connected: boolean;
  readonly maxMessageBytes: number;
  close(): void;
}

export interface ChannelOptions extends WaitOptions {
  socketPath: string;
  name: string;
}

export interface ChannelEvents {
  message: [message: unknown];
  close: [info: CloseInfo];
}

export class Channel extends EventEmitter<ChannelEvents> implements ChannelConnection {
  readonly #transport: Transport;

  private constructor(options: ChannelOptions) {
    super();
    const name = options.name;
    if (typeof name !== "string" || name.startsWith("@")) {
      throw new TypeError("Channel names starting with @ are reserved. Use MainChannel for @main.");
    }
    this.#transport = new Transport(options.socketPath, name, {
      message: message => this.emit("message", message),
      close: info => this.emit("close", info),
    });
  }

  static async connect(options: ChannelOptions): Promise<Channel> {
    const channel = new Channel(options);
    await channel.#transport.open(options);
    setImmediate(() => channel.#transport.resume());
    return channel;
  }

  get socketPath(): string { return this.#transport.socketPath; }
  get name(): string { return this.#transport.name; }
  get connected(): boolean { return this.#transport.connected; }
  get maxMessageBytes(): number { return this.#transport.maxMessageBytes; }

  /** Resolves after writing locally, without waiting for a peer acknowledgement. */
  send(value: JsonValue): Promise<void> {
    return this.#transport.send(value);
  }

  /** Waits for a future matching event. Existing messages are not replayed. */
  waitFor<K extends keyof ChannelEvents>(
    event: K,
    predicate?: (value: ChannelEvents[K][0]) => boolean,
    options: WaitOptions = {},
  ): Promise<ChannelEvents[K][0]> {
    return waitForEvent(this, event, this.connected, predicate, options);
  }

  close(): void {
    this.#transport.close();
  }
}
