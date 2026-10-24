import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { ApiError } from '../higgs';
import type { StoredSession } from '../../shared/domain';

export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class DomainError extends ApiError {
  constructor(status: number, readonly code: string, message: string) { super(status, message); }
}
/** Small JSON repository with SQLite transaction/uniqueness guarantees. No provider payloads or credentials. */
export class LocalDatabase {
  readonly sql: DatabaseSync;
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    if(Number(this.sql.prepare('PRAGMA user_version').get()?.user_version)>1){this.sql.close();throw new Error('This database was created by a newer application version.');}
    this.sql.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,
        PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS owner_records ON records(owner,kind);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mutations(owner TEXT NOT NULL,key TEXT NOT NULL,scope TEXT NOT NULL,
        request_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(owner,key));
      PRAGMA user_version=1;`);
    // A process restart cannot keep a socket attachment alive.
    this.transaction(() => {
      for (const s of this.sessions()) if (s.status === 'active' || s.status === 'connecting') {
        s.status = 'closed'; if (s.adaptation) s.adaptation.pending = false; this.saveSession(s);
      }
      for (const a of this.all<any>('attachment')) if (a.status !== 'closed') { a.status = 'closed'; this.put('attachment', a.sessionId, a.owner, a); }
      for (const op of this.all<any>('restore')) if (op.status === 'connecting') {
        op.status = 'failed'; this.put('restore', op.id, this.owner('restore', op.id)!, op);
      }
      for (const job of this.all<any>('analysis-job')) if (job.status === 'running') {
        job.status = 'failed'; job.error = 'PROCESS_RESTART_UNCERTAIN'; job.retryable = true;
        this.put('analysis-job', job.id, this.owner('analysis-job', job.id)!, job);
      }
    });
  }
  transaction<T>(fn: () => T): T {
    if (this.sql.isTransaction) return fn();
    this.sql.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
  get<T>(kind: string, id: string, owner?: string): T {
    const row = this.sql.prepare('SELECT owner,data FROM records WHERE kind=? AND id=?').get(kind, id) as { owner: string; data: string } | undefined;
    if (!row || owner !== undefined && row.owner !== owner) throw new DomainError(404, 'NOT_FOUND', 'Record not found.');
    return JSON.parse(row.data);
  }
  maybe<T>(kind: string, id: string, owner?: string): T | undefined {
    try { return this.get<T>(kind, id, owner); } catch (e) { if (e instanceof DomainError && e.status === 404) return; throw e; }
  }
  owner(kind: string, id: string): string | undefined {
    return (this.sql.prepare('SELECT owner FROM records WHERE kind=? AND id=?').get(kind, id) as { owner: string } | undefined)?.owner;
  }
  put(kind: string, id: string, owner: string, value: unknown) {
    const existingOwner = this.owner(kind, id);
    if (existingOwner !== undefined && existingOwner !== owner) throw new DomainError(403, 'OWNER_MISMATCH', 'Record belongs to another local device.');
    this.sql.prepare('INSERT INTO records(kind,id,owner,data) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data')
      .run(kind, id, owner, JSON.stringify(value));
  }
  immutable(kind: string, id: string, owner: string, value: unknown) {
    const old = this.maybe(kind, id, owner);
    if (old !== undefined && hash(old) !== hash(value)) throw new DomainError(409, 'IMMUTABLE_RECORD', 'Committed history cannot be rewritten.');
    if (old === undefined) this.put(kind, id, owner, value);
  }
  all<T>(kind: string, owner?: string): T[] {
    const rows = owner === undefined ? this.sql.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind)
      : this.sql.prepare('SELECT data FROM records WHERE kind=? AND owner=? ORDER BY rowid').all(kind, owner);
    return rows.map(row => JSON.parse(String(row.data)));
  }
  mutate<T>(owner: string, key: string | undefined, scope: string, input: unknown, fn: () => T): T {
    if (!key || !/^[a-zA-Z0-9:_-]{8,160}$/.test(key)) throw new DomainError(400, 'IDEMPOTENCY_REQUIRED', 'Provide an Idempotency-Key with 8–160 safe characters.');
    return this.transaction(() => {
      const digest = hash(input);
      const prior = this.sql.prepare('SELECT scope,request_hash,result FROM mutations WHERE owner=? AND key=?').get(owner, key) as any;
      if (prior) {
        if (prior.scope !== scope || prior.request_hash !== digest) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'This request key was already used for different content.');
        return JSON.parse(prior.result) as T;
      }
      const result = fn();
      this.sql.prepare('INSERT INTO mutations(owner,key,scope,request_hash,result) VALUES(?,?,?,?,?)')
        .run(owner, key, scope, digest, JSON.stringify(result));
      return result;
    });
  }
  sessions(): StoredSession[] { return this.sql.prepare('SELECT data FROM sessions').all().map(r => JSON.parse(String(r.data))); }
  session(id:string):StoredSession|undefined {const row=this.sql.prepare('SELECT data FROM sessions WHERE id=?').get(id);return row?JSON.parse(String(row.data)):undefined;}
  saveSession(value: StoredSession) { this.sql.prepare('INSERT INTO sessions(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(value.id, JSON.stringify(value)); }
  deleteSession(id: string) { this.sql.prepare('DELETE FROM sessions WHERE id=?').run(id); }
  close() { this.sql.close(); }
}
