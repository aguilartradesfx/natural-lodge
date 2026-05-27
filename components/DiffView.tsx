'use client';
import { useMemo } from 'react';
import { diffLines } from 'diff';

export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffLines(before, after), [before, after]);

  return (
    <div className="glass-inset overflow-hidden">
      <div className="text-[11.5px] font-normal leading-relaxed max-h-96 overflow-y-auto py-1">
        {parts.map((part, i) => {
          const cls = part.added
            ? 'text-[--color-green-glow]'
            : part.removed
            ? 'text-red-300 line-through opacity-70'
            : 'text-[--color-cream-mute]';
          const bg = part.added
            ? 'rgba(127, 184, 138, 0.10)'
            : part.removed
            ? 'rgba(239, 68, 68, 0.10)'
            : 'transparent';
          const borderColor = part.added
            ? 'var(--color-green-ring)'
            : part.removed
            ? 'rgba(239, 68, 68, 0.40)'
            : 'transparent';
          const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
          return (
            <pre
              key={i}
              className={`whitespace-pre-wrap px-3 py-0.5 ${cls}`}
              style={{
                background: bg,
                boxShadow: `inset 2px 0 0 ${borderColor}`,
              }}
            >
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
