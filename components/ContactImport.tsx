'use client';
import { useState } from 'react';
import { Upload, CheckCircle2, AlertTriangle, Loader2, X } from 'lucide-react';
import type { RawProspect } from '@/lib/prospect-types';

type PreviewRow = {
  rowNumber: number; name: string; company: string; email: string; phone: string;
  tags: string[]; hasContactChannel: boolean; warnings: string[];
};
type Metrics = {
  total: number; withChannel: number; withoutChannel: number;
  withEmail: number; withPhone: number; invalidEmails: number;
};
type Preview = {
  ok: true; format: string; metrics: Metrics;
  summary: { text: string; alerts: string[] }; preview: PreviewRow[]; batchTag: string;
};
type FailedRow = {
  rowNumber: number; name: string; reason: string; hint: string;
  matchingField?: 'phone' | 'email'; raw: RawProspect;
};
type Report = {
  created: number; updated: number;
  failed: FailedRow[]; missingCustomFields: string[]; pipelineResolved: boolean;
};

type Phase = 'idle' | 'previewing' | 'preview' | 'importing' | 'done' | 'error';

export function ContactImport() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [batchTag, setBatchTag] = useState('');
  const [totals, setTotals] = useState({ created: 0, updated: 0 });
  const [failedRows, setFailedRows] = useState<FailedRow[]>([]);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState('');
  const [startSequence, setStartSequence] = useState(false);

  async function parseJson(res: Response) {
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    if (!res.ok) {
      throw new Error(
        (body.error as string) ||
          (res.status === 401 ? 'Tu sesión expiró. Iniciá sesión de nuevo.' : 'Error ' + res.status),
      );
    }
    return body;
  }

  async function postFile(f: File, dryRun: boolean) {
    const form = new FormData();
    form.set('file', f);
    if (!dryRun && startSequence) form.set('startSequence', '1');
    return parseJson(
      await fetch(`/api/contacts/import${dryRun ? '?dryRun=1' : ''}`, { method: 'POST', body: form }),
    );
  }

  async function onFile(f: File) {
    setFile(f);
    setError('');
    setPhase('previewing');
    try {
      setPreview((await postFile(f, true)) as unknown as Preview);
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
      const body = (await postFile(file, false)) as { report: Report; batchTag: string };
      setReport(body.report);
      setBatchTag(body.batchTag);
      setTotals({ created: body.report.created, updated: body.report.updated });
      setFailedRows(body.report.failed);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    }
  }

  function editRow(idx: number, patch: Partial<RawProspect>) {
    setFailedRows((rows) => rows.map((r, i) => (i === idx ? { ...r, raw: { ...r.raw, ...patch } } : r)));
  }

  async function retry() {
    if (!failedRows.length) return;
    setRetrying(true);
    setError('');
    try {
      const res = await fetch('/api/contacts/import/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchTag, rows: failedRows.map((f) => f.raw) }),
      });
      const body = (await parseJson(res)) as { report: Report };
      setTotals((t) => ({
        created: t.created + body.report.created,
        updated: t.updated + body.report.updated,
      }));
      setFailedRows(body.report.failed);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  function reset() {
    setPhase('idle');
    setFile(null);
    setPreview(null);
    setReport(null);
    setBatchTag('');
    setTotals({ created: 0, updated: 0 });
    setFailedRows([]);
    setError('');
    setStartSequence(false);
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
                        {r.hasContactChannel ? r.email || r.phone : <span className="text-amber-300">Pendiente</span>}
                      </td>
                      <td className="px-3 py-2 text-[--color-cream-mute]">{r.tags.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <label className="glass rounded-2xl p-4 flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={startSequence}
              onChange={(e) => setStartSequence(e.target.checked)}
              className="mt-0.5 accent-[--color-green-glow]"
            />
            <span className="text-[13px] leading-[1.5]">
              <span className="font-medium">Iniciar la secuencia de correos con este lote</span>
              <span className="block text-[12px] text-[--color-cream-mute] mt-1">
                Hasta {preview.metrics.withEmail} de {preview.metrics.total} contactos podrían
                recibir el primer mensaje. Los que no tienen correo quedan fuera, y los que ya
                existan en Bralto se descuentan al importar, así que el número final puede ser
                menor.
              </span>
            </span>
          </label>

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
          <div>Agregando a Bralto…</div>
        </div>
      )}

      {phase === 'done' && report && (
        <div className="flex flex-col gap-4">
          <div className="glass rounded-2xl p-5 flex items-start gap-3">
            <CheckCircle2 className="text-[--color-green-glow] mt-0.5" size={22} />
            <div>
              <div className="font-medium">
                {failedRows.length === 0 ? '¡Todo cargado!' : 'Importación completa'}
              </div>
              <div className="text-[13px] text-[--color-cream-mute] mt-1">
                {totals.created} creados · {totals.updated} ya existían y se actualizaron
                {failedRows.length > 0 && ` · ${failedRows.length} con error`}
              </div>
              {!report.pipelineResolved && (
                <div className="text-[12px] text-amber-300 mt-2">
                  No se encontró el pipeline en Bralto: no se crearon oportunidades.
                </div>
              )}
              {report.missingCustomFields.length > 0 && (
                <div className="text-[12px] text-amber-300 mt-1">
                  Campos no encontrados en Bralto (no se llenaron): {report.missingCustomFields.join(', ')}
                </div>
              )}
            </div>
          </div>

          {failedRows.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="font-medium text-[13px]">Filas con error — corrígelas y reintenta</div>
                <button
                  onClick={retry}
                  disabled={retrying}
                  className="px-4 py-2 rounded-full text-[13px] font-medium text-[--color-green-glow] glass-pill disabled:opacity-50"
                >
                  {retrying ? 'Reintentando…' : `Reintentar (${failedRows.length})`}
                </button>
              </div>

              {failedRows.map((f, idx) => (
                <div key={f.rowNumber} className="glass rounded-2xl p-4 flex flex-col gap-2.5">
                  <div className="font-medium">
                    {f.name || 'Sin nombre'}{' '}
                    <span className="text-[--color-cream-mute] font-normal">· fila {f.rowNumber}</span>
                  </div>
                  <div className="flex items-start gap-2 text-[12.5px] text-amber-300">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {f.hint}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2.5">
                    <label className="flex-1 text-[12px] text-[--color-cream-mute]">
                      Correo
                      <input
                        value={f.raw.email}
                        onChange={(e) => editRow(idx, { email: e.target.value })}
                        className="mt-1 w-full glass-pill rounded-lg px-3 py-1.5 text-[13px] text-[--color-cream] bg-transparent"
                        placeholder="correo@ejemplo.com"
                      />
                    </label>
                    <label className="flex-1 text-[12px] text-[--color-cream-mute]">
                      Teléfono
                      <input
                        value={f.raw.phone}
                        onChange={(e) => editRow(idx, { phone: e.target.value })}
                        className="mt-1 w-full glass-pill rounded-lg px-3 py-1.5 text-[13px] text-[--color-cream] bg-transparent"
                        placeholder="+506…"
                      />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => editRow(idx, { phone: '' })}
                      className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px]"
                    >
                      <X size={12} /> Mantener correo (quita el tel)
                    </button>
                    <button
                      onClick={() => editRow(idx, { email: '' })}
                      className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px]"
                    >
                      <X size={12} /> Mantener teléfono (quita el correo)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <div className="text-[12.5px] text-amber-300">{error}</div>}

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
