import { GetObjectCommand, type GetObjectCommandInput, type S3Client } from '@aws-sdk/client-s3';

export async function withS3Deadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('S3 operation timed out');
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try { return await Promise.race([operation(controller.signal), deadline]); }
  finally { clearTimeout(timer); }
}

export function readS3Object(client: S3Client, input: GetObjectCommandInput, timeoutMs = 15_000): Promise<Uint8Array> {
  return withS3Deadline(async signal => {
    const response = await client.send(new GetObjectCommand(input), { abortSignal: signal });
    const body = response.Body;
    if (!body) throw new Error('S3 object has no body');
    // SDK send resolves at the headers. Keep cancellation active through body consumption.
    const close = () => { if ('destroy' in body) body.destroy(); };
    signal.addEventListener('abort', close, { once: true });
    try {
      if (signal.aborted) throw new Error('S3 operation timed out');
      return await body.transformToByteArray();
    } finally {
      signal.removeEventListener('abort', close);
      close();
    }
  }, timeoutMs);
}
