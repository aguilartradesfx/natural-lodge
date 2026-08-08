import { describe, it, expect } from 'vitest';
import { decideRoute, type EventAgentConfig } from './agent-router';

const EVENTO: EventAgentConfig = {
  agentKey: 'bigday',
  isEnabled: true,
  keywords: ['big day', 'avistamiento', 'ebird'],
};

describe('decideRoute — escalamiento', () => {
  it('escala cuando el huésped pide hablar con una persona', () => {
    expect(decideRoute({ message: 'quiero hablar con alguien', hasReservation: false })).toEqual({
      kind: 'escalation',
    });
  });

  it('el escalamiento gana incluso con reserva activa', () => {
    expect(decideRoute({ message: 'necesito un agente humano', hasReservation: true })).toEqual({
      kind: 'escalation',
    });
  });

  it('el escalamiento gana sobre las palabras del evento', () => {
    const r = decideRoute({
      message: 'quiero hablar con una persona sobre el big day',
      hasReservation: false,
      eventAgent: EVENTO,
    });
    expect(r).toEqual({ kind: 'escalation' });
  });
});

describe('decideRoute — soporte y ventas', () => {
  it('con reserva activa contesta soporte', () => {
    expect(decideRoute({ message: 'a qué hora es el check-in', hasReservation: true })).toEqual({
      kind: 'agent',
      agent: 'soporte',
    });
  });

  it('sin reserva contesta ventas', () => {
    expect(decideRoute({ message: 'cuánto cuesta la noche', hasReservation: false })).toEqual({
      kind: 'agent',
      agent: 'ventas',
    });
  });

  it('el evento tiene prioridad sobre la reserva', () => {
    // Un huésped alojado que pregunta por el evento quiere al agente del
    // evento. Antes la reserva ganaba siempre y lo atendía soporte.
    const r = decideRoute({
      message: 'cómo participo en el big day',
      hasReservation: true,
      eventAgent: EVENTO,
    });
    expect(r).toEqual({ kind: 'agent', agent: 'bigday' });
  });

  it('con reserva y sin palabras del evento sigue siendo soporte', () => {
    const r = decideRoute({
      message: 'a qué hora puedo hacer el check-out',
      hasReservation: true,
      eventAgent: EVENTO,
    });
    expect(r).toEqual({ kind: 'agent', agent: 'soporte' });
  });

  it('el evento apagado no le roba la conversación a soporte', () => {
    const r = decideRoute({
      message: 'cómo participo en el big day',
      hasReservation: true,
      eventAgent: { ...EVENTO, isEnabled: false },
    });
    expect(r).toEqual({ kind: 'agent', agent: 'soporte' });
  });
});

describe('decideRoute — agente de evento configurable', () => {
  it('activa el evento cuando el mensaje trae una de sus palabras', () => {
    const r = decideRoute({
      message: 'quiero participar en el Big Day',
      hasReservation: false,
      eventAgent: EVENTO,
    });
    expect(r).toEqual({ kind: 'agent', agent: 'bigday' });
  });

  it('NO activa el evento si está apagado desde el panel', () => {
    const r = decideRoute({
      message: 'quiero participar en el big day',
      hasReservation: false,
      eventAgent: { ...EVENTO, isEnabled: false },
    });
    expect(r).toEqual({ kind: 'agent', agent: 'ventas' });
  });

  it('sin configuración de evento cae en ventas', () => {
    const r = decideRoute({ message: 'quiero participar en el big day', hasReservation: false });
    expect(r).toEqual({ kind: 'agent', agent: 'ventas' });
  });

  it('con la lista de palabras vacía nunca se activa', () => {
    const r = decideRoute({
      message: 'big day avistamiento ebird',
      hasReservation: false,
      eventAgent: { ...EVENTO, keywords: [] },
    });
    expect(r).toEqual({ kind: 'agent', agent: 'ventas' });
  });

  it('responde a palabras nuevas cargadas desde el panel', () => {
    // Se renombró el evento: las palabras viejas ya no aplican, las nuevas sí.
    const otroEvento: EventAgentConfig = {
      agentKey: 'bigday',
      isEnabled: true,
      keywords: ['festival de aves', 'festival'],
    };
    expect(
      decideRoute({ message: 'info del Festival de Aves', hasReservation: false, eventAgent: otroEvento }),
    ).toEqual({ kind: 'agent', agent: 'bigday' });
    expect(
      decideRoute({ message: 'info del big day', hasReservation: false, eventAgent: otroEvento }),
    ).toEqual({ kind: 'agent', agent: 'ventas' });
  });

  it('ignora palabras vacías o con solo espacios', () => {
    const r = decideRoute({
      message: 'hola qué tal',
      hasReservation: false,
      eventAgent: { ...EVENTO, keywords: ['', '   '] },
    });
    expect(r).toEqual({ kind: 'agent', agent: 'ventas' });
  });

  it('no distingue mayúsculas ni en el mensaje ni en las palabras', () => {
    const r = decideRoute({
      message: 'CÓMO FUNCIONA EL AVISTAMIENTO',
      hasReservation: false,
      eventAgent: { ...EVENTO, keywords: ['AVISTAMIENTO'] },
    });
    expect(r).toEqual({ kind: 'agent', agent: 'bigday' });
  });
});
