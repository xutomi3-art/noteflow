/**
 * Platform detection for Capacitor native apps.
 *
 * Usage:
 *   import { isMobileApp, isIOS, isAndroid } from '@/utils/platform';
 *   if (isMobileApp) { /* hide Sources panel */ }
 */

let _isNative = false;
let _platform = 'web';

try {
  // Dynamic import to avoid bundling Capacitor in web builds
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Capacitor } = require('@capacitor/core');
  _isNative = Capacitor.isNativePlatform();
  _platform = Capacitor.getPlatform();
} catch {
  // Capacitor not available — running in browser
}

/** True when running inside iOS or Android native shell */
export const isMobileApp = _isNative;

/** True when running on iOS */
export const isIOS = _platform === 'ios';

/** True when running on Android */
export const isAndroid = _platform === 'android';

/** 'ios' | 'android' | 'web' */
export const platform = _platform;
