import { AuthGate } from '@/components/auth-gate';
import { AuthorizeCli } from './authorize-cli';

export const metadata = { title: 'Authorize the CLI · Collaby' };

export default async function CliAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const { code } = await searchParams;

  return (
    <AuthGate>
      <AuthorizeCli initialCode={typeof code === 'string' ? code : null} />
    </AuthGate>
  );
}
