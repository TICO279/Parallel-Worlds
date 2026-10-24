import type { RealismAppraisal } from '../../shared/characterState';
export function realismProposal(turnId: string, quote: string, overrides: Partial<RealismAppraisal> = {}): RealismAppraisal {
  return { schemaVersion: 2, interpretation: 'A limited conversational observation.',
    deltas: { comfort: 0, trust: 0, curiosity: 0, engagement: 0 }, tone: 'reserved', goal: 'Explore compatibility gradually.', guidance: 'Remain measured.',
    event: 'neutral', evidence: [{ turnId, quote }], uncertainty: { level: 'medium', reason: 'Only explicit conversation evidence is available.' },
    reaction: { positive: '', negative: '', unresolved: '' }, expectation: { prior: 'Respectful conversation.', update: 'No substantial change.', alternative: 'The statement may be ordinary small talk.' },
    motives: { approach: 'Explore connection.', protect: 'Maintain privacy.' }, brief: { intent: 'Continue naturally.', stance: 'Courteous and measured.', concern: '', expression: 'measured', move: 'acknowledge', scope: 'turn', avoid: 'Automatic praise.' },
    memoryOperations: [], ...overrides };
}
