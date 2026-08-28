#!/usr/bin/env node

import { createServer } from "node:http";

const port = Number(process.argv[2] || 0);
if (process.env.OFFICEDEX_DEVCTL_FIXTURE_FAIL === "1" && port === 0) process.exit(23);

let server = null;
if (port > 0) {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("devctl fixture ready\n");
  });
  server.listen(port, "127.0.0.1", () => process.stdout.write(`ready ${port}\n`));
}

const finish = () => {
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
};
process.on("SIGTERM", finish);
process.on("SIGINT", finish);
setInterval(() => {}, 60_000);
