// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import type { EventEmitter } from "node:events";
import { RelapseError } from "../errors.js";
import { operation, type WaitOptions } from "./operation.js";
import type { CloseInfo } from "./transport.js";

export async function waitForEvent<T>(
  source: EventEmitter,
  event: string,
  connected: boolean,
  predicate: ((value: T) => boolean) | undefined,
  options: WaitOptions,
): Promise<T> {
  const wait = operation<T>(options, 30_000);
  const receive = (value: T) => {
    if (wait.settled) return;
    try {
      if (!predicate || predicate(value)) wait.resolve(value);
    } catch (error) {
      wait.reject(error);
    }
  };
  const closed = (info: CloseInfo) => {
    wait.reject(info.error ?? new RelapseError("disconnected", "Channel closed before the event arrived."));
  };
  if (!wait.settled) {
    if (!connected) wait.reject(new RelapseError("disconnected", "Channel is closed."));
    else {
      source.on(event, receive);
      source.on("close", closed);
    }
  }
  try {
    return await wait.promise;
  } finally {
    source.off(event, receive);
    source.off("close", closed);
  }
}
