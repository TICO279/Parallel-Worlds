/** Runtime diagnostics for the API terminal. Never pass keys, tokens or dialogue text. Silent under tests. */
export function log(scope: string, message: string, secrets: readonly (string | undefined)[] = []) {
  if (process.env.VITEST) return;
  let safe = message;
  for (const secret of secrets) if (secret) safe = safe.replaceAll(secret, '[redacted]');
  safe = safe.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 1000);
  const now = new Date();
  console.log(`${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')} [${scope}] ${safe}`);
}
