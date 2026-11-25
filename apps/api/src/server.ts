import { buildServer } from './app.js';
import { environmentOptions } from './platform.js';

const options = environmentOptions();
if (
  process.env.NODE_ENV !== 'production'
  && process.env.PLATFORM_DEV_ADMIN !== 'false'
  && !options.oidc
  && !options.access
  && !options.localIdentity
  && !options.identity
) {
  options.devAdmin = {
    username: process.env.PLATFORM_DEV_ADMIN_USERNAME || 'admin',
    password: process.env.PLATFORM_DEV_ADMIN_PASSWORD || 'ZhinexusAdmin!2026',
  };
}

const app = await buildServer(options);
app.enableShutdownHooks();
try {
  await app.listen(3000, process.env.PLATFORM_BIND_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1');
  console.log('api bootstrap: http://127.0.0.1:3000/healthz');
  if (options.devAdmin) {
    console.log(`dev admin login enabled (username: ${options.devAdmin.username})`);
  }
} catch {
  await app.close();
  console.error('API startup failed');
  process.exitCode = 1;
}
