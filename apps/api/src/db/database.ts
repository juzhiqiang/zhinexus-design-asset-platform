import { Pool, type PoolClient, type QueryResultRow } from 'pg';

export class Database {
  readonly pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10_000,
      query_timeout: 15_000, statement_timeout: 15_000 });
    this.pool.on('error', () => { /* Per-request callers receive a sanitized infrastructure error. */ });
  }
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) { return this.pool.query<T>(sql, values); }
  async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await operation(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  close(): Promise<void> { return this.pool.end(); }
}
