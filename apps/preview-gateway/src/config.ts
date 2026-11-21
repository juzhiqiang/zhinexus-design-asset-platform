import { previewConfigFromEnv, type PreviewConfig } from '@company/contracts/preview';
export type StorageConfig = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };
export type GatewayOptions = { databaseUrl?: string; storage?: StorageConfig; preview?: PreviewConfig;deploymentId?:string };
export function environmentOptions(): GatewayOptions {
  const env = process.env; const options: GatewayOptions = {};
  if (env.PLATFORM_DATABASE_URL) options.databaseUrl = env.PLATFORM_DATABASE_URL;
  if (env.PLATFORM_PREVIEW_DEPLOYMENT_ID) options.deploymentId=env.PLATFORM_PREVIEW_DEPLOYMENT_ID;
  options.preview = previewConfigFromEnv(env);
  if (env.PLATFORM_S3_ENDPOINT) options.storage = { endpoint: env.PLATFORM_S3_ENDPOINT, bucket: env.PLATFORM_S3_BUCKET ?? '', region: env.PLATFORM_S3_REGION ?? 'us-east-1',
    accessKeyId: env.PLATFORM_S3_ACCESS_KEY ?? '', secretAccessKey: env.PLATFORM_S3_SECRET_KEY ?? '' };
  return options;
}
