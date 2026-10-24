import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Ember (the static dating app) is served at `/`; the React lab and live date live under `/practice/`.
const datingRoot = join(import.meta.dirname, 'dating');
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function emberStatic(): Plugin {
  return {
    name: 'ember-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = (req.url ?? '/').split('?')[0];
        if (
          raw.startsWith('/practice') ||
          raw.startsWith('/api') ||
          raw.startsWith('/@') ||
          raw.startsWith('/src') ||
          raw.startsWith('/node_modules')
        ) return next();
        let decoded = raw;
        try { decoded = decodeURIComponent(raw); } catch { res.statusCode = 400; res.end(); return; }
        const parts = decoded.split('/');
        if (decoded.includes('\0') || parts.some((part) => part === '..' || part.startsWith('.') || part === 'boson_api_key')) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
        const filePath = normalize(join(datingRoot, rel));
        if (filePath !== datingRoot && !filePath.startsWith(datingRoot + sep)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        const ext = extname(filePath).toLowerCase();
        if (!existsSync(filePath) || !statSync(filePath).isFile() || !types[ext]) return next();
        res.setHeader('Content-Type', types[ext]);
        res.setHeader('Cache-Control', 'no-store');
        createReadStream(filePath).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: '/practice/',
  plugins: [react(), emberStatic()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: ['.trycloudflare.com'],
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
