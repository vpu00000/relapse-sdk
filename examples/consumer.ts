// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { Client, RelapseError, listClients, profiles } from "relapsesdk";
import type { Channel, JsonValue } from "relapsesdk";

const input = createInterface({ input: process.stdin, output: process.stdout });
const shutdown = new AbortController();
let client: Client | undefined;
let channel: Channel | undefined;

function stop() {
  if (shutdown.signal.aborted) return;
  shutdown.abort();
  channel?.close();
  client?.close();
  input.close();
}

input.on("SIGINT", stop);
input.on("close", stop);
process.once("SIGINT", stop);

async function main() {
  const savedProfiles = await profiles.list();
  console.log("Profiles:", savedProfiles.map(profile => profile.name).join(", ") || "none");

  let socketPath = process.argv[2];
  if (!socketPath) {
    const clients = await listClients({ signal: shutdown.signal });
    if (!clients.length) {
      console.log("No Relapse clients found. Launch one, then run this example again.");
      return;
    }
    console.table(clients.map((info, index) => ({
      number: index + 1,
      profile: info.profile ?? "Unnamed",
      ready: info.ready,
      socket: info.socketPath,
    })));
    const choice = clients.length === 1 ? "1" :
      await input.question("Client number: ", { signal: shutdown.signal });
    const selected = clients[Number(choice) - 1];
    if (!selected) throw new Error("Choose a client number from the list.");
    socketPath = selected.socketPath;
  }

  client = await Client.connect({ socketPath, signal: shutdown.signal });
  const mainChannel = client.mainChannel;
  mainChannel.on("status", status => console.log("Executor:", status.ready ? "ready" : "waiting"));
  mainChannel.on("log", entry => console.log(`[${entry.level}] ${entry.text}`));
  mainChannel.on("close", info => {
    if (!shutdown.signal.aborted) console.log(info.error?.message ?? "Client disconnected.");
    stop();
  });
  if (!mainChannel.ready) {
    await mainChannel.waitFor("status", status => status.ready, { signal: shutdown.signal });
  }

  const channelName = `sdk-example-${randomUUID()}`;
  await mainChannel.execute(`
local name = ${JSON.stringify(channelName)}
local channel = RelapseChannel.new(name)
getgenv()[name] = channel
local connected = false

local function cleanup()
    channel:Close()
    getgenv()[name] = nil
end

channel.Connected:Connect(function(connection)
    connected = true
    connection.MessageReceived:Connect(function(message)
        if message == "status" then
            connection:Send({
                placeId = tostring(game.PlaceId),
                jobId = game.JobId,
                players = #game:GetService("Players"):GetPlayers(),
            })
        else
            connection:Send(message)
        end
    end)
    connection.Disconnected:Connect(cleanup)
end)

task.delay(30, function()
    if not connected then cleanup() end
end)
`, { name: "sdk-example.luau", signal: shutdown.signal });

  // Submission can be acknowledged before the script has published its channel.
  const deadline = Date.now() + 5000;
  while (!channel) {
    channel = await client.openChannel(channelName, { signal: shutdown.signal })
      .catch(error => {
        if (error instanceof RelapseError && error.code === "channel_rejected" &&
            error.message === "unknown_channel" && Date.now() < deadline) return undefined;
        throw error;
      });
    if (!channel) await sleep(100, undefined, { signal: shutdown.signal });
  }

  channel.on("message", message => console.dir(message, { depth: null, colors: process.stdout.isTTY }));
  channel.on("close", info => {
    if (!shutdown.signal.aborted) console.log(info.error?.message ?? "Example channel closed.");
    stop();
  });
  console.log('Connected. Enter status, JSON to echo, or quit. Ctrl+C also exits.');
  await channel.send("status");

  while (!shutdown.signal.aborted) {
    const text = (await input.question("> ", { signal: shutdown.signal })).trim();
    if (text === "quit" || text === "exit") break;
    if (!text) continue;
    let message: JsonValue;
    try {
      message = JSON.parse(text);
    } catch {
      message = text;
    }
    await channel.send(message).catch(error => console.error(error.message));
  }
}

main().catch(error => {
  if (!shutdown.signal.aborted) {
    console.error(error.message);
    process.exitCode = 1;
  }
}).finally(stop);
