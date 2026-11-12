import { buildServer } from './app.js';

const app = await buildServer();
app.enableShutdownHooks();
try {
  await app.listen(3001, process.env.PLATFORM_BIND_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1');
  console.log('preview-gateway bootstrap: http://127.0.0.1:3001/healthz');
} catch {
  await app.close();
  console.error('Preview gateway startup failed');
  process.exitCode = 1;
}
