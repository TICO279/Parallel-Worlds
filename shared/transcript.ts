import type { Conversation, ProtocolEvent, Turn } from './domain';
export const emptyConversation = (): Conversation => ({ order: [], items: {}, seen: {} });
const str = (x: unknown) => typeof x === 'string' ? x : undefined;
const obj = (x: unknown): Record<string, unknown> => x && typeof x === 'object' ? x as Record<string, unknown> : {};
export function orderedTurns(s: Conversation): Turn[] { return s.order.map(id => s.items[id]); }
function reorder(s: Conversation): void {
  const emitted = new Set<string>(); const visiting = new Set<string>(); const result: string[] = [];
  const visit = (id: string) => {
    if (emitted.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const prev = s.items[id]?.previousItemId;
    if (prev && s.items[prev]) visit(prev);
    visiting.delete(id); emitted.add(id); result.push(id);
  };
  s.order.forEach(visit); s.order = result;
  s.order.forEach((id, order) => { s.items[id] = { ...s.items[id], order }; });
}
/** Provider events become domain state here; no clock, I/O, or React dependencies. */
export function reduceTranscript(before: Conversation, e: ProtocolEvent, now: number): Conversation {
  if (e.event_id && before.seen[e.event_id]) return before;
  const s: Conversation = { order: [...before.order], items: { ...before.items }, seen: { ...before.seen } };
  if (e.event_id) s.seen[e.event_id] = true;
  const item = obj(e.item); const response = obj(e.response);
  const id = str(e.item_id) ?? str(item.id);
  const ensure = (role: Turn['role']) => {
    if (!id) return undefined;
    if (!s.items[id]) {
      s.order.push(id);
      s.items[id] = { itemId: id, role, text: role === 'user' ? null : '', transcriptFinal: false,
        status: role === 'user' ? 'pending' : 'streaming', order: s.order.length - 1, startedAt: now, updatedAt: now };
    }
    const t = { ...s.items[id], updatedAt: now };
    if ('previous_item_id' in e) t.previousItemId = str(e.previous_item_id) ?? null;
    if (str(e.response_id)) t.responseId = str(e.response_id);
    s.items[id] = t; return t;
  };
  switch (e.type) {
    case 'input_audio_buffer.speech_started': ensure('user'); break;
    case 'input_audio_buffer.committed': ensure('user'); break;
    case 'conversation.item.added':
      if (item.role === 'user' || item.role === 'assistant') {
        const t = ensure(item.role);
        const parts = Array.isArray(item.content) ? item.content : [];
        const text = parts.map(p => str(obj(p).text)).filter(Boolean).join('');
        if (t && text && !t.transcriptFinal) { t.text = text; t.transcriptFinal = true; t.status = 'complete'; t.completedAt = now; }
      }
      break;
    case 'response.output_item.added': if (item.type === 'message' && item.role === 'assistant') ensure('assistant'); break;
    case 'conversation.item.input_audio_transcription.completed': {
      const t = ensure('user'); if (t) { t.text = str(e.transcript) ?? ''; t.transcriptFinal = true; t.status = 'complete'; t.completedAt = now; } break;
    }
    case 'conversation.item.input_audio_transcription.failed': {
      const t = ensure('user'); if (t) { t.text = null; t.transcriptionFailed = true; t.transcriptFinal = false; t.status = 'incomplete'; } break;
    }
    case 'response.output_audio_transcript.delta': {
      const t = ensure('assistant'); if (t && !t.transcriptFinal) t.text = (t.text ?? '') + (str(e.delta) ?? ''); break;
    }
    case 'response.output_audio_transcript.done': {
      const t = ensure('assistant'); if (t) {
        t.text = str(e.transcript) ?? t.text; t.transcriptFinal = true; t.completedAt = now;
        if (t.status !== 'interrupted') t.status = 'complete';
      } break;
    }
    case 'client.interrupted': {
      const t = id && s.items[id] ? ensure('assistant') : undefined;
      if (t) { t.status = 'interrupted'; t.playedMs = typeof e.played_ms === 'number' ? e.played_ms : 0; } break;
    }
    case 'response.done': {
      for (const [key, turn] of Object.entries(s.items)) {
        if (turn.role === 'assistant' && turn.responseId === response.id && response.status !== 'completed' && turn.status !== 'interrupted')
          s.items[key] = { ...turn, status: response.status === 'cancelled' ? 'interrupted' : 'incomplete', updatedAt: now };
      } break;
    }
    case 'client.closed':
      for (const [key, turn] of Object.entries(s.items))
        if (turn.status === 'pending' || turn.status === 'streaming') s.items[key] = { ...turn, status: 'incomplete', updatedAt: now };
      break;
  }
  reorder(s); return s;
}
