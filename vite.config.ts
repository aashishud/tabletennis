import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import discordTokenHandler from './api/auth/discord/token';
import signalHandler from './api/signal';

/**
 * Mounts the exact Vercel Serverless Functions (`/api/auth/discord/token` and `/api/signal`)
 * inside Vite's local dev/preview server, and copies standalone game folders (`images/`, `audio/`, `js/`)
 * into `dist/` during `vite build` for Vercel deployment.
 */
function vercelServerlessAndAssetsPlugin(env: Record<string, string>): Plugin {
  // Hydrate process.env for local dev serverless handlers
  for (const [key, val] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }

  function attachApiMiddlewares(middlewares: any) {
    middlewares.use('/api/auth/discord/token', (req: any, res: any) => {
      discordTokenHandler(req, res);
    });
    middlewares.use('/api/signal', (req: any, res: any) => {
      signalHandler(req, res);
    });
  }

  function copyDirSync(src: string, dest: string) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        copyDirSync(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  return {
    name: 'vercel-serverless-and-assets',
    configureServer(server) {
      attachApiMiddlewares(server.middlewares);
    },
    configurePreviewServer(server) {
      attachApiMiddlewares(server.middlewares);
    },
    closeBundle() {
      const rootDir = process.cwd();
      const outDir = path.resolve(rootDir, 'dist');
      for (const folder of ['images', 'audio', 'js']) {
        copyDirSync(path.resolve(rootDir, folder), path.resolve(outDir, folder));
      }
      if (fs.existsSync(path.resolve(rootDir, 'favicon.png'))) {
        fs.copyFileSync(path.resolve(rootDir, 'favicon.png'), path.resolve(outDir, 'favicon.png'));
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    publicDir: false,
    plugins: [react(), vercelServerlessAndAssetsPlugin(env)],
    server: {
      port: 5173,
      host: true,
    },
  };
});
