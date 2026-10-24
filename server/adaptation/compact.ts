import { z } from 'zod';
import { realismAppraisalSchema, responseBriefSchema, type RealismAppraisal } from '../../shared/characterState';
import type { AppraisalInput } from './providers';
/** Smaller wire format: the model never invents backend memory IDs/categories or policy action codes. */
export const compactAppraisalSchema = realismAppraisalSchema.omit({ schemaVersion: true, evidence: true, memoryOperations: true, brief: true }).extend({
  brief: responseBriefSchema.omit({ move: true }), memoryText: z.string().max(120),
});
export function expandCompactAppraisal(raw: unknown, input: AppraisalInput): RealismAppraisal {
  const value = compactAppraisalSchema.parse(raw);
  if (!input.turnId || !input.utterance.trim()) throw new Error('Identified user turn required.');
  const { memoryText, brief, ...assessment } = value;
  // This citation identifies the triggering finalized turn; it is not proof of the model's interpretation.
  const evidence = [{ turnId: input.turnId, quote: input.utterance.slice(0,160) }];
  const category = value.event === 'boundary_pressure' ? 'boundary_pressure' : value.event === 'boundary_setting' ? 'boundary' :
    value.event === 'apology' ? 'repair' : value.event === 'interest' ? 'preference' : ['claim','evidence','accountability'].includes(value.event) ? 'claim' : 'interaction';
  const memoryOperations: RealismAppraisal['memoryOperations'] = memoryText.trim() && value.event !== 'neutral' ?
    [{ action: 'add', category, text: memoryText, evidence, targetId: null }] : [];
  if (value.event === 'respectful_action') {
    const concern = input.previous.realism?.memory.find(n => n.category === 'boundary_pressure' && n.status === 'active' && n.progress >= 1);
    if (concern) memoryOperations.push({ action: 'resolve', category: concern.category, text: 'Proposed repair after repeated respectful continuation.', evidence, targetId: concern.id });
  }
  const move: RealismAppraisal['brief']['move'] = value.event === 'boundary_pressure' ? 'boundary' :
    value.event === 'claim' && input.character.id === 'morgan' ? 'probe' : ['interest','reciprocity','respectful_action'].includes(value.event) ? 'disclose' : 'acknowledge';
  return realismAppraisalSchema.parse({ ...assessment, schemaVersion: 2, evidence, brief: { ...brief, move }, memoryOperations });
}
