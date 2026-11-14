import { inject } from 'vitest';
import { configurePlatformServices } from './support.js';

configurePlatformServices(inject('platformServices'));
