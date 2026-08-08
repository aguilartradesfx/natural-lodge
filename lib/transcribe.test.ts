import { describe, it, expect } from 'vitest';
import { resolveTranscribeConfig } from './transcribe';

describe('resolveTranscribeConfig', () => {
  it('sin ninguna llave devuelve null en vez de reventar', () => {
    // El caller responde "no puedo procesar audios" y la conversación sigue.
    expect(resolveTranscribeConfig({})).toBeNull();
  });

  it('usa OpenAI por defecto', () => {
    const c = resolveTranscribeConfig({ OPENAI_API_KEY: 'sk-test' });
    expect(c).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      model: 'whisper-1',
      apiKey: 'sk-test',
    });
  });

  it('permite cambiar de proveedor solo con variables de entorno', () => {
    // Groq sirve el mismo formato /audio/transcriptions, más barato y rápido.
    const c = resolveTranscribeConfig({
      TRANSCRIBE_API_KEY: 'gsk-test',
      TRANSCRIBE_BASE_URL: 'https://api.groq.com/openai/v1',
      TRANSCRIBE_MODEL: 'whisper-large-v3-turbo',
    });
    expect(c).toEqual({
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'whisper-large-v3-turbo',
      apiKey: 'gsk-test',
    });
  });

  it('TRANSCRIBE_API_KEY le gana a OPENAI_API_KEY', () => {
    const c = resolveTranscribeConfig({
      OPENAI_API_KEY: 'sk-viejo',
      TRANSCRIBE_API_KEY: 'gsk-nuevo',
    });
    expect(c?.apiKey).toBe('gsk-nuevo');
  });

  it('tolera una base URL con barra final', () => {
    const c = resolveTranscribeConfig({
      TRANSCRIBE_API_KEY: 'k',
      TRANSCRIBE_BASE_URL: 'https://api.groq.com/openai/v1/',
    });
    expect(c?.baseUrl).toBe('https://api.groq.com/openai/v1');
  });
});
