import { createApp, nextTick } from 'vue';
import { BadgeVue } from '@fixture/project-badge/vue';
createApp(BadgeVue).mount('#app');
const ready = nextTick();
window.__COMPONENT_EXAMPLE__ = { ready, states: ['default'], async runState() { await ready; }, getChecks() { return [{ name: 'developer-vue-render', status: document.querySelector('#app').textContent === 'Vue frozen badge' ? 'passed' : 'failed' }]; } };
