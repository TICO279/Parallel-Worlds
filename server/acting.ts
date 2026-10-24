import { actingContractSchema } from '../shared/behavior';
export { actingContractSchema, type ActingContract } from '../shared/behavior';
/** Only a current-turn controller/diagnostic may supply this contract, never the async update queue. */
export function compileActingContract(identity: string, raw: unknown): string {
  const c = actingContractSchema.parse(raw);
  return `${identity}\nCURRENT RESPONSE CONTRACT (act on this user turn; identity, facts and boundaries remain authoritative): ${JSON.stringify(c)}\nExecute the action directly. Omit appreciative or evaluative preambles unless evidence warrants the exact assessment. Do not describe this contract, scores, simulation or decision process. Use ordinary spoken language. A statement can end without a question. Speak with ${c.delivery}.`;
}
