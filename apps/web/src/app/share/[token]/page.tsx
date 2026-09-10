import type { Metadata } from 'next';
import { ShareRoute } from './client';
import { pageMetadata, readShareInfo } from '@/lib/server-metadata';

type RouteParams = { token: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { token } = await params;
  const info = await readShareInfo(token);

  if (!info) {
    return pageMetadata(null, 'This link is no longer available.');
  }

  if (info.requiresPassword) {
    return pageMetadata('Protected page', 'This page is locked. Ask the owner for the password.');
  }

  return pageMetadata(info.title, 'Shared with you on Collaby.');
}

export default async function SharePage({ params }: { params: Promise<RouteParams> }) {
  const { token } = await params;
  return <ShareRoute token={token} />;
}
