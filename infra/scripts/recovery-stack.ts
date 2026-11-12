import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { command, imageId, root, versions, type Credentials } from './local.js';
import { Database } from '../../apps/api/dist/db/database.js';
import { ArtifactStore } from '../../apps/api/dist/storage/artifact-store.js';
import { RegistryClient } from '../../apps/api/dist/releases/registry-client.js';

type Service = 'postgres'|'verdaccio'|'minio';
const services: Service[] = ['postgres','verdaccio','minio'];
const label = 'org.zhinexus.recovery';

/** Owns only fresh, randomly named local rehearsal resources. Never adopts shared infrastructure. */
export class RecoveryStack {
  readonly id = randomUUID();
  readonly directory = join(root, '.tools', 'recovery', this.id);
  readonly names = Object.fromEntries(services.map(s => [s, `zhrec-${this.id}-${s}`])) as Record<Service,string>;
  readonly volumes = Object.fromEntries(services.map(s => [s, `zhrec-${this.id}-${s}-data`])) as Record<Service,string>;
  readonly createdContainers = new Set<Service>();
  readonly createdVolumes = new Set<Service>();
  ports: Record<Service,number> = { postgres:0, verdaccio:0, minio:0 };
  restored = false;
  constructor(readonly secrets: Credentials) { mkdirSync(this.directory, { recursive:true }); }
  docker(args: string[]): string { return command('docker', args); }
  assertOwned(service: Service, volume = false): void {
    const name = volume ? this.volumes[service] : this.names[service];
    const data = JSON.parse(this.docker(volume ? ['volume','inspect',name] : ['inspect',name]))[0];
    if ((volume ? data.Labels : data.Config.Labels)?.[label] !== this.id) throw new Error('Recovery resource ownership mismatch');
  }
  async start(): Promise<void> {
    const sha = (s: string) => '{SHA}' + createHash('sha1').update(s).digest('base64');
    for (const [file, content] of Object.entries({
      'postgres-password': this.secrets.postgresPassword, 'minio-user': this.secrets.minioUser, 'minio-password': this.secrets.minioPassword,
      'registry-users': `g2publisher:${sha(this.secrets.publisherPassword)}\ng2reader:${sha(this.secrets.readerPassword)}\n`,
    })) writeFileSync(join(this.directory,file),content,{ mode:0o600, flag:'wx' });
    for (const s of services) {
      this.docker(['volume','create','--label',`${label}=${this.id}`,this.volumes[s]]); this.createdVolumes.add(s);
      const mount = (file: string, target: string) => ['--mount',`type=bind,src=${join(this.directory,file)},dst=${target},readonly`];
      const common = ['run','-d','--name',this.names[s],'--label',`${label}=${this.id}`,'--platform','linux/amd64',
        '--security-opt','no-new-privileges:true','-p',`127.0.0.1::${{postgres:5432,verdaccio:4873,minio:9000}[s]}`];
      let args: string[];
      if (s === 'postgres') args = [...common, '--mount',`type=volume,src=${this.volumes[s]},dst=/var/lib/postgresql`,
        ...mount('postgres-password','/run/secrets/password'),'-e','POSTGRES_USER=zhinexus','-e','POSTGRES_DB=zhinexus',
        '-e','POSTGRES_PASSWORD_FILE=/run/secrets/password',versions.postgres.image];
      else if (s === 'verdaccio') args = [...common,'--mount',`type=volume,src=${this.volumes[s]},dst=/verdaccio/storage`,
        '--mount',`type=bind,src=${join(root,'infra/verdaccio/config.yaml')},dst=/verdaccio/conf/config.yaml,readonly`,
        ...mount('registry-users','/run/secrets/registry_users'),versions.verdaccio.image];
      else args = [...common,'--mount',`type=volume,src=${this.volumes[s]},dst=/data`, '--read-only','--tmpfs','/tmp',
        ...mount('minio-user','/run/secrets/user'),...mount('minio-password','/run/secrets/password'),
        '-e','MINIO_ROOT_USER_FILE=/run/secrets/user','-e','MINIO_ROOT_PASSWORD_FILE=/run/secrets/password','-e','MINIO_BROWSER=off',imageId()];
      this.docker(args); this.createdContainers.add(s);
      this.refreshPort(s);
    }
    await this.ready();
  }
  private refreshPort(s: Service): void {
    const info = JSON.parse(this.docker(['inspect',this.names[s]]))[0];
    const binding = info.NetworkSettings.Ports[`${{postgres:5432,verdaccio:4873,minio:9000}[s]}/tcp`]?.[0];
    if (!binding || binding.HostIp!=='127.0.0.1') throw new Error('Recovery service must bind to loopback');
    this.ports[s] = Number(binding.HostPort);
  }
  async ready(): Promise<void> {
    const deadline = Date.now()+60_000;
    while (Date.now()<deadline) {
      try {
        this.docker(['exec',this.names.postgres,'pg_isready','-h','127.0.0.1','-U','zhinexus','-d','zhinexus']);
        for (const [s,path] of [['verdaccio','/-/ping'],['minio','/minio/health/ready']] as const)
          if (!(await fetch(`http://127.0.0.1:${this.ports[s]}${path}`,{signal:AbortSignal.timeout(1000)})).ok) throw new Error();
        return;
      } catch { await delay(250); }
    }
    throw new Error('Isolated recovery services did not become ready');
  }
  async clients<T>(operation: (clients: { db:Database; store:ArtifactStore; registry:RegistryClient }) => Promise<T>): Promise<T> {
    const db = new Database(`postgresql://zhinexus:${encodeURIComponent(this.secrets.postgresPassword)}@127.0.0.1:${this.ports.postgres}/zhinexus`);
    const store = new ArtifactStore({endpoint:`http://127.0.0.1:${this.ports.minio}`,bucket:'recovery-assets',region:'us-east-1',accessKeyId:this.secrets.minioUser,secretAccessKey:this.secrets.minioPassword});
    try {
      const origin = `http://127.0.0.1:${this.ports.verdaccio}`;
      const response = await fetch(`${origin}/-/user/org.couchdb.user:g2publisher`,{method:'PUT',signal:AbortSignal.timeout(5000),
        headers:{'content-type':'application/json',authorization:`Basic ${Buffer.from(`g2publisher:${this.secrets.publisherPassword}`).toString('base64')}`},
        body:JSON.stringify({name:'g2publisher',password:this.secrets.publisherPassword,type:'user',roles:[],date:new Date().toISOString()})});
      if (!response.ok) throw new Error('Recovery registry authentication failed');
      const registry = new RegistryClient({origin,token:(await response.json()).token});
      return await operation({db,store,registry});
    } finally { store.close(); await db.close(); }
  }
  stopData(): void { for (const s of ['verdaccio','minio'] as const) { this.assertOwned(s); this.docker(['stop','--time','10',this.names[s]]); } }
  async startData(): Promise<void> {
    for (const s of ['verdaccio','minio'] as const) {
      this.assertOwned(s); this.docker(['start',this.names[s]]);
      const previous = this.ports[s]; this.refreshPort(s);
      if (previous!==this.ports[s]) console.log(JSON.stringify({event:'RECOVERY_PORT_REASSIGNED',service:s}));
    }
    await this.ready();
  }
  async close(): Promise<void> {
    for (const s of this.createdContainers) { this.assertOwned(s); this.docker(['rm','--force',this.names[s]]); }
    for (const s of this.createdVolumes) { this.assertOwned(s,true); this.docker(['volume','rm',this.volumes[s]]); }
    // Local backup/credential files are retained in the ignored directory for recovery inspection.
  }
}
export async function createRecoveryStack(secrets?: Credentials): Promise<RecoveryStack> {
  const password = () => randomBytes(32).toString('base64url');
  const stack = new RecoveryStack(secrets ?? {postgresPassword:password(),publisherPassword:password(),readerPassword:password(),minioUser:'recovery-user',minioPassword:password()});
  try { await stack.start(); return stack; } catch(error) { await stack.close(); throw error; }
}
