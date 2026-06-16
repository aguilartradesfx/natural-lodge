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

  // OR por teléfono/email (email solo si viene).
  const orParts = [`telefono.eq.${phone}`];
  if (email) orParts.push(`email.eq.${email}`);

  const { data, error } = await supabase
    .from('reservas_orbe')
    .select('id_reserva_principal, nombre, apellido, check_in, check_out, tipo_habitacion, estado, nombre_hotel')
    .eq('estado', 'Commit')
    .gte('check_out', `${hoy}T00:00:00-06:00`)
    .or(orParts.join(','))
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
