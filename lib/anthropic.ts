import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.warn('[anthropic] ANTHROPIC_API_KEY no está configurada. Los endpoints de IA fallarán.');
}

export const anthropic = new Anthropic({ apiKey: apiKey || 'missing' });

export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

/**
 * Modelos del ciclo de retroalimentación. Separados de ANTHROPIC_MODEL a
 * propósito: cambiar el modelo de los resúmenes no debe alterar las
 * respuestas que reciben los huéspedes.
 */

/** Resúmenes de conversación: alto volumen, extracción estructurada. */
export const ANTHROPIC_REVIEW_MODEL =
  process.env.ANTHROPIC_REVIEW_MODEL || 'claude-sonnet-5';

/** Reglas y consolidación al prompt: bajo volumen, criterio fino. */
export const ANTHROPIC_RULES_MODEL =
  process.env.ANTHROPIC_RULES_MODEL || 'claude-opus-5';
