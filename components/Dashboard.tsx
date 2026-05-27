'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AppHeader } from './AppHeader';
import { BotToggle } from './BotToggle';
import { AgentWorkspace, type Prompt } from './AgentWorkspace';
import { PromptAssistant } from './PromptAssistant';
import { AgentTester } from './AgentTester';
import { Modal, Drawer } from './ui/Overlay';
import type { User } from '@supabase/supabase-js';

type State = { id: number; is_enabled: boolean; updated_at: string; updated_by: string | null };

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
  const [selectedKey, setSelectedKey] = useState(initialPrompts[0]?.agent_key || 'soporte');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [testerOpen, setTesterOpen] = useState(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  function handlePromptUpdated(agentKey: string, newPrompt: string, updatedAt: string) {
    setPrompts((arr) =>
      arr.map((p) =>
        p.agent_key === agentKey
          ? {
              ...p,
              system_prompt: newPrompt,
              updated_at: updatedAt,
              updated_by: user?.email || null,
            }
          : p,
      ),
    );
  }

  return (
    <>
      <AppHeader
        email={user?.email || null}
        onSignOut={handleSignOut}
        onOpenAssistant={() => setAssistantOpen(true)}
        onOpenTester={() => setTesterOpen(true)}
      />

      <main className="relative z-10 max-w-6xl mx-auto px-6 py-8">
        {/* Hero compacto */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Agentes del bot</h1>
          <p className="text-sm text-[--color-text-muted] mt-1">
            Editá los prompts que definen la personalidad y el comportamiento de cada cerebro.
          </p>
        </div>

        {/* Bot status */}
        <div className="mb-6">
          <BotToggle initialState={initialState} userEmail={user?.email || 'unknown'} />
        </div>

        {/* Workspace de agentes */}
        <AgentWorkspace
          prompts={prompts}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          onSaved={handlePromptUpdated}
          userEmail={user?.email || 'unknown'}
        />

        <p className="mt-8 text-center font-mono text-[10px] text-[--color-text-dim]">
          Los cambios son efectivos en el próximo mensaje del bot. Sin reiniciar n8n.
        </p>
      </main>

      {/* Asistente — modal centrado */}
      <Modal
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        title="Asistente de prompts"
        subtitle="Describí lo que querés agregar, Claude lo redacta y lo inyecta en los agentes que elijas."
      >
        <PromptAssistant
          prompts={prompts}
          userEmail={user?.email || 'unknown'}
          initialTargets={[selectedKey]}
          onSaved={handlePromptUpdated}
        />
      </Modal>

      {/* Tester — drawer derecho */}
      <Drawer open={testerOpen} onClose={() => setTesterOpen(false)}>
        <AgentTester prompts={prompts} initialAgent={selectedKey} />
      </Drawer>
    </>
  );
}
