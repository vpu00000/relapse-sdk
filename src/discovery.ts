// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import { lstat, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client, type ClientInfo } from "./client.js";
import { RelapseError } from "./errors.js";
import { isValidName } from "./profiles.js";
import { resolveTimeout, type WaitOptions } from "./internal/operation.js";

export interface DiscoveryOptions extends WaitOptions {
  directory?: string;
}

export interface WatchOptions extends DiscoveryOptions {
  intervalMs?: number;
}

/** Finds responsive @main endpoints belonging to the current user. */
export async function listClients(options: DiscoveryOptions = {}): Promise<ClientInfo[]> {
  if (options.signal?.aborted) throw new RelapseError("aborted", "Discovery aborted.");
  const directory = options.directory ?? "/tmp";
  if (!isAbsolute(directory)) throw new TypeError("Discovery directory must be an absolute path.");
  const timeoutMs = resolveTimeout(options.timeoutMs, 1000);
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const paths = entries.filter(entry => {
    const match = /^relapse-(.+)\.sock$/u.exec(entry.name);
    return entry.isSocket() && (entry.name === "relapse.sock" || (match?.[1] && isValidName(match[1])));
  }).map(entry => join(directory, entry.name)).sort();

  const result: ClientInfo[] = [];
  for (let offset = 0; offset < paths.length; offset += 4) {
    const batch = await Promise.all(paths.slice(offset, offset + 4).map(async socketPath => {
      let client: Client | undefined;
      try {
        const stat = await lstat(socketPath);
        if (!stat.isSocket() || stat.uid !== process.getuid?.()) return undefined;
        client = await Client.connect({
          socketPath,
          timeoutMs,
          ...(options.signal ? { signal: options.signal } : {}),
        });
        return client.info;
      } catch (error) {
        if (options.signal?.aborted) throw new RelapseError("aborted", "Discovery aborted.", { cause: error });
        return undefined;
      } finally {
        client?.close();
      }
    }));
    for (const client of batch) if (client) result.push(client);
  }
  return result;
}

/** Yields an initial snapshot, then changed snapshots. Abort or break to stop polling. */
export async function* watchClients(options: WatchOptions = {}): AsyncGenerator<ClientInfo[]> {
  const interval = options.intervalMs ?? 1000;
  if (!Number.isInteger(interval) || interval < 1 || interval > 2_147_483_647) {
    throw new RangeError("intervalMs must be an integer between 1 and 2147483647.");
  }
  let previous: string | undefined;
  while (!options.signal?.aborted) {
    try {
      const clients = await listClients(options);
      const snapshot = JSON.stringify(clients);
      if (snapshot !== previous) {
        previous = snapshot;
        yield clients;
      }
      await sleep(interval, undefined, options.signal ? { signal: options.signal } : {});
    } catch (error) {
      if (options.signal?.aborted) return;
      throw error;
    }
  }
}
