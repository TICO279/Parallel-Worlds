/**
 * Runtime diagnostics for the API terminal. Never pass keys or tokens. Dialogue appears only in the
 * per-turn story (this local terminal), never in request-level lines. Silent under tests.
 */
const stamp = () => { const now = new Date(); return `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')}`; };
export function log(scope: string, message: string, secrets: readonly (string | undefined)[] = []) {
  if (process.env.VITEST) return;
  let safe = message;
  for (const secret of secrets) if (secret) safe = safe.replaceAll(secret, '[redacted]');
  safe = safe.replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, 1000);
  console.log(`${stamp()} [${scope}] ${safe}`);
}
/** Request-level detail (every HTTP call and status). Shown with LOG_HTTP=1. */
export function debug(scope: string, message: string, secrets: readonly (string | undefined)[] = []) {
  if (process.env.LOG_HTTP === '1') log(scope, message, secrets);
}
/** A multi-line block printed in one piece, so concurrent requests cannot interleave inside it. */
export function block(lines: string[]) {
  if (process.env.VITEST) return;
  console.log(lines.join('\n'));
}
