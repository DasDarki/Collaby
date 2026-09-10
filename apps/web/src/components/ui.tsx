'use client';

import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-lull-400 text-night-900 hover:bg-lull-300 disabled:bg-night-600 disabled:text-dusk font-medium',
  ghost: 'text-haze hover:text-moon hover:bg-night-700 disabled:text-dusk',
  outline: 'border border-night-600 text-moon hover:border-night-500 hover:bg-night-750',
  danger: 'border border-alarm/40 text-alarm hover:bg-alarm/10',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'ghost', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-70',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-9 w-full rounded-md border border-night-600 bg-night-850 px-3 text-[13px] text-moon',
          'placeholder:text-dusk transition-colors',
          'hover:border-night-500 focus:border-lull-400 focus:outline-none',
          className,
        )}
        {...props}
      />
    );
  },
);

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-dusk">{label}</span>
      {children}
      {error ? (
        <span className="text-[12px] text-alarm">{error}</span>
      ) : hint ? (
        <span className="text-[12px] text-dusk">{hint}</span>
      ) : null}
    </label>
  );
}

export function Avatar({
  name,
  color,
  url,
  size = 24,
  ring,
}: {
  name: string;
  color: string;
  url?: string | null;
  size?: number;
  ring?: boolean;
}) {
  const source = url ? api.resolveAssetUrl(url) : null;

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <span
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium',
        ring && 'ring-2 ring-night-900',
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: source ? undefined : color,
        color: '#14161f',
        fontSize: Math.max(9, Math.round(size * 0.4)),
      }}
    >
      {source ? (
        <img
          src={source}
          alt={name}
          width={size}
          height={size}
          className="h-full w-full object-cover"
        />
      ) : (
        initials
      )}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-night-500 border-t-lull-400',
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function Banner({
  tone = 'error',
  children,
}: {
  tone?: 'error' | 'info';
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        'rounded-md border px-3 py-2 text-[12.5px]',
        tone === 'error'
          ? 'border-alarm/35 bg-alarm/10 text-alarm'
          : 'border-night-600 bg-night-800 text-haze',
      )}
    >
      {children}
    </p>
  );
}
