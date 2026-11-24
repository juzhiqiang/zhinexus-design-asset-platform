import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BadgeReact } from '@fixture/project-badge/react';
createRoot(document.querySelector('#app')).render(createElement(BadgeReact));
const ready = new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
window.__COMPONENT_EXAMPLE__ = { ready, states: ['default'], async runState() { await ready; }, getChecks() { return [{ name: 'developer-react-render', status: document.querySelector('#app').textContent === 'React frozen badge' ? 'passed' : 'failed' }]; } };
