import { version } from '../package.json';
/** Shown in the sidebar footer as major.minor; bump `version` in package.json to change it. */
export const APP_VERSION = `v${version.split('.').slice(0, 2).join('.')}`;
