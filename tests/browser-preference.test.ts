import { describe, expect, it } from 'vitest';
import {
  isPreferredBrowserUnavailable,
  PREFERRED_BROWSER_CHANNEL,
  PREFERRED_BROWSER_LABEL,
} from '../src/session/browser-preference.js';

describe('browser preference', () => {
  it('uses Microsoft Edge as the preferred Chromium channel', () => {
    expect(PREFERRED_BROWSER_CHANNEL).toBe('msedge');
    expect(PREFERRED_BROWSER_LABEL).toBe('Microsoft Edge');
  });

  it('falls back only for missing preferred-browser errors', () => {
    expect(isPreferredBrowserUnavailable(new Error('Executable doesn\'t exist at msedge'))).toBe(true);
    expect(isPreferredBrowserUnavailable(new Error('msedge not found'))).toBe(true);
    expect(isPreferredBrowserUnavailable(new Error('page crashed while loading'))).toBe(false);
  });
});
