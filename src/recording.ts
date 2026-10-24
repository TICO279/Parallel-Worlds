import type { StoredSession, Turn } from '../shared/domain';
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Local API request failed.');
  return data as T;
}
/** One serialized queue per session; retry the latest snapshot, never delay audio. */
export class SessionRecorder {
  private revision = 0; private pending?: { revision: number; turns: Turn[] };
  private lifecycle?: { status: StoredSession['status']; bosonSessionId?: string };
  private running = false; private timer?: ReturnType<typeof setTimeout>; private disposed = false;
  constructor(readonly id: string, private onStatus: (message: string | null) => void,
    private request: typeof api = api, private conversationUrl = `/api/sessions/${id}/conversation`) {}
  snapshot(turns: Turn[]) { this.pending = { revision: ++this.revision, turns: structuredClone(turns) }; void this.flush(); }
  status(status: StoredSession['status'], bosonSessionId?: string) { this.lifecycle = { status, ...(bosonSessionId && { bosonSessionId }) }; void this.flush(); }
  async flush(): Promise<boolean> {
    if (this.running || this.disposed) return false;
    this.running = true; clearTimeout(this.timer);
    try {
      while (!this.disposed && (this.pending || this.lifecycle)) {
        const snapshot = this.pending; const lifecycle = this.lifecycle;
        if (snapshot) {
          await this.request(this.conversationUrl, { method: 'PUT', body: JSON.stringify(snapshot) });
          if (this.pending === snapshot) this.pending = undefined;
        }
        // A newer snapshot may arrive while the captured one is in flight. Closing
        // first would fence that newer snapshot out of a durable branch forever.
        if (lifecycle && this.lifecycle === lifecycle &&
          (!['closed','error'].includes(lifecycle.status) || !this.pending)) {
          await this.request(`/api/sessions/${this.id}`, { method: 'PATCH', body: JSON.stringify(lifecycle) });
          if (this.lifecycle === lifecycle) this.lifecycle = undefined;
        }
      }
      if (!this.disposed) this.onStatus(null); return !this.disposed;
    } catch {
      this.onStatus('Recording is waiting for the local server. Retrying; keep this tab open.');
      if (!this.disposed) this.timer = setTimeout(() => void this.flush(), 2000);
      return false;
    } finally { this.running = false; }
  }
  get synced() { return !this.running && !this.pending && !this.lifecycle; }
  async waitForSync(signal: AbortSignal, timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!this.synced) {
      signal.throwIfAborted();
      if (Date.now() > deadline || this.disposed) throw new Error('Recording is not synchronized.');
      void this.flush();
      if (!this.synced) await new Promise<void>(resolve => setTimeout(resolve, 25));
    }
    signal.throwIfAborted();
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); }
}
