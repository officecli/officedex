#!/usr/bin/env node

import { createServer } from "node:http";

const configuredAddress = process.env.OFFICEDEX_E2E_BRIDGE_ADDR || "127.0.0.1:40100";
const parsedAddress = new URL(`http://${configuredAddress}`);
const host = parsedAddress.hostname;
const port = Number(parsedAddress.port);
let server;
let demoSession = {
  auth: process.env.OFFICEDEX_DEMO_AUTH || "anonymous",
  credits: Number(process.env.OFFICEDEX_DEMO_CREDITS || 0),
};

server = createServer(async (request, response) => {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === "POST" && request.url === "/rpc/GetAppVersion") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true,"result":"fixture"}\n');
    return;
  }
  if (request.method === "GET" && request.url === "/control/demo/session" && process.env.OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT === "1") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(`${JSON.stringify({ session: demoSession })}\n`);
    return;
  }
  if (request.method === "POST" && request.url === "/control/demo/session" && process.env.OFFICEDEX_DEMO_ACCEPT_ANY_PROMPT === "1") {
    let body = "";
    request.setEncoding("utf8");
    for await (const chunk of request) body += chunk;
    demoSession = JSON.parse(body);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(`${JSON.stringify({ session: demoSession })}\n`);
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end('{"ok":false,"error":"not found"}\n');
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(port, host, resolve);
});
process.stdout.write(`OFFICEDEX_REAL_E2E_ENDPOINT=http://${host}:${port}\n`);

const finish = () => server.close(() => process.exit(0));
process.on("SIGTERM", finish);
process.on("SIGINT", finish);
