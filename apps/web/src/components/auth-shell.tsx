import type { ReactNode } from 'react';
import { Wordmark } from './wordmark';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-[360px]">
        <div className="mb-9 flex flex-col gap-3">
          <Wordmark size={26} />
          <div className="flex flex-col gap-1">
            <h1 className="text-[15px] font-medium text-moon">{title}</h1>
            <p className="text-[13px] text-dusk">{subtitle}</p>
          </div>
        </div>

        {children}

        {footer ? <div className="mt-7 text-[12.5px] text-dusk">{footer}</div> : null}
      </div>
    </main>
  );
}
