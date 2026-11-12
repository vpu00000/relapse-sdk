// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function encodeJson(value: JsonValue): Buffer {
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "undefined" || typeof item === "function" ||
        typeof item === "symbol" || typeof item === "bigint" ||
        (typeof item === "number" && !Number.isFinite(item))) {
      throw new TypeError("Messages must contain only JSON-compatible values.");
    }
    return item;
  });
  return Buffer.from(text, "utf8");
}
