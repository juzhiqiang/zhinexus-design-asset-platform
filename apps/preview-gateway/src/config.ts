import { previewConfigFromEnv, type PreviewConfig } from '@company/contracts/preview';
export type StorageConfig = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
export type GatewayOptions = { databaseUrl?: string; storage?: StorageConfig; preview?: PreviewConfig;deploymentId?:string };
export const LOOPBACK_DEV_PREVIEW: PreviewConfig = {
  mode: 'ip-port',
  platformOrigin: 'http://127.0.0.1:5173',
  apiOrigin: 'http://127.0.0.1:3000',
  previewOrigin: 'http://127.0.0.1:3001',
};
export function isLoopbackDevPreview(config: PreviewConfig): boolean {
  return config.mode === 'ip-port'
    && config.platformOrigin === LOOPBACK_DEV_PREVIEW.platformOrigin
    && config.apiOrigin === LOOPBACK_DEV_PREVIEW.apiOrigin
    && config.previewOrigin === LOOPBACK_DEV_PREVIEW.previewOrigin;
}
export function environmentOptions(): GatewayOptions {
  const env = process.env; const options: GatewayOptions = {};
  if (env.PLATFORM_DATABASE_URL) options.databaseUrl = env.PLATFORM_DATABASE_URL;
  if (env.PLATFORM_PREVIEW_DEPLOYMENT_ID) options.deploymentId=env.PLATFORM_PREVIEW_DEPLOYMENT_ID;
  options.preview = previewConfigFromEnv(env);
  if (env.PLATFORM_S3_ENDPOINT) options.storage = { endpoint: env.PLATFORM_S3_ENDPOINT, bucket: env.PLATFORM_S3_BUCKET ?? '', region: env.PLATFORM_S3_REGION ?? 'us-east-1',
    accessKeyId: env.PLATFORM_S3_ACCESS_KEY ?? '', secretAccessKey: env.PLATFORM_S3_SECRET_KEY ?? '' };
  if (
    !options.preview
    && env.NODE_ENV !== 'production'
    && env.PLATFORM_BIND_HOST !== '0.0.0.0'
    && env.PLATFORM_DEV_PREVIEW !== 'false'
    && options.databaseUrl
    && options.storage
  ) {
    options.preview = { ...LOOPBACK_DEV_PREVIEW };
  }
  return options;
}
