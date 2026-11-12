// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import { basename } from "node:path";
import { Channel } from "./channel.js";
import { MainChannel } from "./main-channel.js";
import { RelapseError } from "./errors.js";
import { isValidName } from "./profiles.js";
import type { WaitOptions } from "./internal/operation.js";

export interface ClientOptions extends WaitOptions {
  socketPath: string;
}

export interface ClientInfo {
  socketPath: string;
  /** Inferred from the socket filename; null for an unnamed client. */
  profile: string | null;
  pid: number;
  ready: boolean;
  session: number;
}

export class Client {
  readonly mainChannel: MainChannel;
  readonly #channels = new Set<Channel>();
  #closed = false;

  private constructor(mainChannel: MainChannel) {
    this.mainChannel = mainChannel;
    mainChannel.once("close", () => this.close());
  }

  static async connect(options: ClientOptions): Promise<Client> {
    return new Client(await MainChannel.connect(options));
  }

  get socketPath(): string { return this.mainChannel.socketPath; }
  get connected(): boolean { return !this.#closed && this.mainChannel.connected; }
  get pid(): number { return this.mainChannel.hello.pid; }
  get profile(): string | null {
    // Older executors report "default" in hello even when using a named profile.
    const match = /^relapse-(.+)\.sock$/u.exec(basename(this.socketPath));
    return match?.[1] && isValidName(match[1]) ? match[1] : null;
  }

  get info(): ClientInfo {
    return {
      socketPath: this.socketPath,
      profile: this.profile,
      pid: this.pid,
      ready: this.mainChannel.ready,
      session: this.mainChannel.session,
    };
  }

  async openChannel(name: string, options: WaitOptions = {}): Promise<Channel> {
    if (!this.connected) throw new RelapseError("disconnected", "Client is disconnected.");
    const channel = await Channel.connect({ ...options, socketPath: this.socketPath, name });
    if (!this.connected) {
      channel.close();
      throw new RelapseError("disconnected", "Client disconnected while opening the channel.");
    }
    this.#channels.add(channel);
    channel.once("close", () => this.#channels.delete(channel));
    return channel;
  }

  /** Closes @main and any channels opened through this client. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const channel of this.#channels) channel.close();
    this.#channels.clear();
    this.mainChannel.close();
  }
}
