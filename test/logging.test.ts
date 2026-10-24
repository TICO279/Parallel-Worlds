import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../server/log';
import { requestJson } from '../server/adaptation/results';
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('merged appraisal diagnostics', () => {
  it('keeps normal tests silent and redacts configured secrets in enabled single-line logs', () => {
    const output = vi.spyOn(console,'log').mockImplementation(()=>{});
    vi.stubEnv('VITEST','true');log('appraisal','silent');expect(output).not.toHaveBeenCalled();
    vi.stubEnv('VITEST','');log('appraisal','model=fixture-key\ncontinued',['fixture-key']);
    expect(output).toHaveBeenCalledOnce();const message=output.mock.calls[0][0];
    expect(message).toContain('[redacted]');expect(message).not.toContain('fixture-key');expect(message).not.toMatch(/[\r\n]/);
  });
  it('records endpoint/status/timing while excluding keys, request dialogue and upstream error bodies', async () => {
    vi.stubEnv('VITEST','');const output=vi.spyOn(console,'log').mockImplementation(()=>{});
    const fetcher=vi.fn(async()=>new Response('fixture-key private dialogue',{status:401}));
    await expect(requestJson(fetcher,'https://api.deepseek.com/chat/completions','fixture-key',
      {model:'fixture-key',messages:[{content:'private dialogue'}]},new AbortController().signal)).rejects.toThrow('HTTP 401');
    const logs=JSON.stringify(output.mock.calls);expect(logs).toContain('HTTP 401');expect(logs).toContain('api.deepseek.com');
    expect(logs).not.toContain('fixture-key');expect(logs).not.toContain('private dialogue');
  });
  it('includes recognized network codes without logging arbitrary error values', async () => {
    vi.stubEnv('VITEST','');const output=vi.spyOn(console,'log').mockImplementation(()=>{});
    for(const code of ['ECONNREFUSED','fixture-key']) {
      const fetcher=vi.fn(async()=>{throw Object.assign(new Error('private dialogue fixture-key'),{cause:{code}});});
      await expect(requestJson(fetcher,'https://api.deepseek.com/chat/completions','fixture-key',{},new AbortController().signal)).rejects.toThrow('unavailable');
    }
    const logs=JSON.stringify(output.mock.calls);expect(logs).toContain('ECONNREFUSED');expect(logs).not.toContain('fixture-key');expect(logs).not.toContain('private dialogue');
  });
});
