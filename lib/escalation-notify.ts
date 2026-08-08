import 'server-only';
import { getContact, sendMessage } from '@/lib/ghl';
import { logWorkflowError } from '@/lib/error-log';

/**
 * Aviso al equipo cuando el bot escala una conversación.
 *
 * Por qué vive acá y no en GHL: el nodo "Internal notification" del workflow
 * se ejecuta —lo prueba el tag que aplica el nodo siguiente— pero no entrega
 * el WhatsApp, y ni la API ni las conversaciones muestran el intento. Un aviso
 * que falla en silencio es peor que no tenerlo: el huésped recibe "en breve te
 * contactamos" y nadie se entera.
 *
 * Se usa SMS a propósito. WhatsApp exige una plantilla aprobada para escribir
 * en frío (el equipo nunca le escribe al número del negocio, así que no hay
 * ventana de 24h abierta), y la API de GHL no expone las plantillas. SMS no
 * tiene ninguna de las dos restricciones.
 */

/** Contactos de GHL que reciben el aviso, en una variable de entorno. */
export function destinatarios(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return (env.ESCALATION_NOTIFY_CONTACT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Nombre del canal para leer, no para depurar. Internamente son `IG` y `FB`;
 * quien recibe el aviso en el teléfono necesita saber dónde ir a contestar.
 */
export function nombreCanal(canal?: string | null): string {
  const nombres: Record<string, string> = {
    IG: 'Instagram',
    FB: 'Facebook',
    Live_Chat: 'Chat en vivo',
    GMB: 'Google Business',
  };
  if (!canal) return 'canal no identificado';
  return nombres[canal] ?? canal;
}

/** Mismo contenido que la plantilla `notificacion_interna` de WhatsApp. */
export function construirAviso(input: {
  nombre?: string;
  telefono?: string;
  canal?: string | null;
}): string {
  const canal = nombreCanal(input.canal);
  return [
    `Un cliente necesita hablar con un humano en ${canal}.`,
    '',
    `Nombre: ${input.nombre?.trim() || 'sin nombre'}`,
    `Teléfono: ${input.telefono?.trim() || 'sin teléfono'}`,
    // Repetido como campo a propósito: en Instagram y Facebook no hay
    // teléfono, y el canal es el único dato que dice por dónde contestar.
    `Canal: ${canal}`,
  ].join('\n');
}

/**
 * Avisa al equipo. Devuelve cuántos destinatarios recibieron el SMS.
 *
 * Nunca lanza: un fallo acá no debe tumbar la respuesta al huésped, que ya
 * salió. Cada fallo queda registrado para poder auditarlo.
 */
export async function notificarEquipo(input: {
  workflow: string;
  contactId: string;
  canal: string | null;
}): Promise<number> {
  const ids = destinatarios();
  if (ids.length === 0) {
    await logWorkflowError({
      workflow: input.workflow,
      node: 'notificar_equipo',
      error: new Error('ESCALATION_NOTIFY_CONTACT_IDS sin configurar: nadie fue avisado'),
      context: { contactId: input.contactId },
    });
    return 0;
  }

  // Los datos del huésped salen de su ficha, que es la fuente de verdad.
  let nombre = '';
  let telefono = '';
  try {
    const contacto = await getContact(input.contactId);
    nombre = [contacto?.firstName, contacto?.lastName].filter(Boolean).join(' ');
    telefono = contacto?.phone || '';
  } catch (err) {
    // Sin nombre el aviso pierde detalle, pero avisar tarde y sin datos sigue
    // siendo mejor que no avisar.
    await logWorkflowError({
      workflow: input.workflow,
      node: 'notificar_equipo',
      error: err,
      context: { contactId: input.contactId },
    });
  }

  const mensaje = construirAviso({ nombre, telefono, canal: input.canal });

  let enviados = 0;
  for (const destinatario of ids) {
    try {
      await sendMessage({ type: 'SMS', contactId: destinatario, message: mensaje });
      enviados++;
    } catch (err) {
      await logWorkflowError({
        workflow: input.workflow,
        node: 'notificar_equipo',
        error: err,
        context: { destinatario, contactId: input.contactId },
      });
    }
  }
  return enviados;
}
