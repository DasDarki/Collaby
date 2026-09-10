import { cn } from '@/lib/cn';

export function Wordmark({ className, size = 20 }: { className?: string; size?: number }) {
  return (
    <span
      className={cn('font-display leading-none tracking-[-0.01em] text-moon', className)}
      style={{ fontSize: size, fontVariationSettings: "'SOFT' 40, 'WONK' 1" }}
    >
      Collaby
    </span>
  );
}
