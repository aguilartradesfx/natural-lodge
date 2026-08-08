import 'server-only';
import { anthropic, ANTHROPIC_MODEL, NO_THINKING } from '@/lib/anthropic';

/**
 * Describe una imagen en español usando Claude (visión nativa).
 * Reemplaza la llamada a gpt-4o-mini del flujo de n8n.
 */
export async function describeImage(imageUrl: string): Promise<string> {
  const res = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 250,
    // Sin esto el modelo gasta los 250 tokens pensando y la descripción sale vacía.
    thinking: NO_THINKING,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Describí en español qué muestra esta imagen, en máximo 2-3 oraciones, ' +
              'para un agente de soporte de hotel. Incluí cualquier texto visible ' +
              '(números, nombres, fechas) si aplica. Sé directo, sin frases tipo ' +
              '"esta imagen muestra".',
          },
          { type: 'image', source: { type: 'url', url: imageUrl } },
        ],
      },
    ],
  });

  const block = res.content.find((b) => b.type === 'text');
  const text = block && block.type === 'text' ? block.text.trim() : '';
  return text || 'No se pudo procesar la imagen';
}
