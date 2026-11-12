// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { isValidName } from "./profiles.js";

export interface LaunchOptions {
  profile: string;
  launcherPath?: string;
  placeId?: string;
  jobId?: string;
  env?: NodeJS.ProcessEnv;
  /** Defaults to ignore. Use pipe to consume the launcher's stdout and stderr. */
  stdio?: "ignore" | "inherit" | "pipe";
}

/** Resolves when the launcher process starts, before a client or executor is necessarily ready. */
export async function launch(options: LaunchOptions): Promise<ChildProcess> {
  if (!isValidName(options.profile)) throw new TypeError("Invalid profile name.");
  const launcher = options.launcherPath ?? "relapse-launcher";
  if (!launcher || launcher.includes("\0")) throw new TypeError("Invalid launcher executable.");
  const args = ["--profile", options.profile, "--no-launch-ui"];
  const place = options.placeId?.trim() ?? "";
  const job = options.jobId?.trim() ?? "";
  if (!place && job) throw new TypeError("A Job ID requires a Place ID.");
  if (place) {
    if (!/^[0-9]+$/u.test(place) || BigInt(place) < 1n || BigInt(place) > 0x7fff_ffff_ffff_ffffn) {
      throw new TypeError("Place ID must be a positive 64-bit integer string.");
    }
    if (job && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(job)) {
      throw new TypeError("Job ID must be a UUID.");
    }
    const uri = `roblox://placeId=${BigInt(place)}${job ? `&gameInstanceId=${job}` : ""}`;
    args.push("--", uri);
  }
  const env = { ...(options.env ?? process.env) };
  delete env.LD_PRELOAD;
  delete env.LD_AUDIT;
  delete env.LD_LIBRARY_PATH;
  const child = spawn(launcher, args, { env, stdio: options.stdio ?? "ignore" });
  await once(child, "spawn");
  return child;
}
