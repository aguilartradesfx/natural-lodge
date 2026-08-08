import 'server-only';

/**
 * Transcribe audio de las notas de voz de WhatsApp.
 *
 * Anthropic no transcribe voz: Claude acepta texto, imágenes y PDFs, no audio.
 * Hace falta un proveedor aparte, así que esto habla el formato de
 * `/audio/transcriptions` de OpenAI — que también implementan Groq y varios
 * más. Cambiar de proveedor es cuestión de variables de entorno, no de código.
 */

export type TranscribeConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

/**
 * Resuelve el proveedor desde el entorno. `OPENAI_API_KEY` se sigue aceptando
 * para no romper configuraciones existentes.
 *
 * Devuelve null si no hay llave: el caller responde que no puede procesar
 * audios en vez de reventar.
 */
export function resolveTranscribeConfig(
  env: Record<string, string | undefined> = process.env,
): TranscribeConfig | null {
  const apiKey = env.TRANSCRIBE_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: (env.TRANSCRIBE_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: env.TRANSCRIBE_MODEL || 'whisper-1',
    apiKey,
  };
}

export async function transcribeAudio(audioUrl: string): Promise<string> {
  const config = resolveTranscribeConfig();
  if (!config) {
    throw new Error(
      '[transcribe] Falta TRANSCRIBE_API_KEY (u OPENAI_API_KEY): no hay proveedor de transcripción configurado',
    );
  }

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`[transcribe] descarga falló: ${audioRes.status}`);
  const audioBlob = await audioRes.blob();

  const form = new FormData();
  form.append('model', config.model);
  // Sin `language`: antes estaba fijo en español y un huésped que manda una
  // nota de voz en inglés terminaba transcrito como español fonético. El
  // modelo detecta el idioma solo.
  form.append('file', audioBlob, 'audio.ogg');

  const res = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[transcribe] ${config.model} ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text || '').trim() || 'No se pudo transcribir el audio';
}
