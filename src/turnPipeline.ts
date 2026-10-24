import type { JudgeResult } from '../shared/characterState';
import type { TurnPipeline } from './realtime/HiggsClient';
import { api, type SessionRecorder } from './recording';
/** The server half of each turn, shared by the lab and the phone date: judge the recorded line, then voice the reply. */
export function turnPipeline(current: () => { id: string | null; recorder: SessionRecorder | null }): TurnPipeline {
  return {
    judge: async (turnId, signal) => {
      const { id, recorder: r } = current(); if (!id || !r) throw new Error('No session.');
      // The server judges the recorded line, so the transcript must reach it first.
      for (let attempt = 0; ; attempt++) {
        await synced(r, signal);
        try { return await api<JudgeResult>(`/api/sessions/${id}/judge`, { method: 'POST', signal, body: JSON.stringify({ turnId }) }); }
        catch (e) { if (signal.aborted || attempt >= 8) throw e; await sleep(150, signal); }
      }
    },
    speak: async ({ itemId, text, userItemId, discardedDraft }, signal) => {
      const { id } = current(); if (!id) throw new Error('No session.');
      const response = await fetch(`/api/sessions/${id}/speech`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyItemId: itemId, text, ...(userItemId && { userItemId }), ...(discardedDraft !== undefined && { discardedDraft }) }) });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.error === 'string' ? data.error : 'Text-to-speech failed.');
      }
      return chunks(response.body);
    },
  };
}
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms); signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
});
async function synced(recorder: SessionRecorder, signal: AbortSignal) {
  while (!recorder.synced) { signal.throwIfAborted(); await recorder.flush(); if (!recorder.synced) await sleep(100, signal); }
}
/** ReadableStream → async iterable without relying on browser support for `for await` over streams. */
async function* chunks(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  try { for (;;) { const { done, value } = await reader.read(); if (done) return; if (value) yield value; } }
  finally { reader.releaseLock(); }
}
