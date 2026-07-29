import { anthropic, ANTHROPIC_MODEL } from '@/lib/anthropic';
import type { BatchMetrics } from './prospect-validator';

export type ImportSummary = { text: string; alerts: string[] };

function fallbackText(m: BatchMetrics): string {
  return (
    `${m.total} contactos encontrados. ${m.withChannel} con correo o teléfono, ` +
    `${m.withoutChannel} sin datos de contacto (se marcarán como pendientes).`
  );
}

export async function summarizeBatch(input: {
  metrics: BatchMetrics;
  sampleWarnings: string[];
}): Promise<ImportSummary> {
  const { metrics, sampleWarnings } = input;

  const alerts: string[] = [];
  if (metrics.invalidEmails > 0) alerts.push(`${metrics.invalidEmails} correo(s) con formato inválido`);
  if (metrics.withoutChannel > 0) alerts.push(`${metrics.withoutChannel} sin correo ni teléfono`);

  try {
    const msg = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 400,
      system:
        'Sos un asistente que resume lotes de contactos para un equipo NO técnico de un lodge en Costa Rica. ' +
        'Devolvé 2-3 frases claras en español neutro, sin markdown, describiendo qué se va a importar y cualquier alerta. ' +
        'No inventes datos: usá solo las métricas dadas.',
      messages: [
        {
          role: 'user',
          content:
            `Métricas del lote:\n${JSON.stringify(metrics, null, 2)}\n\n` +
            `Alertas detectadas:\n${sampleWarnings.join('\n') || '(ninguna)'}`,
        },
      ],
    });

    const text = msg.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    return { text: text || fallbackText(metrics), alerts };
  } catch {
    return { text: fallbackText(metrics), alerts };
  }
}
