const STORAGE_KEY = 'collaby.returnTo';

export function safeReturnPath(value: string | null | undefined): string {
  if (!value) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}

export function currentReturnPath(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('next');
}

export function rememberReturnPath(value: string | null): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, safeReturnPath(value));
  } catch {
    return;
  }
}

export function takeReturnPath(): string {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    return safeReturnPath(stored);
  } catch {
    return '/';
  }
}
