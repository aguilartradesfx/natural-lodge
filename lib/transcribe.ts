import 'server-only';

/**
 * Transcribe audio con OpenAI Whisper. Descarga el archivo desde la URL
 * del adjunto de GHL y lo manda a /audio/transcriptions.
 *
 * Requiere OPENAI_API_KEY. Si no está configurada, lanza para que el
 * caller responda con el fallback "no puedo procesar audios todavía".
 */
export async function transcribeAudio(audioUrl: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('[transcribe] Falta OPENAI_API_KEY');

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`[transcribe] descarga falló: ${audioRes.status}`);
  const audioBlob = await audioRes.blob();

  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('language', 'es');
  // Nombre con extensión genérica para que la API lo acepte.
  form.append('file', audioBlob, 'audio.ogg');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[transcribe] whisper ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text || '').trim() || 'No se pudo transcribir el audio';
}
