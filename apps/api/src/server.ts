import { buildServer } from './app.js';

const app = await buildServer();
app.enableShutdownHooks();
try {
  await app.listen(3000, '127.0.0.1');
  console.log('api bootstrap: http://127.0.0.1:3000/healthz');
} catch {
  await app.close();
  console.error('API startup failed');
  process.exitCode = 1;
}
