import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PieApp } from './PieApp';
import '@company/charts-react/style.css';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

createRoot(container).render(
  <StrictMode>
    <PieApp />
  </StrictMode>,
);
