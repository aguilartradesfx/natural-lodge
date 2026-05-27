'use client';
import { useEffect } from 'react';
import { X } from 'lucide-react';

type CommonProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
};

function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);
}

function useLockScroll(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);
}

export function Modal({ open, onClose, title, subtitle, children }: CommonProps) {
  useEsc(open, onClose);
  useLockScroll(open);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-3xl max-h-[calc(100vh-4rem)] flex flex-col rounded-2xl bg-[--color-surface] border border-[--color-border] shadow-2xl overflow-hidden">
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-[--color-border]">
            <div>
              {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
              {subtitle && (
                <p className="text-xs text-[--color-text-muted] mt-0.5">{subtitle}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[--color-text-muted] hover:text-[--color-text] hover:bg-[--color-surface-elevated] transition"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, subtitle, children }: CommonProps) {
  useEsc(open, onClose);
  useLockScroll(open);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[420px] bg-[--color-surface] border-l border-[--color-border] shadow-2xl flex flex-col transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[--color-border]">
            <div>
              {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
              {subtitle && (
                <p className="text-xs text-[--color-text-muted] mt-0.5">{subtitle}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[--color-text-muted] hover:text-[--color-text] hover:bg-[--color-surface-elevated] transition"
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </aside>
    </>
  );
}
