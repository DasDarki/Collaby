'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { Spinner } from '@/components/ui';

export interface ConfirmInput {
  label: string;
  placeholder?: string;
  type?: 'text' | 'password';
  inputMode?: 'numeric' | 'text';
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  input,
  error,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  input?: ConfirmInput;
  error?: string | null;
  busy?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  useEffect(() => {
    if (open && !input) confirmRef.current?.focus();
  }, [open, input]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[90] flex items-start justify-center bg-night-900/75 px-5 pt-[18vh] backdrop-blur-sm"
      onClick={onCancel}
    >
      <form
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(value);
        }}
        className="w-full max-w-[400px] rounded-xl border border-night-600 bg-night-800 p-5 shadow-2xl shadow-black/60"
      >
        <h2 className="text-[14px] font-medium text-moon">{title}</h2>
        {body ? <div className="mt-1.5 text-[13px] leading-relaxed text-dusk">{body}</div> : null}

        {input ? (
          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-dusk">
              {input.label}
            </span>
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={input.placeholder}
              type={input.type ?? 'text'}
              inputMode={input.inputMode}
              autoFocus
            />
          </label>
        ) : null}

        {error ? <p className="mt-3 text-[12.5px] text-alarm">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            type="submit"
            size="sm"
            variant={danger ? 'danger' : 'primary'}
            disabled={busy || (Boolean(input) && value.trim().length === 0)}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
