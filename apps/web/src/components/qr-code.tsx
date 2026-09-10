'use client';

import { useEffect, useState } from 'react';

export function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const [markup, setMarkup] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void import('qrcode')
      .then((module) =>
        module.default.toString(value, {
          type: 'svg',
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#14161f', light: '#e6e9f2' },
        }),
      )
      .then((svg) => {
        if (!cancelled) setMarkup(svg);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [value]);

  if (failed) return null;

  return (
    <div
      aria-label="Scan this code with your authenticator app"
      role="img"
      className="overflow-hidden rounded-lg bg-moon p-1 [&_svg]:block [&_svg]:h-full [&_svg]:w-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={markup ? { __html: markup } : undefined}
    />
  );
}
