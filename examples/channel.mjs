// Copyright (C) 2026 vpu007
// SPDX-License-Identifier: GPL-3.0-or-later

import { Channel } from "relapsesdk";

const [socketPath, name] = process.argv.slice(2);
if (!socketPath || !name) {
  console.log("Usage: node examples/channel.mjs SOCKET CHANNEL");
} else {
  const channel = await Channel.connect({ socketPath, name });
  channel.on("message", message => console.log(message));
  channel.on("close", info => console.log(info.error?.message ?? `Channel closed (${info.reason}).`));
  const stop = () => channel.close();
  process.once("SIGINT", stop);
  channel.once("close", () => process.off("SIGINT", stop));
  await channel.send({ action: "hello" }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
    channel.close();
  });
}
