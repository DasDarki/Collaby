import type { Metadata } from 'next';
import { DocumentRoute } from './client';
import { pageMetadata, readShareInfo } from '@/lib/server-metadata';

type RouteParams = { documentId: string };
type RouteSearch = { share?: string | string[] };

function shareTokenOf(search: RouteSearch): string | null {
  const value = search.share;
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<RouteSearch>;
}): Promise<Metadata> {
  const [{ documentId }, search] = await Promise.all([params, searchParams]);
  const token = shareTokenOf(search);

  if (!token) {
    return pageMetadata(null, 'A collaborative markdown drive that keeps every version.');
  }

  const info = await readShareInfo(token);
  const visible = info && !info.requiresPassword && info.documentId === documentId;

  return pageMetadata(
    visible ? info.title : null,
    visible ? 'Shared with you on Collaby.' : 'A collaborative markdown drive.',
  );
}

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<RouteSearch>;
}) {
  const [{ documentId }, search] = await Promise.all([params, searchParams]);

  return <DocumentRoute documentId={documentId} shareToken={shareTokenOf(search)} />;
}
