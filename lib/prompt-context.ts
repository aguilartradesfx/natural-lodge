export type MockReservation = {
  guest_name: string;
  reservation_id: string;
  check_in: string;
  check_out: string;
  room_type: string;
  status: string;
  hotel_name: string;
};

export type GuestContextInput = {
  phone: string;
  reservation: MockReservation | null;
};

export function buildGuestContextBlock(input: GuestContextInput): string {
  const guestContext = input.reservation
    ? [
        'HUESPED CON RESERVA ACTIVA:',
        `- Nombre: ${input.reservation.guest_name}`,
        `- Reserva ID: ${input.reservation.reservation_id}`,
        `- Check-in: ${input.reservation.check_in}`,
        `- Check-out: ${input.reservation.check_out}`,
        `- Tipo de Habitación: ${input.reservation.room_type}`,
        `- Estado: ${input.reservation.status}`,
        `- Hotel: ${input.reservation.hotel_name}`,
      ].join('\n')
    : 'SIN RESERVA ACTIVA. El cliente es un prospecto nuevo.';

  return [
    '═══════════════════════════════════════',
    'CONTEXTO DEL HUÉSPED (auto-generado, no editable desde el panel):',
    '═══════════════════════════════════════',
    guestContext,
    '',
    `TELÉFONO: ${input.phone}`,
    '',
    '═══════════════════════════════════════',
    '',
  ].join('\n');
}

export function buildFullSystemPrompt(opts: {
  systemPrompt: string;
  guestContext: GuestContextInput;
}): string {
  return buildGuestContextBlock(opts.guestContext) + opts.systemPrompt;
}
