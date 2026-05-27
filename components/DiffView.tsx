'use client';
import { useMemo } from 'react';
import { diffLines } from 'diff';

export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);

  return (
    <div className="rounded-xl border border-[--color-border] bg-[--color-bg] overflow-hidden">
      <div className="text-xs font-normal leading-relaxed max-h-96 overflow-y-auto">
        {parts.map((part, i) => {
          const cls = part.added
            ? 'bg-[--color-cyan]/10 text-[--color-cyan-glow] border-l-2 border-[--color-cyan]/50'
            : part.removed
            ? 'bg-red-500/10 text-red-300 border-l-2 border-red-500/40 line-through opacity-70'
            : 'text-[--color-text-muted] border-l-2 border-transparent';
          const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
          return (
            <pre key={i} className={`whitespace-pre-wrap px-3 py-0.5 ${cls}`}>
              {part.value
                .split('\n')
                .map((line, j, arr) =>
                  j === arr.length - 1 && line === '' ? null : (
                    <span key={j} className="block">
                      {prefix}
                      {line}
                    </span>
                  ),
                )}
            </pre>
          );
        })}
      </div>
    </div>
  );
}
