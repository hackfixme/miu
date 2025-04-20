export { Store } from './store.js';
export { bind, getStore } from './bind.js';
import pkg from '../package.json' with { type: 'json' };
// GIT_VERSION will be set at build time.
export const VERSION = typeof GIT_VERSION !== 'undefined' ? GIT_VERSION : pkg.version;
