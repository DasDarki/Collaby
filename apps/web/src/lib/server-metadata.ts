import type { Metadata } from 'next';

export interface ShareInfo {
  role: string;
  documentId: string | null;
  workspaceId: string | null;
  requiresPassword: boolean;
  title: string | null;
}

function serverApiUrl(): string {
  return process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
}

export function siteUrl(): string {
  return process.env.PUBLIC_WEB_URL || process.env.NEXT_PUBLIC_WEB_URL || '';
}

export async function readShareInfo(token: string): Promise<ShareInfo | null> {
  try {
    const response = await fetch(`${serverApiUrl()}/api/share/${encodeURIComponent(token)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) return null;
    return (await response.json()) as ShareInfo;
  } catch {
    return null;
  }
}

export function pageMetadata(title: string | null, description: string): Metadata {
  const heading = title ? `${title} · Collaby` : 'Collaby';
  const base = siteUrl();
  const image = base ? `${base}/logo-mark.png` : '/logo-mark.png';

  return {
    ...(base ? { metadataBase: new URL(base) } : {}),
    title: heading,
    description,
    openGraph: {
      title: heading,
      description,
      siteName: 'Collaby',
      type: 'article',
      images: [{ url: image, width: 512, height: 512, alt: 'Collaby' }],
    },
    twitter: {
      card: 'summary',
      title: heading,
      description,
      images: [image],
    },
  };
}
