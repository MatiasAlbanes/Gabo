// Gateway mínimo equivalente al de Supabase: /rest/v1 -> PostgREST, /auth/v1 -> GoTrue.
import http from "node:http";

const PORT = Number(process.env.PROXY_PORT ?? 54321);
const routes = [
  { prefix: "/rest/v1", port: 54323 },
  { prefix: "/auth/v1", port: 54324 },
];

http
  .createServer((req, res) => {
    const route = routes.find((r) => req.url.startsWith(r.prefix));
    if (!route) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end('{"message":"no route"}');
    }
    const upstream = http.request(
      { host: "127.0.0.1", port: route.port, method: req.method, path: req.url.slice(route.prefix.length) || "/", headers: req.headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end('{"message":"upstream unavailable"}');
    });
    req.pipe(upstream);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`stack proxy on :${PORT}`));
