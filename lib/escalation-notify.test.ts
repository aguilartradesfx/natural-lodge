import { describe, it, expect } from 'vitest';
import { destinatarios, construirAviso, nombreCanal } from './escalation-notify';

describe('destinatarios', () => {
  it('parsea la lista separada por comas', () => {
    expect(destinatarios({ ESCALATION_NOTIFY_CONTACT_IDS: 'abc,def,ghi' })).toEqual([
      'abc',
      'def',
      'ghi',
    ]);
  });

  it('tolera espacios y entradas vacías', () => {
    expect(destinatarios({ ESCALATION_NOTIFY_CONTACT_IDS: ' abc , , def ,' })).toEqual([
      'abc',
      'def',
    ]);
  });

  it('sin configurar devuelve lista vacía', () => {
    // El caller lo registra como error: escalar sin avisar a nadie es
    // exactamente el problema que esto viene a resolver.
    expect(destinatarios({})).toEqual([]);
  });
});

describe('nombreCanal', () => {
  it('traduce los códigos internos a algo legible', () => {
    // Quien recibe el SMS necesita saber dónde contestar, no nuestro código.
    expect(nombreCanal('IG')).toBe('Instagram');
    expect(nombreCanal('FB')).toBe('Facebook');
    expect(nombreCanal('Live_Chat')).toBe('Chat en vivo');
  });

  it('deja pasar los que ya se leen bien', () => {
    expect(nombreCanal('WhatsApp')).toBe('WhatsApp');
    expect(nombreCanal('SMS')).toBe('SMS');
  });

  it('cubre el canal desconocido', () => {
    expect(nombreCanal(null)).toBe('canal no identificado');
  });
});

describe('construirAviso', () => {
  it('incluye canal, nombre y teléfono', () => {
    const aviso = construirAviso({
      nombre: 'Alejandro Aguilar',
      telefono: '+14697634786',
      canal: 'SMS',
    });
    expect(aviso).toContain('en SMS');
    expect(aviso).toContain('Nombre: Alejandro Aguilar');
    expect(aviso).toContain('Teléfono: +14697634786');
    expect(aviso).toContain('Canal: SMS');
  });

  it('no deja huecos cuando faltan datos', () => {
    // Instagram y Facebook llegan sin teléfono. El aviso tiene que salir
    // igual: el canal es el único dato que dice por dónde contestar.
    const aviso = construirAviso({ canal: 'IG' });
    expect(aviso).toContain('en Instagram');
    expect(aviso).toContain('Nombre: sin nombre');
    expect(aviso).toContain('Teléfono: sin teléfono');
    expect(aviso).toContain('Canal: Instagram');
  });

  it('cubre el canal desconocido', () => {
    expect(construirAviso({ canal: null })).toContain('canal no identificado');
  });

  it('trata los espacios en blanco como ausencia', () => {
    expect(construirAviso({ nombre: '   ', canal: 'SMS' })).toContain('Nombre: sin nombre');
  });
});
