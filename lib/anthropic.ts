import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.warn('[anthropic] ANTHROPIC_API_KEY no está configurada. Los endpoints de IA fallarán.');
}

export const anthropic = new Anthropic({ apiKey: apiKey || 'missing' });

export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
