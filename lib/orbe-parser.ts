/**
 * Parser y normalización del payload de Orbe (notificación de reserva de hotel).
 * Port fiel del nodo "Parsear Payload Orbe" de n8n (Flujo 1).
 *
 * Función pura y testeable: recibe el body crudo del webhook y devuelve
 * la reserva normalizada. Sin dependencias de red ni de n8n.
 */

export type ReservaNormalizada = {
  id_evento: string;
  timestamp_webhook: string;
  nombre: string;
  apellido: string;
  telefono: string;
  email: string;
  id_reserva_principal: string;
  id_reserva_secundario: string;
  estado: string;
  check_in: string | null;
  check_out: string | null;
  fecha_creacion_reserva: string;
  adultos: number;
  ninos: number;
  tipo_habitacion: string;
  cantidad_habitaciones: number;
  monto_total: number;
  moneda: string;
  monto_tarifa_base: number;
  nombre_hotel: string;
  id_hotel: string;
  tipo_canal_venta: string;
  agente_origen: string;
};

// Acceso seguro a propiedades anidadas sin reventar.
type AnyObj = Record<string, unknown>;
function obj(v: unknown): AnyObj {
  return v && typeof v === 'object' ? (v as AnyObj) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export function parseOrbePayload(rawInput: unknown): ReservaNormalizada {
  const input = obj(rawInput);
  // El webhook de n8n envolvía el payload en `body`; aceptamos ambos.
  const body = obj(input.body ?? input);
  const data = obj(body.data);

  const reservation = obj(arr(data.hotelReservations)[0]);
  const roomStay = obj(arr(obj(reservation.roomStays).roomStay)[0]);

  const resGuest = obj(arr(obj(reservation.resGuests).resGuest)[0]);
  const profileInfo = obj(arr(obj(resGuest.profiles).profileInfo)[0]);
  const guest = obj(obj(obj(profileInfo.profile).customer));

  // IDs de reserva
  const uniqueIds = arr(reservation.uniqueId);
  const idPrincipal = str(obj(uniqueIds[0]).id);
  const idSecundario = str(obj(uniqueIds[1]).id);

  // Conteos de huéspedes (buscar por código, no por índice)
  const guestCounts = arr(obj(roomStay.guestCounts).guestCount);
  const adultos =
    Number(obj(guestCounts.find((g) => str(obj(g).ageQualifyingCode) === '10')).count) || 0;
  const ninos =
    Number(obj(guestCounts.find((g) => str(obj(g).ageQualifyingCode) === '8')).count) || 0;

  // Habitación y tarifas
  const roomType = obj(arr(obj(roomStay.roomTypes).roomType)[0]);
  const total = obj(roomStay.total);
  const roomRate0 = obj(arr(obj(roomStay.roomRates).roomRate)[0]);
  const rate0 = obj(arr(obj(roomRate0.rates).rate)[0]);
  const baseRate = obj(rate0.base);

  // Origen y canal
  const posSource = obj(arr(obj(data.pos).source)[0]);
  const resPosSource = obj(arr(obj(reservation.pos).source)[0]);

  // Fechas: SIEMPRE en timezone Costa Rica (-06:00). Check-in 15:00, check-out 11:00.
  const checkInDate = str(obj(roomStay.timeSpan).start);
  const checkOutDate = str(obj(roomStay.timeSpan).end);
  const checkIn = checkInDate ? `${checkInDate}T15:00:00-06:00` : null;
  const checkOut = checkOutDate ? `${checkOutDate}T11:00:00-06:00` : null;

  const fechaCreacion =
    str(reservation.createDateTime) || str(body.timeStamp) || new Date().toISOString();

  const personName = obj(guest.personName);
  const telephone = obj(arr(guest.telephone)[0]);
  const emailEntry = obj(arr(guest.email)[0]);
  const bookingChannel = obj(resPosSource.bookingChannel);

  return {
    id_evento: str(body.eventId),
    timestamp_webhook: str(body.timeStamp) || new Date().toISOString(),
    nombre: str(personName.givenName),
    apellido: str(personName.surname),
    telefono: str(telephone.phoneNumber),
    email: str(emailEntry.emailAddress),
    id_reserva_principal: idPrincipal,
    id_reserva_secundario: idSecundario,
    estado: str(reservation.resStatus),
    check_in: checkIn,
    check_out: checkOut,
    fecha_creacion_reserva: fechaCreacion,
    adultos: Number(adultos),
    ninos: Number(ninos),
    tipo_habitacion: str(roomType.roomTypeCode),
    cantidad_habitaciones: Number(roomType.numberOfUnits ?? 1),
    monto_total: Number(total.amountAfterTax ?? 0),
    moneda: str(total.currencyCode) || 'USD',
    monto_tarifa_base: Number(baseRate.amountAfterTax ?? 0),
    nombre_hotel: str(posSource.property),
    id_hotel: str(posSource.propertySourceId),
    tipo_canal_venta: str(bookingChannel.type),
    agente_origen: str(posSource.agentSine),
  };
}
