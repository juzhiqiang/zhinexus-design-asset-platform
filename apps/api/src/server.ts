import { buildServer } from './app.js';
const app = buildServer();
try {
  await app.listen({ host: '127.0.0.1', port: 3000 });
  console.log('api bootstrap: http://127.0.0.1:3000/healthz');
} catch (error) { console.error(error); process.exitCode = 1; }
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close(); });
}
