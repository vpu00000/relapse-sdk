// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

/// <reference types="node" preserve="true" />

export { Channel, type ChannelOptions, type ChannelEvents, type ChannelConnection } from "./channel.js";
export {
  Client, type ClientOptions, type ClientInfo,
} from "./client.js";
export {
  MainChannel, type MainChannelOptions, type MainChannelEvents,
  type MainRequest, type MainMessage, type MainHello, type MainStatus, type MainError,
  type ExecuteOptions, type ExecutionResult, type LogEntry,
} from "./main-channel.js";
export { listClients, watchClients, type DiscoveryOptions, type WatchOptions } from "./discovery.js";
export { launch, type LaunchOptions } from "./launcher.js";
export { RelapseError, type ErrorCode } from "./errors.js";
export * as profiles from "./profiles.js";
export type { ProfileInfo, ProfileOptions, ProfilePaths } from "./profiles.js";
export type { JsonValue } from "./internal/json.js";
export type { WaitOptions } from "./internal/operation.js";
export type { CloseInfo } from "./internal/transport.js";
