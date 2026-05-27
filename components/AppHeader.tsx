'use client';
import { LogOut, Sparkles, MessageSquare } from 'lucide-react';

export function AppHeader({
  email,
  onSignOut,
  onOpenAssistant,
  onOpenTester,
}: {
  email: string | null;
  onSignOut: () => void;
  onOpenAssistant: () => void;
  onOpenTester: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-xl bg-[--color-bg]/80 border-b border-[--color-border]">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
        {/* Brand */}
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[--color-cyan] to-[--color-cyan-glow] flex items-center justify-center text-[--color-bg] text-xs font-bold shrink-0">
            NL
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight truncate leading-none">
              Natural Lodge
            </div>
            <div className="text-[10px] text-[--color-text-dim] uppercase tracking-[0.15em] mt-0.5 truncate">
              Panel del chatbot
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenAssistant}
            className="px-3 py-1.5 rounded-md text-xs font-medium border bg-[--color-surface] border-[--color-border] text-[--color-text-muted] hover:text-[--color-text] hover:border-[--color-border-hover] transition flex items-center gap-1.5"
          >
            <Sparkles size={12} />
            <span className="hidden sm:inline">Asistente IA</span>
          </button>
          <button
            onClick={onOpenTester}
            className="px-3 py-1.5 rounded-md text-xs font-medium border bg-[--color-cyan]/10 border-[--color-cyan]/30 text-[--color-cyan-glow] hover:bg-[--color-cyan]/20 transition flex items-center gap-1.5"
          >
            <MessageSquare size={12} />
            <span className="hidden sm:inline">Probar chat</span>
          </button>

          <div className="w-px h-6 bg-[--color-border] mx-1 hidden sm:block" />

          {email && (
            <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-md bg-[--color-surface] border border-[--color-border]">
              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[--color-cyan] to-[--color-cyan-glow] flex items-center justify-center text-[--color-bg] text-[10px] font-bold">
                {email.slice(0, 1).toUpperCase()}
              </div>
              <span className="text-[11px] text-[--color-text-muted] font-mono truncate max-w-[160px]">
                {email}
              </span>
            </div>
          )}
          <button
            onClick={onSignOut}
            className="p-2 rounded-md text-[--color-text-muted] hover:text-[--color-text] hover:bg-[--color-surface] transition"
            title="Cerrar sesión"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
