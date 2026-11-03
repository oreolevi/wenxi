declare const __WENXI_DEMO__: boolean;
declare const __WENXI_CLOUD__: boolean;

/** Compile-time flag. A URL parameter cannot enable real services in a demo build. */
export const DEMO_MODE = typeof __WENXI_DEMO__ !== 'undefined' && __WENXI_DEMO__;
export const CLOUD_MODE = typeof __WENXI_CLOUD__ !== 'undefined' && __WENXI_CLOUD__;
