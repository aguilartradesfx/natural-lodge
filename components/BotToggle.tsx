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
    <div className="glass relative flex items-center justify-between gap-4 px-[26px] py-[22px] overflow-hidden">
      {/* Línea superior verde */}
      <div className="absolute top-0 left-[28%] right-[28%] h-px green-line opacity-60" />

      <div className="flex items-center gap-[18px] min-w-0">
        {/* Pulse dot verde */}
        <div
          className="w-[40px] h-[40px] rounded-full grid place-items-center shrink-0"
          style={{ background: 'var(--color-green-soft)' }}
        >
          <span
            className={`w-[11px] h-[11px] rounded-full ${enabled ? 'animate-pulse-dot' : ''}`}
            style={{
              background: enabled ? 'var(--color-green-glow)' : 'var(--color-cream-faint)',
              boxShadow: enabled
                ? '0 0 18px var(--color-green-ring), 0 0 6px var(--color-green-glow)'
                : 'none',
            }}
          />
        </div>
        <div className="min-w-0">
          <div className="text-[18px] font-medium text-[--color-cream] leading-tight tracking-tight">
            {enabled ? 'Bot activo' : 'Bot apagado'}
          </div>
          <div className="text-[13px] font-normal text-[--color-cream-mute] mt-[4px]">
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

      {/* iOS-style toggle — verde cuando está activo */}
      <button
        onClick={toggle}
        disabled={saving}
        className="relative w-[54px] h-[30px] rounded-full cursor-pointer transition-all duration-300 shrink-0 disabled:opacity-60"
        style={
          enabled
            ? {
                background:
                  'linear-gradient(180deg, var(--color-green-glow), var(--color-green))',
                boxShadow:
                  '0 0 0 1px rgba(0,0,0,0.4), 0 0 22px -4px var(--color-green-ring), 0 1px 0 rgba(255,255,255,0.3) inset',
              }
            : {
                background:
                  'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))',
                boxShadow:
                  '0 0 0 1px rgba(0,0,0,0.4), 0 1px 0 rgba(255,255,255,0.06) inset',
              }
        }
        aria-pressed={enabled}
        title={enabled ? 'Apagar bot' : 'Encender bot'}
      >
        <span
          className="absolute top-[3px] w-[24px] h-[24px] rounded-full bg-white"
          style={{
            left: enabled ? '27px' : '3px',
            boxShadow: '0 2px 6px rgba(0,0,0,0.35), 0 0 0 0.5px rgba(0,0,0,0.06)',
            transition: 'left 0.25s cubic-bezier(0.5, 1.5, 0.5, 1)',
          }}
        />
      </button>
    </div>
  );
}
