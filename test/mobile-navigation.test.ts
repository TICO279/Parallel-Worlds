import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readMobileRoute,routePath} from '../src/mobile/navigation';
import provenance from '../src/mobile/provenance.json';
import manifest from '../public/mobile/manifest.webmanifest?raw';

describe('mobile entry and recovery routes',()=>{
  it('uses one explicit Alex profile and opaque server conversation links',()=>{
    expect(readMobileRoute('/')).toEqual({screen:'discover'});
    expect(readMobileRoute('/profile/alex')).toEqual({screen:'profile'});
    expect(readMobileRoute('/profile/amara')).toEqual({screen:'missing'});
    const route={screen:'worlds' as const,conversationId:'conversation:one'};
    expect(readMobileRoute(routePath(route))).toEqual(route);
  });
  it.each(['/worlds/','/worlds/a/b','/worlds/%2fother','/worlds/%5cother','/worlds/%00','/worlds/%zz'])('does not turn malformed %s links into new conversations',path=>{
    expect(readMobileRoute(path)).toEqual({screen:'missing'});
  });
});
describe('preferred mobile asset preservation',()=>{
  it('records the exact inspected main2 source revision',()=>{
    expect(provenance.sourceCommit).toBe('3781fed7213e8042c77f90ee61e7f8ca95a55813');
  });
  it('provides home-screen icons without using Alex’s old portrait',()=>{
    const app=JSON.parse(manifest);expect(app.name).toBe('Parallel Worlds');expect(app.display).toBe('standalone');
    for(const icon of app.icons){const png=readFileSync(new URL(`../public${icon.src}`,import.meta.url));const size=Number(icon.sizes.split('x')[0]);expect(png.subarray(1,4).toString()).toBe('PNG');expect(png.readUInt32BE(16)).toBe(size);expect(png.readUInt32BE(20)).toBe(size);}
    const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');expect(html).toContain('/mobile/icons/apple-touch-icon.png');expect(html).not.toContain('/mobile/photos/alex.jpg');
  });
  for(const asset of provenance.photoAssets)it(`preserves ${asset.sourcePath} byte-for-byte`,()=>{
    const bytes=readFileSync(new URL(`../${asset.targetPath}`,import.meta.url));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
  });
});
