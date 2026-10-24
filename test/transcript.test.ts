import { describe, expect, it } from 'vitest';
import recorded from './fixtures/three-turn.json';
import { emptyConversation, orderedTurns, reduceTranscript } from '../shared/transcript';
import type { ProtocolEvent } from '../shared/domain';
const replay = (events: ProtocolEvent[]) => events.reduce((s, e, i) => reduceTranscript(s, e, i), emptyConversation());
const final = (id = 'a1', transcript = 'Hello.') => ({ type: 'response.output_audio_transcript.done', item_id: id, transcript });
describe('conversation reducer', () => {
  it('replays the official real session fixture into three ordered exchanges', () => {
    const turns = orderedTurns(replay(recorded));
    expect(turns.map(t => t.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    expect(turns.filter(t => t.role === 'user').map(t => t.text)).toEqual(['Hi. My name is Sam.', 'Recite the alphabet slowly, one letter at a time.', 'What is my name?']);
    expect(turns.every(t => t.transcriptFinal && t.status === 'complete')).toBe(true);
  });
  it('keeps a delayed user transcript ahead of its reply', () => {
    const turns = orderedTurns(replay([
      { type: 'input_audio_buffer.speech_started', item_id: 'u1' }, final(),
      { type: 'conversation.item.input_audio_transcription.completed', item_id: 'u1', transcript: 'Hi' },
    ]));
    expect(turns.map(t => t.itemId)).toEqual(['u1', 'a1']);
  });
  it('repairs missing predecessors when they arrive later, even for an existing item', () => {
    const turns = orderedTurns(replay([
      final(), { type: 'conversation.item.added', previous_item_id: 'u1', item: { id: 'a1', role: 'assistant' } },
      { type: 'input_audio_buffer.committed', item_id: 'u1', previous_item_id: null },
    ]));
    expect(turns.map(t => t.itemId)).toEqual(['u1', 'a1']);
    expect(turns.map(t => t.order)).toEqual([0, 1]);
  });
  it('deduplicates event IDs and ignores deltas after authoritative final text', () => {
    const delta = { type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 'Hell', event_id: 'e1' };
    const s = replay([delta, delta, final(), { ...delta, event_id: 'e2', delta: 'late' }]);
    expect(s.items.a1.text).toBe('Hello.'); expect(s.items.a1.status).toBe('complete');
  });
  it('can interrupt a finalized reply and keeps its generated transcript and playback duration', () => {
    const s = replay([final(), { type: 'client.interrupted', item_id: 'a1', played_ms: 315 }, final('a1', 'Hello again.')]);
    expect(s.items.a1).toMatchObject({ status: 'interrupted', playedMs: 315, text: 'Hello again.', transcriptFinal: true });
  });
  it('does not treat all speech starts as interruptions', () => {
    const s = replay([final(), { type: 'input_audio_buffer.speech_started', item_id: 'u2' }]);
    expect(s.items.a1.status).toBe('complete');
  });
  it('records failed transcription and unfinished turns without inventing finalized words', () => {
    const s = replay([{ type: 'conversation.item.input_audio_transcription.failed', item_id: 'u1' },
      { type: 'response.output_audio_transcript.delta', item_id: 'a1', delta: 'Partial' }, { type: 'client.closed' }]);
    expect(s.items.u1).toMatchObject({ transcriptionFailed: true, transcriptFinal: false, status: 'incomplete', text: null });
    expect(s.items.a1).toMatchObject({ status: 'incomplete', text: 'Partial', transcriptFinal: false });
  });
  it('is deterministic and never mutates prior state', () => {
    const s = replay([final()]); const before = structuredClone(s);
    reduceTranscript(s, { type: 'client.interrupted', item_id: 'a1', played_ms: 100 }, 99);
    expect(s).toEqual(before); expect(replay(recorded)).toEqual(replay(recorded));
  });
  it('drops a discarded reply and ignores its late events', () => {
    const state = replay([{ type: 'conversation.item.added', item: { id: 'u1', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] } },
      { type: 'response.output_item.added', item: { id: 'a1', type: 'message', role: 'assistant' } },
      { type: 'client.discarded', item_id: 'a1' }, final('a1', 'Unheard.'),
      { type: 'response.output_item.added', item: { id: 'a2', type: 'message', role: 'assistant' } }, final('a2', 'Heard.')]);
    expect(orderedTurns(state).map(t => [t.itemId, t.text, t.order])).toEqual([['u1', 'Hi', 0], ['a2', 'Heard.', 1]]);
  });
});
