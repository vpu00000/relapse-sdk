// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import { RelapseError } from "../errors.js";

export interface WaitOptions {
  /** Milliseconds to wait. Zero disables the timeout. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface Operation<T> {
  promise: Promise<T>;
  readonly settled: boolean;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function resolveTimeout(timeout: number | undefined, fallback: number): number {
  const value = timeout ?? fallback;
  if (!Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new RangeError("timeoutMs must be an integer between 0 and 2147483647.");
  }
  return value;
}

export function operation<T>(
  options: WaitOptions,
  defaultTimeout: number,
): Operation<T> {
  const timeout = resolveTimeout(options.timeoutMs, defaultTimeout);
  const signal = options.signal;

  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  const cleanup = () => {
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  };
  const result: Operation<T> = {
    promise,
    get settled() { return settled; },
    resolve(value) {
      if (settled) return;
      cleanup();
      resolve(value);
    },
    reject(error) {
      if (settled) return;
      cleanup();
      reject(error);
    },
  };
  const abort = () => result.reject(new RelapseError("aborted", "Operation aborted.", {
    cause: signal?.reason,
  }));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  if (!settled && timeout > 0) {
    timer = setTimeout(() => result.reject(new RelapseError("timeout", "Operation timed out.")), timeout);
  }
  return result;
}
