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

function PanelHeader({
  title,
  subtitle,
  onClose,
}: {
  title?: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="relative flex items-start justify-between gap-4 px-6 py-5">
      {/* Línea verde fina al borde inferior del header */}
      <div className="absolute bottom-0 left-6 right-6 h-px green-line opacity-50" />
      <div>
        {title && (
          <h2 className="text-[19px] font-semibold text-[--color-cream] tracking-tight leading-tight">
            {title}
          </h2>
        )}
        {subtitle && (
          <p className="text-[12.5px] font-normal text-[--color-cream-mute] mt-1 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      <button
        onClick={onClose}
        className="p-2 rounded-xl text-[--color-cream-dim] hover:text-[--color-cream] transition shrink-0 glass-pill"
        aria-label="Cerrar"
      >
        <X size={16} />
      </button>
    </div>
  );
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
      <div className="glass-lifted relative w-full max-w-3xl max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden">
        {(title || subtitle) && (
          <PanelHeader title={title} subtitle={subtitle} onClose={onClose} />
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
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />
      <aside
        className={`glass-lifted fixed top-3 right-3 bottom-3 z-50 w-[calc(100%-1.5rem)] sm:w-[420px] flex flex-col overflow-hidden transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-[calc(100%+1rem)]'
        }`}
      >
        {(title || subtitle) && (
          <PanelHeader title={title} subtitle={subtitle} onClose={onClose} />
        )}
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </aside>
    </>
  );
}
