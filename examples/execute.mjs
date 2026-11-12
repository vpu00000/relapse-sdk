// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import { Client, listClients } from "relapsesdk";

const [socketPath, file] = process.argv.slice(2);
if (!socketPath || !file) {
  console.log("Usage: node examples/execute.mjs SOCKET SCRIPT.luau");
  console.table(await listClients());
} else {
  const client = await Client.connect({ socketPath });
  const main = client.mainChannel;
  main.on("log", entry => console.log(`[${entry.level}] ${entry.text}`));
  const ready = main.ready ? Promise.resolve() : main.waitFor("status", status => status.ready);
  await ready
    .then(() => main.executeFile(file))
    .then(() => console.log("Script submitted."))
    .catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => client.close());
}
