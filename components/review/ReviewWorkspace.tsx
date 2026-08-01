'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Inbox, ListChecks, FileText } from 'lucide-react';
import type { ReviewRow, RuleRow, ReviewDetail } from '@/lib/reviews';
import type { PromptVersion } from '@/lib/prompt-versions';
import type { Prompt } from '@/components/AgentWorkspace';
import { ReviewInbox } from './ReviewInbox';
import { ReviewDetailPanel } from './ReviewDetail';
import { RulesQueue } from './RulesQueue';
import { PromptApply } from './PromptApply';

type Tab = 'bandeja' | 'reglas' | 'prompt';

export function ReviewWorkspace({
  userEmail,
  initialReviews,
  initialRules,
  prompts,
  initialVersions,
}: {
  userEmail: string | null;
  initialReviews: ReviewRow[];
  initialRules: RuleRow[];
  prompts: Prompt[];
  initialVersions: Record<string, PromptVersion[]>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('bandeja');
  const [detalle, setDetalle] = useState<ReviewDetail | null>(null);
  const [cargando, setCargando] = useState(false);
  const [refrescando, setRefrescando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const propuestas = initialRules.filter((r) => r.status === 'propuesta').length;
  const aprobadas = initialRules.filter((r) => r.status === 'aprobada').length;

  async function abrirConversacion(id: number) {
    setCargando(true);
    setAviso(null);
    try {
      const res = await fetch(`/api/reviews/${id}`);
      if (!res.ok) throw new Error('No se pudo cargar la conversación');
      setDetalle((await res.json()) as ReviewDetail);
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setCargando(false);
    }
  }

  async function actualizarBandeja() {
    setRefrescando(true);
    setAviso(null);
    try {
      const res = await fetch('/api/reviews/refresh', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo actualizar');
      setAviso(
        body.creados > 0
          ? `${body.creados} conversación${body.creados === 1 ? '' : 'es'} nueva${body.creados === 1 ? '' : 's'} en la bandeja.`
          : 'No hay conversaciones nuevas por revisar.',
      );
      router.refresh();
    } catch (err) {
      setAviso(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setRefrescando(false);
    }
  }

  return (
    <div className="relative z-[2] max-w-[1280px] mx-auto px-5 sm:px-9 pt-7 pb-20">
      <header className="glass fade-up flex items-center justify-between gap-4 px-5 py-3.5 relative overflow-hidden">
        <div className="absolute top-0 left-[20%] right-[20%] h-px green-line opacity-50" />
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="glass-pill inline-flex items-center gap-2 px-3.5 py-[7px] rounded-full text-[--color-cream-dim] text-[12.5px] hover:text-[--color-cream] transition"
          >
            <ArrowLeft size={14} />
            Panel
          </Link>
          <div className="min-w-0 leading-[1.2]">
            <div className="text-[16px] font-medium text-[--color-cream] tracking-tight">
              Revisión
            </div>
            <div className="text-[10.5px] font-medium text-[--color-cream-mute] uppercase tracking-[0.16em] mt-[2px]">
              Conversaciones y aprendizaje
            </div>
          </div>
        </div>
        {userEmail && (
          <span className="hidden md:inline text-[12.5px] text-[--color-cream-mute] truncate max-w-[220px]">
            {userEmail}
          </span>
        )}
      </header>

      <nav className="flex flex-wrap gap-2 mt-5 fade-up fade-up-1">
        <TabPill
          activa={tab === 'bandeja'}
          onClick={() => setTab('bandeja')}
          icon={<Inbox size={14} />}
        >
          Bandeja
        </TabPill>
        <TabPill
          activa={tab === 'reglas'}
          onClick={() => setTab('reglas')}
          icon={<ListChecks size={14} />}
          badge={propuestas}
        >
          Reglas por revisar
        </TabPill>
        <TabPill
          activa={tab === 'prompt'}
          onClick={() => setTab('prompt')}
          icon={<FileText size={14} />}
          badge={aprobadas}
        >
          Aplicar al prompt
        </TabPill>
      </nav>

      {aviso && (
        <p className="glass-inset mt-4 px-4 py-2.5 text-[12.5px] text-[--color-cream-dim]">
          {aviso}
        </p>
      )}

      <div className="mt-5">
        {tab === 'bandeja' &&
          (detalle ? (
            <ReviewDetailPanel
              detalle={detalle}
              onCerrar={() => setDetalle(null)}
              onGuardado={() => {
                setDetalle(null);
                router.refresh();
              }}
            />
          ) : (
            <ReviewInbox
              reviews={initialReviews}
              cargando={cargando}
              refrescando={refrescando}
              onAbrir={abrirConversacion}
              onActualizar={actualizarBandeja}
            />
          ))}

        {tab === 'reglas' && (
          <RulesQueue
            rules={initialRules.filter((r) => r.status === 'propuesta')}
            onCambio={() => router.refresh()}
          />
        )}

        {tab === 'prompt' && (
          <PromptApply
            prompts={prompts}
            rules={initialRules.filter((r) => r.status === 'aprobada')}
            versiones={initialVersions}
            onCambio={() => router.refresh()}
          />
        )}
      </div>
    </div>
  );
}

function TabPill({
  activa,
  onClick,
  icon,
  badge,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`glass-pill inline-flex items-center gap-2 px-4 py-[9px] rounded-full text-[12.5px] font-medium transition-all duration-200 ${
        activa ? 'text-[--color-green-glow]' : 'text-[--color-cream-dim] hover:text-[--color-cream]'
      }`}
      style={activa ? { boxShadow: '0 0 0 1px var(--color-green-ring)' } : undefined}
    >
      <span className="opacity-85">{icon}</span>
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="ml-1 px-1.5 py-px rounded-full text-[10.5px] text-[--color-green-glow] bg-[--color-green-soft]">
          {badge}
        </span>
      )}
    </button>
  );
}
