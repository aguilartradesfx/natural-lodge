'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BotToggle } from './BotToggle';
import { AgentPromptCard } from './AgentPromptCard';
import { PromptAssistant } from './PromptAssistant';
import { AgentTester } from './AgentTester';
import { LogOut } from 'lucide-react';
import type { User } from '@supabase/supabase-js';

type State = { id: number; is_enabled: boolean; updated_at: string; updated_by: string | null };
type Prompt = {
  agent_key: string;
  display_name: string;
  description: string | null;
  system_prompt: string;
  updated_at: string;
  updated_by: string | null;
};

export function Dashboard({
  user,
  initialState,
  initialPrompts,
}: {
  user: User | null;
  initialState: State | null;
  initialPrompts: Prompt[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [prompts, setPrompts] = useState<Prompt[]>(initialPrompts);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  function handlePromptUpdated(agentKey: string, newPrompt: string) {
    setPrompts((arr) =>
      arr.map((p) =>
        p.agent_key === agentKey
          ? { ...p, system_prompt: newPrompt, updated_at: new Date().toISOString(), updated_by: user?.email || null }
          : p,
      ),
    );
  }

  return (
    <main className="relative z-10 min-h-screen px-6 py-12 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-14 gap-6">
        <div>
          <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full border border-[--color-border] bg-[--color-surface]/60 backdrop-blur">
            <div className="w-1.5 h-1.5 rounded-full bg-[--color-cyan] shadow-[0_0_10px_var(--color-cyan-glow)]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[--color-text-muted]">
              Natural Lodge · Caño Negro
            </span>
          </div>
          <h1 className="text-5xl font-semibold tracking-tight leading-[1.05]">
            Panel del{' '}
            <span className="bg-gradient-to-r from-[--color-cyan] to-[--color-cyan-glow] bg-clip-text text-transparent">
              chatbot
            </span>
          </h1>
          <p className="text-[--color-text-muted] mt-3 text-base max-w-xl">
            Editá prompts, generá fragmentos con IA y probá conversaciones en vivo.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg bg-[--color-surface]/60 border border-[--color-border]">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[--color-cyan] to-[--color-cyan-glow] flex items-center justify-center text-[--color-bg] text-xs font-semibold">
              {(user?.email || '?').slice(0, 1).toUpperCase()}
            </div>
            <span className="font-mono text-xs text-[--color-text-muted]">
              {user?.email}
            </span>
          </div>
          <button
            onClick={handleSignOut}
            className="p-2.5 rounded-lg bg-[--color-surface] border border-[--color-border] hover:border-[--color-border-hover] hover:bg-[--color-surface-elevated] transition"
            title="Cerrar sesión"
          >
            <LogOut size={16} className="text-[--color-text-muted]" />
          </button>
        </div>
      </div>

      {/* Layout 2 columnas: contenido principal + teléfono sticky */}
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Columna principal */}
        <div className="min-w-0 space-y-10">
          <BotToggle initialState={initialState} userEmail={user?.email || 'unknown'} />

          <div className="relative">
            <div className="h-px bg-[--color-border]" />
            <div className="absolute left-0 top-0 w-12 h-px bg-[--color-cyan] shadow-[0_0_6px_var(--color-cyan-glow)]" />
          </div>

          <PromptAssistant
            prompts={prompts}
            userEmail={user?.email || 'unknown'}
            onSaved={handlePromptUpdated}
          />

          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-semibold tracking-tight">Agentes</h2>
              <p className="font-mono text-xs text-[--color-text-dim] mt-1">
                Tres agentes activos. El workflow decide cuál usar según el contexto del huésped.
              </p>
            </div>
            <div className="space-y-6">
              {prompts.map((p) => (
                <AgentPromptCard
                  key={`${p.agent_key}-${p.updated_at}`}
                  prompt={p}
                  userEmail={user?.email || 'unknown'}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Columna derecha: teléfono sticky */}
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <AgentTester prompts={prompts} />
        </aside>
      </div>

      {/* Footer dim */}
      <div className="mt-20 text-center">
        <p className="font-mono text-xs text-[--color-text-dim]">
          Cambios efectivos en cada mensaje nuevo del bot. Sin necesidad de reiniciar n8n.
        </p>
      </div>
    </main>
  );
}
