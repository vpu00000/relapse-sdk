// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import { lstat, mkdir, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export interface ProfileOptions {
  homeDirectory?: string;
}

export interface ProfileInfo {
  name: string;
  directory: string;
}

export interface ProfilePaths {
  directory: string;
  state: string;
  cookies: string;
}

export function isValidName(name: string): boolean {
  return typeof name === "string" && /^[a-zA-Z0-9._-]{1,64}$/u.test(name) && name !== "." && name !== "..";
}

export function directory(options: ProfileOptions = {}): string {
  const home = options.homeDirectory ?? homedir();
  if (!isAbsolute(home)) throw new TypeError("homeDirectory must be an absolute path.");
  return join(home, ".local", "share", "relapse", "profiles");
}

export function path(name: string, options: ProfileOptions = {}): string {
  if (!isValidName(name)) {
    throw new TypeError("Profile names must contain 1–64 letters, digits, dots, underscores or hyphens, excluding . and ..");
  }
  return join(directory(options), name);
}

export function paths(name: string, options: ProfileOptions = {}): ProfilePaths {
  const profile = path(name, options);
  return {
    directory: profile,
    state: join(profile, "state"),
    cookies: join(profile, "state", "app", "data", "sober", "cookies"),
  };
}

export async function get(name: string, options: ProfileOptions = {}): Promise<ProfileInfo> {
  const profile = path(name, options);
  const stat = await lstat(profile);
  if (!stat.isDirectory()) throw new Error("Profile must be a directory, not a symlink or other file.");
  return { name, directory: profile };
}

export async function list(options: ProfileOptions = {}): Promise<ProfileInfo[]> {
  const root = directory(options);
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter(entry => entry.isDirectory() && isValidName(entry.name))
    .map(entry => ({ name: entry.name, directory: join(root, entry.name) }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** Creates a fresh profile directory. The launcher initializes its state on first use. */
export async function create(name: string, options: ProfileOptions = {}): Promise<ProfileInfo> {
  const profile = path(name, options);
  const root = directory(options);
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (!(await lstat(root)).isDirectory()) throw new Error("Profiles directory must not be a symlink.");
  await mkdir(profile, { mode: 0o700 });
  return { name, directory: profile };
}
