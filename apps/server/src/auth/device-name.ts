const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bFirefox\//, 'Firefox'],
  [/\bChrome\/|\bCriOS\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const PLATFORMS: [RegExp, string][] = [
  [/\bWindows NT\b/, 'Windows'],
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bLinux\b/, 'Linux'],
];

function firstMatch(candidates: [RegExp, string][], userAgent: string): string | null {
  for (const [pattern, label] of candidates) {
    if (pattern.test(userAgent)) return label;
  }
  return null;
}

export function deviceNameFromUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device';

  const browser = firstMatch(BROWSERS, userAgent);
  const platform = firstMatch(PLATFORMS, userAgent);

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  return 'Unknown device';
}
