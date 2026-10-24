import type { ProtocolEvent } from '../../shared/domain';
export const WS_URL = 'wss://api.boson.ai/v1/realtime?model=higgs-realtime';
export const inputAudioAppend = (audio: string): ProtocolEvent => ({ type: 'input_audio_buffer.append', audio });
export const truncateItem = (item_id: string, played: number): ProtocolEvent => ({
  type: 'conversation.item.truncate', item_id, content_index: 0, audio_end_ms: Math.max(0, Math.round(played)),
});
export function describeClose(code: number): string {
  if (code === 3000) return 'Boson authentication expired or failed. Connect again for a fresh credential.';
  if (code === 4429) return 'Boson refused this session. Check account credit and access.';
  if (code === 1013) return 'Boson is at capacity. Try connecting again shortly.';
  if (code === 1000) return 'Session ended. Connect to start a new conversation.';
  return `Connection closed (${code}). Check your network, then connect again.`;
}
