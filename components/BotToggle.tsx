'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type State = { id: number; is_enabled: boolean; updated_at: string; updated_by: string | null };

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
    <div className="flex items-center justify-between gap-4 px-5 py-4 rounded-xl bg-[--color-surface]/60 border border-[--color-border]">
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative shrink-0">
          <div
            className={`w-2 h-2 rounded-full ${
              enabled
                ? 'bg-[--color-cyan] shadow-[0_0_10px_var(--color-cyan-glow)]'
                : 'bg-[--color-text-dim]'
            }`}
          />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {enabled ? 'Bot activo' : 'Bot apagado'}
          </div>
          <div className="text-xs text-[--color-text-muted] truncate">
            {enabled
              ? 'Respondiendo a mensajes en WhatsApp'
              : 'No responde automáticamente'}
            {updatedAt && ` · actualizado ${new Date(updatedAt).toLocaleString('es-CR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
          </div>
        </div>
      </div>

      <button
        onClick={toggle}
        disabled={saving}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition shrink-0 border ${
          enabled
            ? 'bg-[--color-cyan]/20 border-[--color-cyan]/40'
            : 'bg-[--color-surface-elevated] border-[--color-border]'
        } disabled:opacity-50`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full transition ${
            enabled
              ? 'translate-x-6 bg-[--color-cyan-glow]'
              : 'translate-x-1 bg-[--color-text-muted]'
          }`}
        />
      </button>
    </div>
  );
}
