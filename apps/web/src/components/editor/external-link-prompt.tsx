'use client';

import { ExternalLink, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui';

export function ExternalLinkPrompt({
  href,
  onConfirm,
  onDismiss,
}: {
  href: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  if (!href) return null;

  let hostname = href;
  try {
    hostname = new URL(href).hostname;
  } catch {
    hostname = href;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="external-link-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-night-900/75 px-5 backdrop-blur-sm"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-[380px] rounded-xl border border-night-600 bg-night-800 p-5 shadow-2xl shadow-black/60"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2 text-lamp">
          <ShieldAlert size={16} />
          <h2 id="external-link-title" className="text-[13.5px] font-medium text-moon">
            Leaving Collaby
          </h2>
        </div>

        <p className="text-[13px] leading-relaxed text-haze">
          This link opens <span className="font-mono text-[12.5px] text-moon">{hostname}</span> in a
          new tab. Only continue if you trust it.
        </p>

        <p className="mt-2 break-all font-mono text-[11.5px] text-dusk">{href}</p>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Stay here
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm}>
            <ExternalLink size={13} />
            Open link
          </Button>
        </div>
      </div>
    </div>
  );
}
