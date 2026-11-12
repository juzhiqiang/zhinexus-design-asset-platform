import { PlatformError } from '../errors.js';

/** SemVer precedence for the exact, build-metadata-free versions accepted by contracts. */
export function compareVersions(left: string, right: string): number {
  const parse = (version: string) => {
    const found = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
    if (!found) throw new PlatformError('ARTIFACT_MISMATCH');
    return { core: found.slice(1, 4).map(value => BigInt(value!)), pre: found[4]?.split('.') };
  };
  const a = parse(left); const b = parse(right);
  const compare = (x: bigint | string, y: bigint | string) => x === y ? 0 : x > y ? 1 : -1;
  for (let i = 0; i < 3; i++) { const result = compare(a.core[i]!, b.core[i]!); if (result) return result; }
  if (!a.pre || !b.pre) return !a.pre && !b.pre ? 0 : !a.pre ? 1 : -1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]; const y = b.pre[i];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    const xn = /^\d+$/.test(x); const yn = /^\d+$/.test(y);
    const result = xn && yn ? compare(BigInt(x), BigInt(y)) : xn !== yn ? xn ? -1 : 1 : compare(x, y);
    if (result) return result;
  }
  return 0;
}
