# relapsesdk

Node.js SDK for building Relapse tools and frontends.

Discover running Relapse clients, execute Luau scripts, exchange JSON messages
through named channels, and manage profiles from JavaScript or TypeScript.

## Installation

```sh
npm install relapsesdk
```

Requires Node.js 22 or newer. This is an ESM package with TypeScript declarations
included. It connects to a local Relapse installation on Linux through Unix
sockets; it does not run in a browser. In a desktop frontend, use it from the
Node.js process.

## Connect and execute a script

Start Relapse, then run this from an `.mjs` file or a project with
`"type": "module"` in its `package.json`:

```js
import { Client, listClients } from "relapsesdk";

const [info] = await listClients();
if (!info) throw new Error("No running Relapse clients found.");

const client = await Client.connect({ socketPath: info.socketPath });

try {
  const main = client.mainChannel;
  main.on("log", entry => console.log(`[${entry.level}] ${entry.text}`));

  if (!main.ready) {
    await main.waitFor("status", status => status.ready, { timeoutMs: 30_000 });
  }

  await main.execute('print("Hello from relapsesdk")', { name: "hello.luau" });
  console.log("Script submitted.");
} finally {
  client.close();
}
```

`execute()` resolves when Relapse acknowledges submission, before the script
necessarily finishes. Keep the connection open if you need later log messages.
Use `main.executeFile("./script.luau")` to submit a file.

## Named channels

Create a named channel in your Relapse script before connecting to it from Node.js:

```lua
local channel = RelapseChannel.new("my-tool")
getgenv().myToolChannel = channel

channel.Connected:Connect(function(connection)
    connection.MessageReceived:Connect(function(message)
        connection:Send(message)
    end)
end)
```

With a connected `client`, send a JSON value and wait for the echoed reply:

```js
const channel = await client.openChannel("my-tool");

try {
  const [reply] = await Promise.all([
    channel.waitFor("message", undefined, { timeoutMs: 5_000 }),
    channel.send({ action: "hello" }),
  ]);
  console.log(reply);
} finally {
  channel.close();
}
```

Register listeners or waits before sending a request so an immediate reply is
observed. `send()` resolves after a local write; use a reply to confirm the peer
has handled it. Close the Luau channel with `getgenv().myToolChannel:Close()` when
finished.

## Profiles and launching

```js
import { launch, profiles } from "relapsesdk";

console.table(await profiles.list());

// Choose a new profile name; create() rejects an existing directory.
await profiles.create("my-tool");
await launch({ profile: "my-tool" });
```

Profiles are stored under `~/.local/share/relapse/profiles` by default. The
launcher initializes a new profile's state on first use. `launch()` requires
`relapse-launcher` on `PATH`, or an explicit `launcherPath`; it resolves when the
process starts. Discover the client and wait for readiness before executing
scripts.

The profile helpers are also available through `import * as profiles from
"relapsesdk/profiles"`.

## API overview

| Export | Purpose |
| --- | --- |
| `listClients(options?)` | Find responsive clients owned by the current user. |
| `watchClients(options?)` | Yield an initial client list and changed snapshots as an async iterator. |
| `Client.connect({ socketPath, ...options })` | Connect to a client and manage its main and named channels. |
| `MainChannel.connect({ socketPath, ...options })` | Connect directly to the main channel for execution, status, and logs. |
| `Channel.connect({ socketPath, name, ...options })` | Connect directly to a named JSON channel. |
| `launch(options)` | Start a Relapse profile through the launcher. |
| `profiles` | List, create, find, and resolve paths for profiles. |
| `RelapseError` | SDK error with a machine-readable `code`. |

Connection, execution, and event-wait operations accept `timeoutMs` and an
`AbortSignal` through `signal`. A timeout of `0` disables the timer. Aborting or
timing out an execution request cannot undo an already submitted script.

Always close connections when finished. `client.close()` also closes channels
opened through that client.

## Development

```sh
git clone --branch typescript https://github.com/vpu00000/relapse-sdk.git
cd relapse-sdk
npm ci
npm run check
npm run build
```

With Relapse running, `npm run example` starts the interactive discovery,
execution, and channel example. Smaller examples are in
[`examples/execute.mjs`](examples/execute.mjs) and
[`examples/channel.mjs`](examples/channel.mjs).

The npm archive includes compiled JavaScript, type declarations, TypeScript
source, examples, and the build configuration.

## License

Copyright (C) 2026 vpu007.

Licensed under the GNU General Public License, version 3 or (at your option) any
later version (`GPL-3.0-or-later`). See [LICENSE](LICENSE) for the full terms.
