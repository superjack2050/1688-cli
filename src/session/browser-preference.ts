export const PREFERRED_BROWSER_CHANNEL = 'msedge' as const;
export const PREFERRED_BROWSER_LABEL = 'Microsoft Edge';

export function isPreferredBrowserUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Chromium\?|channel|Executable doesn't exist|msedge.*not found|edge.*not found/i.test(message);
}
