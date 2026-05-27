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
      <div className="relative z-[2] max-w-[1280px] mx-auto px-5 sm:px-9 pt-7 pb-20">
        <AppHeader
          email={user?.email || null}
          onSignOut={handleSignOut}
          onOpenAssistant={() => setAssistantOpen(true)}
          onOpenTester={() => setTesterOpen(true)}
        />

        {/* Hero */}
        <section className="mt-14 mb-8 px-1 fade-up fade-up-2">
          <h1 className="font-serif font-light text-[38px] sm:text-[46px] leading-[1.05] tracking-[-0.025em] text-[--color-cream]">
            Agentes{' '}
            <em
              className="not-italic font-normal italic"
              style={{
                background: 'linear-gradient(135deg, var(--color-light-glow), var(--color-mid))',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              del bot
            </em>
          </h1>
          <p className="mt-3.5 text-[15.5px] text-[--color-cream-mute] leading-[1.55] max-w-[560px]">
            Editá los prompts que definen la personalidad y el comportamiento de cada cerebro detrás del chatbot.
          </p>
        </section>

        {/* Status */}
        <div className="fade-up fade-up-3 mt-9">
          <BotToggle initialState={initialState} userEmail={user?.email || 'unknown'} />
        </div>

        {/* Agents */}
        <div className="fade-up fade-up-4 mt-6">
          <AgentWorkspace
            prompts={prompts}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            onSaved={handlePromptUpdated}
            userEmail={user?.email || 'unknown'}
          />
        </div>

        {/* Footnote */}
        <div className="fade-up fade-up-5 mt-7 text-center font-mono text-[11px] text-[--color-cream-faint] tracking-[0.1em]">
          Los cambios son efectivos en el próximo mensaje del bot · Sin reiniciar n8n
        </div>
      </div>

      {/* Asistente — modal */}
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
