/**
 * Vite config for the best-effort React UI.
 *
 * IMPORTANT: this file and the React UI (src/ui) are NOT part of the core
 * type-check/test. React/Vite CANNOT be installed in the development sandbox
 * because the npm registry is blocked (INTEGRATIONS_ONLY / HTTP 403). Run
 * `npm install` in a NETWORKED environment to enable `vite dev` / `vite build`.
 * See README "User interface".
 *
 * `allowImportingTsExtensions` in the core means source imports use explicit
 * `.ts` extensions; esbuild (used by Vite) resolves these natively.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
