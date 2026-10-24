import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/App';
import { APP_VERSION } from '../src/version';
describe('integrated adaptive application controls', () => {
  it('defaults the page to automatic adaptive replies and keeps the typed experiment without a Static option', () => {
    const html = renderToStaticMarkup(<App/>);
    expect(html).toContain('Reply timing');
    expect(html).toMatch(/<option[^>]*value="adaptive"[^>]*selected/);
    expect(html).toContain('Automatic · voice and text');
    expect(html).toContain('Directed · typed experiment');
    expect(html).toContain('Behavior variation');
    expect(html).not.toContain('value="static"');
  });
  it('keeps Start over visible but disabled for an empty conversation and displays the upstream version', () => {
    const html = renderToStaticMarkup(<App/>);
    expect(html).toMatch(/<button[^>]*class="restart-button[^"]*"[^>]*disabled/);
    expect(html).toContain('↺ Start over');
    expect(html).toContain(APP_VERSION);expect(APP_VERSION).toBe('v2.1');
  });
});
