import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ProportionApp } from './ProportionApp';
import '@company/charts-react/style.css';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app container');

createRoot(container).render(
  <StrictMode>
    <ProportionApp />
  </StrictMode>,
);
