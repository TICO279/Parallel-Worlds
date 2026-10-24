/** Conversations the phone keeps in this browser: date trees, ★ markers, Ember matches and chats. Your profile stays. */
export const CONVERSATION_KEYS = ['parallel-worlds.phone-trees.v1', 'parallel-worlds.phone-stars.v1', 'ember.state.v1'];
const BOOT_KEY = 'parallel-worlds.server-boot.v1';
/**
 * Every server start has a new boot id (GET /api/health). Seeing a new one means the app was restarted,
 * so the phone starts from scratch too. Returns true when conversations were erased. dating/app.js mirrors this.
 */
export function forgetIfRestarted(bootId: unknown, storage: Storage = localStorage): boolean {
  if (typeof bootId !== 'string' || !bootId) return false;
  try {
    if (storage.getItem(BOOT_KEY) === bootId) return false;
    const had = CONVERSATION_KEYS.some(key => storage.getItem(key) !== null);
    for (const key of CONVERSATION_KEYS) storage.removeItem(key);
    storage.setItem(BOOT_KEY, bootId);
    return had;
  } catch { return false; }
}
