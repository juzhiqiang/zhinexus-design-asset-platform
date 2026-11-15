import {
  validateApiMessage, validateCandidate, validateProjectContext,
  type AcceptedCompatibilityRecord, type Candidate, type ProjectContext, type ReleaseState, type SearchCandidatesResponse, type PackageRef, type VariantRef,
} from '@company/contracts';
import { PlatformError } from '../errors.js';

/** Internal retrieval adapter types, not HTTP request DTOs. */
export type IndexedCandidateHit = {
  variantReleaseId: string; revision: string; providerVersion: string; ranking: Candidate['ranking'];
};
export type CurrentCandidateSnapshot = {
  variant?: VariantRef; package?: PackageRef;
  candidate: Omit<Candidate, 'ranking' | 'compatibility'>;
  canRead: boolean; availability: 'Ready' | 'DEPRECATED' | 'Pending'; packageState: ReleaseState; jobState: ReleaseState;
  revision: string; activeProviderVersion: string;
  index: { state: 'ready' | 'pending' | 'failed'; revision: string; providerVersion: string };
  peerDependencies: Record<string, string>;
  acceptedCompatibility: AcceptedCompatibilityRecord[];
};
/** Must bind the authenticated subject and read current authoritative metadata, not the search index. */
export type LoadCurrentCandidate = (variantReleaseId: string) => Promise<CurrentCandidateSnapshot | null>;

function exactVersion(value: string): boolean {
  return validateProjectContext({ framework: 'react', frameworkVersion: value, packageManager: 'pnpm', requirements: [] }).ok;
}

function peersSatisfied(context: ProjectContext, required: Record<string, string>, hostPeers: Readonly<Record<string, string>>): boolean {
  if (!Object.hasOwn(required, context.framework)) return false;
  const known: Record<string, string> = { ...hostPeers };
  // Explicit project constraints cannot be replaced by the caller's supplemental peer facts.
  if (Object.hasOwn(known, context.framework) && known[context.framework] !== context.frameworkVersion) return false;
  known[context.framework] = context.frameworkVersion;
  if (context.echartsVersion !== undefined) {
    if (Object.hasOwn(known, 'echarts') && known.echarts !== context.echartsVersion) return false;
    known.echarts = context.echartsVersion;
  }
  return Object.entries(required).every(([name, version]) => exactVersion(version) && Object.hasOwn(known, name) && known[name] === version);
}

function buildEligible(context: ProjectContext, hit: IndexedCandidateHit, current: CurrentCandidateSnapshot | null,
  hostPeers: Readonly<Record<string, string>>): Candidate | null {
  if (!current) return null;
  const { index } = current;
  if (index.state !== 'ready' ||
      !current.revision || !current.activeProviderVersion || hit.revision !== current.revision || index.revision !== current.revision ||
      hit.providerVersion !== current.activeProviderVersion || index.providerVersion !== current.activeProviderVersion) return null;
  const eligible = eligibleRelease(context, hit.variantReleaseId, current, hostPeers);
  if (!eligible) return null;
  const result = validateCandidate({ ...eligible, ranking: hit.ranking });
  return result.ok ? structuredClone(result.value) : null;
}

/** Authoritative release eligibility, independent of any discovery index or ranking. */
export function eligibleRelease(context: ProjectContext, id: string, current: CurrentCandidateSnapshot | null,
  hostPeers: Readonly<Record<string, string>> = {}): Omit<Candidate, 'ranking'> | null {
  if (!current || !current.canRead || current.availability !== 'Ready' || current.packageState !== 'READY' || current.jobState !== 'READY') return null;
  const { candidate } = current;
  if (!current.revision || candidate.variantReleaseId !== id || candidate.framework !== context.framework || !peersSatisfied(context, current.peerDependencies, hostPeers)) return null;

  const recordIds = new Set<string>();
  for (const record of current.acceptedCompatibility) {
    const checked = validateApiMessage('variantCompatibilityResponse', { variantReleaseId: candidate.variantReleaseId, items: [record] });
    if (checked.ok && record.status === 'passed' && record.variantReleaseId === candidate.variantReleaseId &&
        record.packageName === candidate.packageName && record.packageVersion === candidate.packageVersion &&
        record.packageSha256 === candidate.packageSha256 && record.framework === context.framework &&
        record.frameworkVersion === context.frameworkVersion && context.echartsVersion !== undefined && record.echartsVersion === context.echartsVersion) {
      recordIds.add(record.compatibilityId);
    }
  }
  const result = validateCandidate({ ...candidate, ranking: { text: 0 },
    compatibility: { status: recordIds.size ? 'verified' : 'unverified', recordIds: [...recordIds] } });
  // Return an owned snapshot: subsequent adapter mutation must not alter the response.
  if (!result.ok) return null;
  const { ranking: _ranking, ...release } = structuredClone(result.value);
  return release;
}

/** No model, component execution, HTTP or DB access here; the future adapter owns those reads. */
export async function filterEligibleCandidates(context: ProjectContext, hits: readonly IndexedCandidateHit[],
  loadCurrent: LoadCurrentCandidate, hostPeers: Readonly<Record<string, string>> = {}): Promise<SearchCandidatesResponse> {
  const checked = validateProjectContext(context);
  if (!checked.ok) throw new PlatformError('INVALID_SCHEMA', checked.issues);
  const fixedContext = structuredClone(checked.value);
  const fixedPeers = { ...hostPeers };
  const uniqueHits = new Map<string, IndexedCandidateHit>();
  for (const hit of hits) if (!uniqueHits.has(hit.variantReleaseId)) uniqueHits.set(hit.variantReleaseId, structuredClone(hit));
  const eligible: IndexedCandidateHit[] = [];
  for (const hit of uniqueHits.values()) {
    if (buildEligible(fixedContext, hit, await loadCurrent(hit.variantReleaseId), fixedPeers)) eligible.push(hit);
  }
  const candidates: Candidate[] = [];
  // Re-read after initial retrieval/filtering. A future DB adapter still needs its own transaction policy.
  for (const hit of eligible) {
    const candidate = buildEligible(fixedContext, hit, await loadCurrent(hit.variantReleaseId), fixedPeers);
    if (candidate) candidates.push(candidate);
  }
  return { candidates, gaps: candidates.length ? [] : ['未找到符合当前约束的候选'] };
}
