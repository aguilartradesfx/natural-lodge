import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import type { MockReservation } from '@/lib/prompt-context';

/** Fecha de hoy (YYYY-MM-DD) en timezone Costa Rica. */
export function todayCostaRica(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Los últimos 8 dígitos del teléfono — el número nacional de Costa Rica.
 *
 * El webhook manda el teléfono en un formato y Orbe lo guardó en otro:
 * con espacios, con guiones, con o sin `+506`. Comparar los strings enteros
 * fallaba, y un huésped alojado sin reserva encontrada cae en ventas y recibe
 * respuestas de prospecto. Los últimos 8 dígitos sobreviven a todos esos
 * formatos.
 */
export function telefonoSufijo(phone: string): string | null {
  const digitos = (phone || '').replace(/\D/g, '');
  return digitos.length >= 8 ? digitos.slice(-8) : null;
}

/**
 * Filtro OR de PostgREST para ubicar la reserva. Devuelve null si no hay
 * ningún dato con el que buscar — mejor no consultar que traer cualquier fila.
 */
export function construirFiltroHuesped(phone: string, email: string): string | null {
  const partes: string[] = [];
  const sufijo = telefonoSufijo(phone);
  if (sufijo) partes.push(`telefono.like.*${sufijo}`);
  // Las comillas evitan que un email raro rompa la sintaxis del filtro.
  if (email) partes.push(`email.eq."${email}"`);
  return partes.length > 0 ? partes.join(',') : null;
}

/**
 * Busca la reserva activa de un huésped por teléfono o email.
 * Port del nodo "Buscar Reserva": estado Commit y check_out >= hoy (CR),
 * la más próxima por check_in.
 */
export async function findActiveReservation(
  phone: string,
  email: string,
): Promise<MockReservation | null> {
  const supabase = createAdminClient();
  const hoy = todayCostaRica();

  const filtro = construirFiltroHuesped(phone, email);
  if (!filtro) return null;

  const { data, error } = await supabase
    .from('reservas_orbe')
    .select('id_reserva_principal, nombre, apellido, check_in, check_out, tipo_habitacion, estado, nombre_hotel')
    .eq('estado', 'Commit')
    .gte('check_out', `${hoy}T00:00:00-06:00`)
    .or(filtro)
    .order('check_in', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  return {
    guest_name: `${data.nombre ?? ''} ${data.apellido ?? ''}`.trim(),
    reservation_id: data.id_reserva_principal,
    check_in: String(data.check_in ?? ''),
    check_out: String(data.check_out ?? ''),
    room_type: data.tipo_habitacion ?? '',
    status: data.estado ?? '',
    hotel_name: data.nombre_hotel ?? '',
  };
}
