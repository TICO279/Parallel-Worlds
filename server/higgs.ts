import type { ProtocolEvent, SessionSpec } from '../shared/domain';
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function buildHiggsConfig(spec: SessionSpec, output: 'audio' | 'text' = 'audio'): ProtocolEvent {
  return { type: 'session.update', session: {
    model: 'higgs-realtime', instructions: spec.instructions, output_modalities: [output],
    audio: {
      input: { format: { type: 'audio/pcm', rate: 24000 }, turn_detection: { type: 'server_vad' },
        transcription: { model: 'higgs-stt-3.1', language: spec.language } },
      output: { format: { type: 'audio/pcm', rate: 24000 }, voice: spec.voice },
    },
  } };
}
export async function mintCredential(key: string | undefined, fetcher: typeof fetch = fetch) {
  if (!key?.trim()) throw new ApiError(503, 'Set BOSON_API_KEY in your local .env, then restart the backend.');
  let response: Response;
  try {
    response = await fetcher('https://api.boson.ai/v1/realtime/client_secrets', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_after: { seconds: 600 } }),
    });
  } catch { throw new ApiError(502, 'Could not reach Boson. Check your network and try again.'); }
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403 ? 'Boson rejected the API key. Check BOSON_API_KEY and account access.'
      : response.status === 429 ? 'Boson is rate limiting requests. Wait and try again.'
      : response.status === 402 ? 'Boson requires available account credit.' : `Boson session initialization failed (HTTP ${response.status}).`;
    throw new ApiError(502, message);
  }
  try {
    const data = await response.json();
    if (typeof data.value !== 'string' || !data.value.startsWith('bai-eph-') || !Number.isFinite(data.expires_at)) throw new Error();
    return { value: data.value as string, expires_at: data.expires_at as number };
  } catch { throw new ApiError(502, 'Boson returned an invalid client credential response.'); }
}
