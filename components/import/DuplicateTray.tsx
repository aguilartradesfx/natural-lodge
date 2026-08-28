'use client';
import { AlertTriangle, Trash2, ArrowRight } from 'lucide-react';
import type { RawProspect } from '@/lib/prospect-types';

export type DuplicateRow = {
  rowNumber: number; name: string; company: string;
  matchedBy: 'email' | 'phone' | 'fingerprint';
  existingId: string;
  incoming: Record<string, string>;
  existing: Record<string, string>;
  differingFields: string[];
  raw: RawProspect;
};

const ETIQUETA: Record<string, string> = {
  firstName: 'Nombre', lastName: 'Apellido', companyName: 'Empresa',
  email: 'Correo', phone: 'Teléfono',
};
const MOTIVO: Record<DuplicateRow['matchedBy'], string> = {
  email: 'Ya existe un contacto con ese correo.',
  phone: 'Ya existe un contacto con ese teléfono.',
  fingerprint: 'Ya existe un contacto con ese nombre y empresa.',
};

export function DuplicateTray({
  rows, busy, onEdit, onRetryFixed, onDiscard, onImportAnyway,
}: {
  rows: DuplicateRow[];
  busy: boolean;
  onEdit: (rowNumber: number, patch: { email?: string; phone?: string }) => void;
  onRetryFixed: (row: DuplicateRow) => void;
  onDiscard: (rowNumber: number) => void;
  onImportAnyway: (row: DuplicateRow) => void;
}) {
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="font-medium text-[13px]">
        {rows.length} {rows.length === 1 ? 'contacto ya existe' : 'contactos ya existen'} en Bralto
        — no se importaron ni recibieron correos
      </div>

      {rows.map((d) => (
        <div key={d.rowNumber} className="glass rounded-2xl p-4 flex flex-col gap-2.5">
          <div className="font-medium">
            {d.name || 'Sin nombre'}{' '}
            <span className="text-[--color-cream-mute] font-normal">
              · {d.company || 'sin empresa'} · fila {d.rowNumber}
            </span>
          </div>
          <div className="flex items-start gap-2 text-[12.5px] text-amber-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {MOTIVO[d.matchedBy]}
          </div>

          {d.differingFields.length > 0 ? (
            <div className="flex flex-col gap-1 text-[12.5px]">
              <div className="text-[--color-cream-mute]">Diferencias con lo que hay en Bralto:</div>
              {d.differingFields.map((f) => (
                <div key={f} className="flex flex-wrap items-center gap-2">
                  <span className="text-[--color-cream-mute] w-[70px]">{ETIQUETA[f] || f}</span>
                  <span className="line-through opacity-60">{d.existing[f] || '(vacío)'}</span>
                  <ArrowRight size={12} className="opacity-50" />
                  <span>{d.incoming[f] || '(vacío)'}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[12.5px] text-[--color-cream-mute]">
              Los datos del archivo coinciden con los de Bralto.
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <label className="flex-1 text-[12px] text-[--color-cream-mute]">
              Correo
              <input
                value={d.raw.email}
                onChange={(e) => onEdit(d.rowNumber, { email: e.target.value })}
                className="mt-1 w-full glass-pill rounded-lg px-3 py-1.5 text-[13px] text-[--color-cream] bg-transparent"
                placeholder="correo@ejemplo.com"
              />
            </label>
            <label className="flex-1 text-[12px] text-[--color-cream-mute]">
              Teléfono
              <input
                value={d.raw.phone}
                onChange={(e) => onEdit(d.rowNumber, { phone: e.target.value })}
                className="mt-1 w-full glass-pill rounded-lg px-3 py-1.5 text-[13px] text-[--color-cream] bg-transparent"
                placeholder="+506…"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onRetryFixed(d)}
              disabled={busy}
              className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] text-[--color-green-glow] disabled:opacity-50"
            >
              Corregir y reintentar
            </button>
            <button
              onClick={() => onImportAnyway(d)}
              disabled={busy}
              className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] disabled:opacity-50"
            >
              Importar de todos modos (sin correos)
            </button>
            <button
              onClick={() => onDiscard(d.rowNumber)}
              disabled={busy}
              className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] disabled:opacity-50"
            >
              <Trash2 size={12} /> Descartar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
