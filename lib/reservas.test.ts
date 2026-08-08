import { describe, it, expect } from 'vitest';
import { telefonoSufijo, construirFiltroHuesped } from './reservas';

describe('telefonoSufijo', () => {
  it('sobrevive a los formatos con los que llega el mismo número', () => {
    // Todos estos son el mismo teléfono escrito como lo manda el webhook,
    // como lo guardó Orbe y como lo escribiría una persona a mano.
    const formatos = [
      '+50688887777',
      '50688887777',
      '88887777',
      '+506 8888 7777',
      '8888-7777',
      '(506) 8888 7777',
    ];
    for (const f of formatos) {
      expect(telefonoSufijo(f)).toBe('88887777');
    }
  });

  it('funciona con números internacionales', () => {
    // +1 416 555 0142 → dígitos 14165550142 → últimos 8: 65550142
    expect(telefonoSufijo('+1 416 555 0142')).toBe('65550142');
    expect(telefonoSufijo('+14165550142')).toBe('65550142');
  });

  it('devuelve null si no hay suficientes dígitos', () => {
    expect(telefonoSufijo('1234567')).toBeNull();
    expect(telefonoSufijo('')).toBeNull();
    expect(telefonoSufijo('sin números')).toBeNull();
  });
});

describe('construirFiltroHuesped', () => {
  it('busca por sufijo de teléfono, no por igualdad exacta', () => {
    expect(construirFiltroHuesped('+50688887777', '')).toBe('telefono.like.*88887777');
  });

  it('combina teléfono y email', () => {
    expect(construirFiltroHuesped('+50688887777', 'ana@mail.com')).toBe(
      'telefono.like.*88887777,email.eq."ana@mail.com"',
    );
  });

  it('usa solo el email cuando el teléfono no sirve', () => {
    expect(construirFiltroHuesped('', 'ana@mail.com')).toBe('email.eq."ana@mail.com"');
  });

  it('devuelve null sin ningún dato con el que buscar', () => {
    // Sin filtro, la consulta traería la primera reserva activa cualquiera y
    // le daríamos a un desconocido los datos de otro huésped.
    expect(construirFiltroHuesped('', '')).toBeNull();
    expect(construirFiltroHuesped('123', '')).toBeNull();
  });
});
