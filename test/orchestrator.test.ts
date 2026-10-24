import { describe, expect, it } from 'vitest';
import { buildContext, scenarios, validateScenario } from '../server/orchestrator';
import { buildHiggsConfig } from '../server/higgs';
describe('scenario orchestration', () => {
  it('has two valid, distinct scenarios', () => {
    scenarios.forEach(s => expect(() => validateScenario(s)).not.toThrow());
    expect(new Set(scenarios.map(s => s.id)).size).toBe(2);
    expect(() => validateScenario({ ...scenarios[0], setting: '' })).toThrow();
  });
  it('constructs Alex identity, values, motivation and setting from data', () => {
    const { instructions } = buildContext(scenarios[0]);
    for (const value of ['Alex', 'honesty', 'reserved', 'compatibility', 'café', 'disagree kindly']) expect(instructions).toContain(value);
    expect(instructions).not.toContain('Current response guidance');
    expect(buildContext(scenarios[1]).instructions).toContain('Morgan');
  });
  it('keeps identity immutable when adding mutable guidance', () => {
    const before = structuredClone(scenarios[0]);
    expect(buildContext(scenarios[0], { guidance: 'Respond more warmly.' }).instructions).toContain('Respond more warmly.');
    expect(scenarios[0]).toEqual(before);
    expect(buildContext(scenarios[0]).instructions).not.toContain('Respond more warmly.');
  });
  it('maps a provider-independent specification to tutorial-confirmed fields', () => {
    const config = buildHiggsConfig(buildContext(scenarios[0]));
    expect(config).toMatchObject({ type: 'session.update', session: {
      model: 'higgs-realtime', output_modalities: ['audio'], audio: {
        input: { format: { type: 'audio/pcm', rate: 24000 }, turn_detection: { type: 'server_vad' }, transcription: { model: 'higgs-stt-3.1', language: 'en' } },
        output: { voice: 'default', format: { type: 'audio/pcm', rate: 24000 } },
      },
    } });
    expect(config.session).not.toHaveProperty('tools');
  });
});
