'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type State = { id: number; is_enabled: boolean; updated_at: string; updated_by: string | null };

function formatDate(d: string) {
  return new Date(d).toLocaleString('es-CR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function BotToggle({
  initialState,
  userEmail,
}: {
  initialState: State | null;
  userEmail: string;
}) {
  const [enabled, setEnabled] = useState(initialState?.is_enabled ?? true);
  const [updatedAt, setUpdatedAt] = useState(initialState?.updated_at ?? null);
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  async function toggle() {
    setSaving(true);
    const next = !enabled;
    const { data, error } = await supabase
      .from('nlcn_bot_state')
      .update({ is_enabled: next, updated_by: userEmail })
      .eq('id', 1)
      .select()
      .single();
    if (!error && data) {
      setEnabled(data.is_enabled);
      setUpdatedAt(data.updated_at);
    }
    setSaving(false);
  }

  return (
    <div
      className="relative flex items-center justify-between gap-4 px-[26px] py-[22px] rounded-[22px] border border-[--color-glass-border] overflow-hidden"
      style={{
        background: 'var(--color-glass-1)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        boxShadow:
          '0 1px 0 var(--color-glass-highlight) inset, 0 30px 60px -30px rgba(0,0,0,0.5)',
      }}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-[30%] w-[40%] h-px opacity-60"
        style={{
          background:
            'linear-gradient(90deg, transparent, var(--color-accent-glow), transparent)',
        }}
      />

      <div className="flex items-center gap-[18px] min-w-0">
        {/* Pulse dot */}
        <div
          className="w-[38px] h-[38px] rounded-full grid place-items-center shrink-0"
          style={{ background: 'var(--color-accent-soft)' }}
        >
          <span
            className={`w-2.5 h-2.5 rounded-full ${enabled ? 'animate-pulse-dot' : ''}`}
            style={{
              background: enabled ? 'var(--color-accent)' : 'var(--color-cream-faint)',
              boxShadow: enabled
                ? '0 0 16px var(--color-accent-glow), 0 0 4px var(--color-accent)'
                : 'none',
            }}
          />
        </div>
        <div className="min-w-0">
          <div className="font-serif font-normal text-[19px] text-[--color-cream] leading-tight">
            {enabled ? 'Bot activo' : 'Bot apagado'}
          </div>
          <div className="text-[13px] text-[--color-cream-mute] mt-[3px]">
            {enabled
              ? 'Respondiendo a mensajes en WhatsApp'
              : 'No responde automáticamente'}
            {updatedAt && (
              <>
                <span className="opacity-40 mx-2">·</span>
                <span>actualizado {formatDate(updatedAt)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* iOS-style toggle */}
      <button
        onClick={toggle}
        disabled={saving}
        className="relative w-[52px] h-[30px] rounded-full cursor-pointer transition-all duration-300 shrink-0 disabled:opacity-60"
        style={
          enabled
            ? {
                background: 'var(--color-accent)',
                boxShadow:
                  '0 0 0 1px rgba(0,0,0,0.4), 0 0 22px -4px var(--color-accent-glow), 0 1px 0 rgba(255,255,255,0.2) inset',
              }
            : {
                background: 'rgba(255,255,255,0.10)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
              }
        }
        aria-pressed={enabled}
        title={enabled ? 'Apagar bot' : 'Encender bot'}
      >
        <span
          className="absolute top-[3px] w-6 h-6 rounded-full bg-white"
          style={{
            left: enabled ? '25px' : '3px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            transition: 'left 0.25s cubic-bezier(0.5, 1.5, 0.5, 1)',
          }}
        />
      </button>
    </div>
  );
}
