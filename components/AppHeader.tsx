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
  const initial = (email || '?').slice(0, 1).toUpperCase();

  return (
    <header
      className="fade-up flex items-center justify-between gap-4 px-5 py-3.5 rounded-[22px] border border-[--color-glass-border]"
      style={{
        background: 'var(--color-glass-1)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        boxShadow:
          '0 1px 0 var(--color-glass-highlight) inset, 0 0 0 1px rgba(0,0,0,0.4), 0 20px 60px -20px rgba(0,0,0,0.6)',
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3.5 min-w-0">
        <div
          className="w-[42px] h-[42px] rounded-xl grid place-items-center shrink-0 font-serif text-[15px] font-medium text-[--color-light-glow]"
          style={{
            background: 'linear-gradient(135deg, var(--color-ash-700), var(--color-ash-900))',
            border: '1px solid var(--color-glass-border-strong)',
            boxShadow:
              '0 1px 0 var(--color-glass-highlight) inset, 0 0 24px -4px var(--color-accent-glow)',
            letterSpacing: '0.5px',
          }}
        >
          NL
        </div>
        <div className="min-w-0 leading-[1.15]">
          <div className="font-serif font-normal text-[17px] text-[--color-cream] tracking-tight truncate">
            Natural Lodge
          </div>
          <div className="font-mono text-[10.5px] text-[--color-cream-mute] uppercase tracking-[0.12em] mt-0.5 truncate">
            Panel del Chatbot
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2.5">
        <HeaderPill onClick={onOpenAssistant} icon={<Sparkles size={14} />}>
          <span className="hidden sm:inline">Asistente IA</span>
        </HeaderPill>
        <HeaderPill onClick={onOpenTester} icon={<MessageSquare size={14} />}>
          <span className="hidden sm:inline">Probar chat</span>
        </HeaderPill>
        {email && (
          <button
            className="hidden md:inline-flex items-center gap-2 pl-1.5 pr-4 py-[7px] rounded-full border border-[--color-glass-border] text-[--color-cream-dim] text-[13px] font-medium transition"
            style={{ background: 'var(--color-glass-2)', backdropFilter: 'blur(20px)' }}
          >
            <span
              className="w-[26px] h-[26px] rounded-full grid place-items-center text-[11px] font-semibold text-[--color-light-glow] border border-[--color-glass-border-strong]"
              style={{
                background: 'linear-gradient(135deg, var(--color-ash-500), var(--color-ash-800))',
              }}
            >
              {initial}
            </span>
            <span className="truncate max-w-[180px]">{email}</span>
          </button>
        )}
        <button
          onClick={onSignOut}
          className="w-[38px] h-[38px] grid place-items-center rounded-xl border border-[--color-glass-border] text-[--color-cream-dim] hover:text-[--color-cream] transition"
          style={{ background: 'var(--color-glass-2)' }}
          title="Cerrar sesión"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}

function HeaderPill({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 px-4 py-[9px] rounded-full border border-[--color-glass-border] text-[--color-cream-dim] text-[13px] font-medium cursor-pointer transition-all duration-200 hover:text-[--color-cream] hover:border-[--color-glass-border-strong] hover:-translate-y-[1px]"
      style={{ background: 'var(--color-glass-2)', backdropFilter: 'blur(20px)' }}
    >
      <span className="opacity-85">{icon}</span>
      {children}
    </button>
  );
}
