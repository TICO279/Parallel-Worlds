import { z } from 'zod';
import { toneSchema, responseBriefSchema } from './characterState';

export const deliveryInputSchema = z.object({ tone: toneSchema,
  expression: responseBriefSchema.shape.expression, move: responseBriefSchema.shape.move,
  uncertainty: z.enum(['low', 'medium', 'high']) });
export type DeliveryInput = z.infer<typeof deliveryInputSchema>;
export interface SpeechStyle { label: string; prefix: string; }
/** These are audition choices, not scientifically established emotion mappings. */
export function compileSpeechStyle(raw: unknown): SpeechStyle {
  const parsed = deliveryInputSchema.safeParse(raw);
  const neutral = { label: 'Neutral', prefix: '<|reset|>' };
  if (!parsed.success || parsed.data.uncertainty === 'high') return neutral;
  const d = parsed.data;
  if (d.expression === 'restrained' || d.tone === 'guarded' || d.move === 'boundary')
    return { label: 'Restrained', prefix: '<|reset|><|prosody:expressive_low|>' };
  if (d.tone === 'playful') return { label: 'Light amusement', prefix: '<|reset|><|emotion:amusement|>' };
  if (d.tone === 'warm') return { label: 'Calm warmth', prefix: '<|reset|><|emotion:contentment|>' };
  return neutral;
}
export interface SpeechSnapshot {
  id: string; style: SpeechStyle; source: string; turnNumber: number; fixtureTurn?: string;
  input?: DeliveryInput; stateVersion?: number; appraisalTurnId?: string; fallbackReason?: string;
}
