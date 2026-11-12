// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

export type ErrorCode =
  | "connection_failed"
  | "disconnected"
  | "protocol_error"
  | "channel_rejected"
  | "message_too_large"
  | "backpressure"
  | "not_ready"
  | "execution_failed"
  | "session_changed"
  | "timeout"
  | "aborted";

export class RelapseError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RelapseError";
  }
}
