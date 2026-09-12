/**
 * React entrypoint for the GERADOR DE CIRCUITOS PMR3407 UI.
 *
 * Best-effort: React/Vite are NOT installable in the sandbox (npm registry
 * blocked). Run `npm install` in a networked environment to enable the UI.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

const container = document.getElementById('root');
if (container === null) throw new Error('#root not found');
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
