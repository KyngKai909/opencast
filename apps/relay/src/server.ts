// The relay service's health endpoint: GET /health answers relay hours, bandwidth and errors per
// station (contracts RelayHealth). Always 200 while the process is up (a platform refusing a stream
// mustn't make a host restart the service); `ok` is false while a relay it runs has stopped.

import http from "node:http";
import type { RelayHealth } from "@opencast/contracts";

export function healthServer(health: () => RelayHealth | Promise<RelayHealth>): http.Server {
  return http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && (url === "/health" || url === "/")) {
      Promise.resolve()
        .then(health)
        .then((body) => {
          res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
          res.end(JSON.stringify(body));
        })
        .catch((error) => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, service: "opencast-relay", error: (error as Error).message }));
        });
      return;
    }
    res.writeHead(404).end();
  });
}
