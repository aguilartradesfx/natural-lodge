'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Power } from 'lucide-react';

type State = { id: number; is_enabled: boolean; updated_at: string; updated_by: string | null };

export function BotToggle({ initialState, userEmail }: { initialState: State | null; userEmail: string }) {
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
    <div className="backdrop-blur-xl bg-white/[0.02] border border-white/[0.06] rounded-2xl p-8 relative overflow-hidden">
      {/* glow ambient cuando está activo */}
      {enabled && (
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-[--color-cyan]/10 rounded-full blur-3xl pointer-events-none" />
      )}

      <div className="flex items-center justify-between relative">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Power
              size={18}
              className={enabled ? 'text-[--color-cyan]' : 'text-[--color-text-dim]'}
            />
            <span className="font-mono text-xs uppercase tracking-widest text-[--color-text-dim]">
              Estado global
            </span>
          </div>
          <h2 className="text-2xl font-medium">
            {enabled ? (
              <>Bot <span className="text-[--color-cyan]">activo</span></>
            ) : (
              <>Bot <span className="text-[--color-text-muted]">apagado</span></>
            )}
          </h2>
          <p className="text-sm text-[--color-text-muted] mt-1">
            {enabled
              ? 'Respondiendo a mensajes en WhatsApp.'
              : 'Los mensajes no reciben respuesta automática.'}
          </p>
          {updatedAt && (
            <p className="font-mono text-xs text-[--color-text-dim] mt-3">
              Última modificación: {new Date(updatedAt).toLocaleString('es-CR')}
            </p>
          )}
        </div>

        <button
          onClick={toggle}
          disabled={saving}
          className={`relative inline-flex h-9 w-16 items-center rounded-full transition border ${
            enabled
              ? 'bg-[--color-cyan]/20 border-[--color-cyan]/40 shadow-[0_0_20px_rgba(6,182,212,0.25)]'
              : 'bg-[--color-surface] border-[--color-border]'
          } disabled:opacity-50`}
        >
          <span
            className={`inline-block h-7 w-7 transform rounded-full transition ${
              enabled
                ? 'translate-x-8 bg-[--color-cyan-glow] shadow-[0_0_12px_var(--color-cyan-glow)]'
                : 'translate-x-1 bg-[--color-text-dim]'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
