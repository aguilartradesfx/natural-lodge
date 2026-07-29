'use client';
import { useState } from 'react';
import { Upload, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

type PreviewRow = {
  rowNumber: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  tags: string[];
  hasContactChannel: boolean;
  warnings: string[];
};
type Metrics = {
  total: number; withChannel: number; withoutChannel: number;
  withEmail: number; withPhone: number; invalidEmails: number;
};
type Preview = {
  ok: true; format: string; metrics: Metrics;
  summary: { text: string; alerts: string[] }; preview: PreviewRow[];
};
type Report = {
  created: number; updated: number;
  failed: Array<{ rowNumber: number; name: string; reason: string }>;
  missingCustomFields: string[]; pipelineResolved: boolean;
};

type Phase = 'idle' | 'previewing' | 'preview' | 'importing' | 'done' | 'error';

export function ContactImport() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string>('');

  async function post(f: File, dryRun: boolean) {
    const form = new FormData();
    form.set('file', f);
    const res = await fetch(`/api/contacts/import${dryRun ? '?dryRun=1' : ''}`, {
      method: 'POST',
      body: form,
    });
    const text = await res.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!res.ok) {
      throw new Error(
        body.error || (res.status === 401 ? 'Tu sesión expiró. Iniciá sesión de nuevo.' : 'Error ' + res.status),
      );
    }
    return body;
  }

  async function onFile(f: File) {
    setFile(f);
    setError('');
    setPhase('previewing');
    try {
      setPreview(await post(f, true));
      setPhase('preview');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }

  async function confirm() {
    if (!file) return;
    setPhase('importing');
    setError('');
    try {
      const body = await post(file, false);
      setReport(body.report);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }

  function reset() {
    setPhase('idle');
    setFile(null);
    setPreview(null);
    setReport(null);
    setError('');
  }

  return (
    <div className="text-[--color-cream] text-[14px]">
      {(phase === 'idle' || phase === 'previewing') && (
        <label
          className="glass flex flex-col items-center justify-center gap-3 py-10 px-6 rounded-2xl cursor-pointer text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
        >
          {phase === 'previewing' ? (
            <Loader2 className="animate-spin" size={26} />
          ) : (
            <Upload size={26} className="opacity-80" />
          )}
          <div className="font-medium">
            {phase === 'previewing' ? 'Analizando el archivo…' : 'Arrastrá o elegí un archivo (CSV o Excel)'}
          </div>
          <div className="text-[12px] text-[--color-cream-mute]">
            Se leerá el archivo y verás un resumen antes de importar. Nada se crea todavía.
          </div>
          <input
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            disabled={phase === 'previewing'}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </label>
      )}

      {phase === 'preview' && preview && (
        <div className="flex flex-col gap-4">
          <div className="glass rounded-2xl p-4">
            <p className="leading-relaxed">{preview.summary.text}</p>
            {preview.summary.alerts.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1">
                {preview.summary.alerts.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 text-[13px] text-amber-300">
                    <AlertTriangle size={14} /> {a}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="glass rounded-2xl overflow-hidden">
            <div className="max-h-[42vh] overflow-auto">
              <table className="w-full text-[12.5px]">
                <thead className="text-[--color-cream-mute] text-left sticky top-0 bg-[rgba(20,32,26,0.9)]">
                  <tr>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Empresa</th>
                    <th className="px-3 py-2">Contacto</th>
                    <th className="px-3 py-2">Etiquetas</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-white/5">
                      <td className="px-3 py-2 whitespace-nowrap">{r.name || '—'}</td>
                      <td className="px-3 py-2">{r.company || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {r.hasContactChannel ? (
                          r.email || r.phone
                        ) : (
                          <span className="text-amber-300">Pendiente</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[--color-cream-mute]">{r.tags.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <button onClick={reset} className="glass-pill px-4 py-2 rounded-full text-[13px]">
              Cancelar
            </button>
            <button
              onClick={confirm}
              className="px-5 py-2 rounded-full text-[13px] font-medium text-[--color-green-glow] glass-pill"
            >
              Confirmar e importar {preview.metrics.total}
            </button>
          </div>
        </div>
      )}

      {phase === 'importing' && (
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 className="animate-spin" size={26} />
          <div>Importando a GoHighLevel…</div>
        </div>
      )}

      {phase === 'done' && report && (
        <div className="flex flex-col gap-3">
          <div className="glass rounded-2xl p-5 flex items-start gap-3">
            <CheckCircle2 className="text-[--color-green-glow] mt-0.5" size={22} />
            <div>
              <div className="font-medium">Importación completa</div>
              <div className="text-[13px] text-[--color-cream-mute] mt-1">
                {report.created} creados · {report.updated} ya existían y se actualizaron
                {report.failed.length > 0 && ` · ${report.failed.length} con error`}
              </div>
              {!report.pipelineResolved && (
                <div className="text-[12px] text-amber-300 mt-2">
                  No se encontró el pipeline en GHL: no se crearon oportunidades.
                </div>
              )}
              {report.missingCustomFields.length > 0 && (
                <div className="text-[12px] text-amber-300 mt-1">
                  Campos no encontrados en GHL (no se llenaron): {report.missingCustomFields.join(', ')}
                </div>
              )}
            </div>
          </div>
          {report.failed.length > 0 && (
            <div className="glass rounded-2xl p-4 text-[12.5px]">
              <div className="font-medium mb-2">Filas con error</div>
              <ul className="flex flex-col gap-1">
                {report.failed.map((f) => (
                  <li key={f.rowNumber} className="text-[--color-cream-mute]">
                    Fila {f.rowNumber} ({f.name}): {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end">
            <button onClick={reset} className="glass-pill px-4 py-2 rounded-full text-[13px]">
              Importar otro archivo
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-col gap-3">
          <div className="glass rounded-2xl p-5 flex items-start gap-3">
            <AlertTriangle className="text-amber-300 mt-0.5" size={22} />
            <div>
              <div className="font-medium">No se pudo procesar</div>
              <div className="text-[13px] text-[--color-cream-mute] mt-1">{error}</div>
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={reset} className="glass-pill px-4 py-2 rounded-full text-[13px]">
              Volver a intentar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
