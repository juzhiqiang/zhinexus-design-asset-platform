import { createServer, connect, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { createServer as httpServer, request } from 'node:http';

/** Loopback-only transport cut: never stops or mutates the shared service. */
export async function faultProxy(targetPort: number) {
  let blocked = false; const sockets = new Set<Socket>();
  const server = createServer(client => {
    if (blocked) { client.destroy(); return; }
    const upstream = connect(targetPort, '127.0.0.1');
    for (const socket of [client, upstream]) { sockets.add(socket); socket.on('error', () => { client.destroy(); upstream.destroy(); }); socket.on('close', () => sockets.delete(socket)); }
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { port, origin: `http://127.0.0.1:${port}`,
    block() { blocked = true; for (const socket of sockets) socket.destroy(); },
    restore() { blocked = false; },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

export async function responseLossProxy(targetPort: number) {
  let dropped = false; const writes = new Map<string, number>(); const sockets = new Set<Socket>();
  const server = httpServer((incoming, response) => {
    const isPublish = incoming.method === 'PUT' && !incoming.url?.startsWith('/-/');
    if (isPublish) writes.set(incoming.url!, (writes.get(incoming.url!) ?? 0) + 1);
    const upstream = request({ hostname: '127.0.0.1', port: targetPort, path: incoming.url, method: incoming.method, headers: incoming.headers }, result => {
      if (isPublish && !dropped && result.statusCode! >= 200 && result.statusCode! < 300) {
        dropped = true; result.resume(); result.on('end', () => response.destroy());
      } else { response.writeHead(result.statusCode!, result.headers); result.pipe(response); }
    });
    upstream.on('error', () => response.destroy()); incoming.pipe(upstream);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, writes, lost: () => dropped,
    async close() { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
