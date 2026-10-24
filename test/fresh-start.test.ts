import { describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { forgetIfRestarted } from '../src/freshStart';
function memoryStorage(entries: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(entries));
  return { get length() { return data.size; }, clear: () => data.clear(), key: i => [...data.keys()][i] ?? null,
    getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, String(v)); }, removeItem: k => { data.delete(k); } };
}
async function bootId() {
  const server = createApp({ dist: '__missing_dist__' }).listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  try { return (await (await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/api/health`)).json()).bootId as string; }
  finally { server.close(); }
}
describe('fresh start after a restart', () => {
  it('gives every server start a new boot id', async () => {
    const [first, second] = [await bootId(), await bootId()];
    expect(first).toMatch(/^[0-9a-f-]{36}$/); expect(second).not.toBe(first);
  });
  it('forgets dates, stars, matches and chats when the server restarted, and keeps your profile', () => {
    const storage = memoryStorage({ 'parallel-worlds.server-boot.v1': 'old', 'parallel-worlds.phone-trees.v1': '{}', 'parallel-worlds.phone-stars.v1': '[]',
      'ember.state.v1': '{}', 'ember.me.v1': '{"name":"Alex"}' });
    expect(forgetIfRestarted('new', storage)).toBe(true);
    expect(storage.getItem('parallel-worlds.phone-trees.v1')).toBeNull(); expect(storage.getItem('ember.state.v1')).toBeNull();
    expect(storage.getItem('parallel-worlds.phone-stars.v1')).toBeNull(); expect(storage.getItem('ember.me.v1')).toBe('{"name":"Alex"}');
    // Same server, later visit: nothing is erased.
    storage.setItem('parallel-worlds.phone-trees.v1', '{"x":1}');
    expect(forgetIfRestarted('new', storage)).toBe(false); expect(storage.getItem('parallel-worlds.phone-trees.v1')).toBe('{"x":1}');
    expect(forgetIfRestarted(undefined, storage)).toBe(false);
  });
});
