'use client';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { BotToggle } from './BotToggle';
import { AgentPromptCard } from './AgentPromptCard';
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

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <main className="relative z-10 min-h-screen px-6 py-10 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-12">
        <div>
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full bg-[--color-amber] shadow-[0_0_8px_var(--color-amber-glow)]" />
            <span className="font-mono text-xs uppercase tracking-widest text-[--color-text-dim]">
              Natural Lodge Caño Negro
            </span>
          </div>
          <h1 className="text-4xl font-medium tracking-tight">Panel del chatbot</h1>
          <p className="text-[--color-text-muted] mt-2 text-sm">
            Editá los prompts y el estado global del bot de WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-[--color-text-dim] hidden sm:inline">
            {user?.email}
          </span>
          <button
            onClick={handleSignOut}
            className="p-2.5 rounded-lg bg-[--color-surface] border border-[--color-border] hover:border-[--color-border-hover] transition"
            title="Cerrar sesión"
          >
            <LogOut size={16} className="text-[--color-text-muted]" />
          </button>
        </div>
      </div>

      {/* Bot toggle */}
      <div className="mb-10">
        <BotToggle initialState={initialState} userEmail={user?.email || 'unknown'} />
      </div>

      {/* Divider con micro-detalle naranja */}
      <div className="relative mb-10">
        <div className="h-px bg-[--color-border]" />
        <div className="absolute left-0 top-0 w-12 h-px bg-[--color-amber] shadow-[0_0_4px_var(--color-amber-glow)]" />
      </div>

      {/* Section header */}
      <div className="mb-6">
        <h2 className="text-xl font-medium tracking-tight">Agentes</h2>
        <p className="font-mono text-xs text-[--color-text-dim] mt-1">
          Tres agentes activos. El workflow decide cuál usar según el contexto del huésped.
        </p>
      </div>

      {/* Prompts */}
      <div className="space-y-6">
        {initialPrompts.map((p) => (
          <AgentPromptCard key={p.agent_key} prompt={p} userEmail={user?.email || 'unknown'} />
        ))}
      </div>

      {/* Footer dim */}
      <div className="mt-16 text-center">
        <p className="font-mono text-xs text-[--color-text-dim]">
          Cambios efectivos en cada mensaje nuevo del bot. Sin necesidad de reiniciar n8n.
        </p>
      </div>
    </main>
  );
}
