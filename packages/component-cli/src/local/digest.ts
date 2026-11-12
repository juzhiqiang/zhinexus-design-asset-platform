import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type ArtifactRef = {
  path: string;
  sha256: string;
  bytes: number;
};

/**
 * 计算内存 Buffer 或字符串的小写 64 位 SHA-256 十六进制摘要。
 */
export function computeBufferSha256(buffer: Buffer | Uint8Array | string): string {
  const hash = crypto.createHash('sha256');
  hash.update(typeof buffer === 'string' ? Buffer.from(buffer, 'utf8') : buffer);
  return hash.digest('hex').toLowerCase();
}

/**
 * 异步计算磁盘文件的小写 64 位 SHA-256 十六进制摘要。
 */
export async function computeFileSha256(filePath: string): Promise<string> {
  const data = await fs.promises.readFile(filePath);
  return computeBufferSha256(data);
}

/**
 * 为指定文件生成包含相对路径、小写十六进制 SHA-256 及字节尺寸的标准 ArtifactRef。
 */
export async function createArtifactRef(
  filePath: string,
  relativePath?: string,
): Promise<ArtifactRef> {
  const stat = await fs.promises.stat(filePath);
  const sha256 = await computeFileSha256(filePath);
  return {
    path: (relativePath ?? filePath).replace(/\\/g, '/'),
    sha256,
    bytes: stat.size,
  };
}

const DEFAULT_IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
  '.release-freeze',
]);

const DEFAULT_IGNORED_EXTENSIONS = new Set([
  '.log',
  '.tgz',
  '.tsbuildinfo',
]);

const DEFAULT_IGNORED_FILES = new Set([
  '.DS_Store',
  'Thumbs.db',
]);

/**
 * 递归收集目录下的文件，并计算确定性源码摘要（sourceDigest）。
 * - 路径使用正斜杠归一化并严格按字母升序排序；
 * - 排除 .git、node_modules、dist、.turbo 等瞬态及编译产物；
 * - 文本文件归一化为 LF 换行，防止跨平台 Windows/Linux 换行差异影响摘要。
 */
export async function computeSourceDigest(
  sourceDir: string,
  options?: { ignore?: string[] },
): Promise<string> {
  const customIgnore = new Set(options?.ignore ?? []);

  async function walk(currentDir: string): Promise<string[]> {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(entry.name) || customIgnore.has(entry.name)) {
          continue;
        }
        files.push(...(await walk(fullPath)));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (
          DEFAULT_IGNORED_FILES.has(entry.name) ||
          DEFAULT_IGNORED_EXTENSIONS.has(ext) ||
          customIgnore.has(entry.name)
        ) {
          continue;
        }
        files.push(fullPath);
      }
    }
    return files;
  }

  const allFiles = await walk(sourceDir);
  // 正斜杠相对路径严格升序排序
  const relativeFiles = allFiles
    .map((f) => ({
      fullPath: f,
      relPath: path.relative(sourceDir, f).replace(/\\/g, '/'),
    }))
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  const cumulative = crypto.createHash('sha256');

  for (const file of relativeFiles) {
    const buf = await fs.promises.readFile(file.fullPath);
    // 判断是否为文本文件
    const isText = isTextBuffer(buf);
    let normalized = buf;
    if (isText) {
      // 换行归一化为 LF
      const text = buf.toString('utf8').replace(/\r\n/g, '\n');
      normalized = Buffer.from(text, 'utf8');
    }
    const fileSha = computeBufferSha256(normalized);
    cumulative.update(`${file.relPath}:${fileSha}\n`);
  }

  return cumulative.digest('hex').toLowerCase();
}

function isTextBuffer(buf: Buffer): boolean {
  // 检查前 1024 字节是否含 0 字节 (null byte)
  const len = Math.min(buf.length, 1024);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return false;
  }
  return true;
}
