/** Runtime diagnostics for the API terminal. Never pass keys, tokens or dialogue text. Silent under tests. */
export function log(scope: string, message: string) {
  if (process.env.VITEST) return;
  const now = new Date();
  console.log(`${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')} [${scope}] ${message}`);
}
