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
    <header className="glass fade-up flex items-center justify-between gap-4 px-5 py-3.5 relative overflow-hidden">
      {/* Sutil línea verde superior */}
      <div className="absolute top-0 left-[20%] right-[20%] h-px green-line opacity-50" />

      {/* Brand */}
      <div className="flex items-center gap-3.5 min-w-0">
        <div
          className="w-[44px] h-[44px] rounded-[14px] grid place-items-center shrink-0 text-[15px] font-medium text-[--color-green-glow]"
          style={{
            background:
              'linear-gradient(135deg, rgba(127, 184, 138, 0.18), rgba(20, 32, 26, 0.6))',
            boxShadow:
              '0 1px 0 rgba(255,255,255,0.18) inset, 0 -1px 0 rgba(0,0,0,0.3) inset, 0 0 24px -8px var(--color-green-ring), 0 0 0 1px rgba(255,255,255,0.06)',
            letterSpacing: '0.5px',
          }}
        >
          NL
        </div>
        <div className="min-w-0 leading-[1.2]">
          <div className="text-[16px] font-medium text-[--color-cream] tracking-tight truncate">
            Natural Lodge
          </div>
          <div className="text-[10.5px] font-medium text-[--color-cream-mute] uppercase tracking-[0.16em] mt-[2px] truncate">
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
          <div
            className="hidden md:inline-flex items-center gap-2 pl-1.5 pr-4 py-[7px] rounded-full text-[--color-cream-dim] text-[12.5px] font-normal glass-pill"
          >
            <span
              className="w-[26px] h-[26px] rounded-full grid place-items-center text-[11px] font-semibold text-[--color-green-glow]"
              style={{
                background:
                  'linear-gradient(135deg, rgba(127, 184, 138, 0.22), rgba(40, 56, 46, 0.7))',
                boxShadow:
                  '0 1px 0 rgba(255,255,255,0.16) inset, 0 0 0 1px rgba(255,255,255,0.06)',
              }}
            >
              {initial}
            </span>
            <span className="truncate max-w-[180px]">{email}</span>
          </div>
        )}
        <button
          onClick={onSignOut}
          className="w-[38px] h-[38px] grid place-items-center rounded-[12px] text-[--color-cream-dim] hover:text-[--color-cream] transition glass-pill"
          title="Cerrar sesión"
        >
          <LogOut size={15} />
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
      className="glass-pill inline-flex items-center gap-2 px-4 py-[9px] rounded-full text-[--color-cream-dim] text-[12.5px] font-medium cursor-pointer transition-all duration-200 hover:text-[--color-cream] hover:-translate-y-[1px]"
    >
      <span className="opacity-85">{icon}</span>
      {children}
    </button>
  );
}
