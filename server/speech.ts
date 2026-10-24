import { ApiError } from './higgs';
import { debug, log } from './log';
import type { SpeechConfig } from './adaptation/config';

export const TTS_URL = 'https://api.boson.ai/v1/audio/speech';
/**
 * Opens a streaming Higgs TTS 3 request: raw PCM16, 24 kHz mono, matching the browser player.
 * Errors before any audio become ApiErrors; the caller streams `body` and reports timing.
 */
export async function openSpeech(fetcher: typeof fetch, key: string | undefined, config: SpeechConfig, input: string, signal: AbortSignal, tag: string) {
  if (!key?.trim()) throw new ApiError(503, 'Set BOSON_API_KEY in your local .env, then restart the backend.');
  const started = performance.now();
  debug('tts', `→ POST api.boson.ai/v1/audio/speech model=${config.model} voice=${config.voice} ${tag} (${input.length} chars)`);
  let response: Response;
  try {
    response = await fetcher(TTS_URL, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)]),
      headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model, input, voice: config.voice, response_format: 'pcm', stream: true }) });
  } catch {
    log('tts', `✗ api.boson.ai/v1/audio/speech ${signal.aborted ? 'cancelled' : 'unreachable or timed out'} after ${Math.round(performance.now() - started)} ms`);
    throw new ApiError(502, 'Could not reach Boson text-to-speech.');
  }
  (response.ok ? debug : log)('tts', `← api.boson.ai/v1/audio/speech HTTP ${response.status} in ${Math.round(performance.now() - started)} ms`);
  // Upstream error bodies can echo request fields; never forward them.
  if (!response.ok || !response.body) throw new ApiError(502, response.status === 401 || response.status === 403 ? 'Boson rejected the API key for text-to-speech.'
    : response.status === 402 ? 'Boson text-to-speech requires available account credit.' : `Boson text-to-speech failed (HTTP ${response.status}).`);
  return { body: response.body, started };
}
