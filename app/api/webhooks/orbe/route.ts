import { createAdminClient } from '@/lib/supabase/admin';
import { parseOrbePayload } from '@/lib/orbe-parser';
import {
  upsertContact,
  addContactTags,
  createAppointment,
  deleteAppointment,
  fireInboundWebhook,
  GHL_INBOUND_HOOKS,
} from '@/lib/ghl';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKFLOW = 'flujo_1_orbe';

// Guarda el id de la cita en la reserva, chequeando el error (Supabase
// NO lanza solo) y evitando el no-op silencioso de un id undefined.
async function saveAppointmentId(
  supabase: ReturnType<typeof createAdminClient>,
  idReserva: string,
  appointmentId: string | undefined,
) {
  if (!appointmentId) {
    throw new Error(`createAppointment no devolvió id para ${idReserva}`);
  }
  const { error } = await supabase
    .from('reservas_orbe')
    .update({ ghl_appointment_id: appointmentId })
    .eq('id_reserva_principal', idReserva);
  if (error) throw error;
}

// Columnas que se escriben tanto en el historial como en la reserva.
function reservaColumns(r: ReturnType<typeof parseOrbePayload>) {
  return {
    id_evento: r.id_evento,
    id_reserva_principal: r.id_reserva_principal,
    id_reserva_secundario: r.id_reserva_secundario,
    estado: r.estado,
    nombre: r.nombre,
    apellido: r.apellido,
    telefono: r.telefono,
    email: r.email,
    check_in: r.check_in,
    check_out: r.check_out,
    fecha_creacion_reserva: r.fecha_creacion_reserva,
    adultos: r.adultos,
    ninos: r.ninos,
    tipo_habitacion: r.tipo_habitacion,
    cantidad_habitaciones: r.cantidad_habitaciones,
    monto_total: r.monto_total,
    moneda: r.moneda,
    monto_tarifa_base: r.monto_tarifa_base,
    nombre_hotel: r.nombre_hotel,
    id_hotel: r.id_hotel,
    tipo_canal_venta: r.tipo_canal_venta,
    agente_origen: r.agente_origen,
    timestamp_webhook: r.timestamp_webhook,
  };
}

export async function POST(req: Request) {
  // ── Seguridad opcional: secreto compartido (reemplaza el path-UUID de n8n) ──
  const secret = process.env.ORBE_WEBHOOK_SECRET;
  if (secret) {
    const provided =
      req.headers.get('x-orbe-secret') ||
      new URL(req.url).searchParams.get('secret') ||
      '';
    if (provided !== secret) {
      return Response.json({ error: 'No autorizado' }, { status: 401 });
    }
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const supabase = createAdminClient();

  let r: ReturnType<typeof parseOrbePayload>;
  try {
    r = parseOrbePayload(rawBody);
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, node: 'parse', error: err });
    return Response.json({ error: 'No se pudo parsear el payload' }, { status: 400 });
  }

  if (!r.id_reserva_principal) {
    return Response.json(
      { error: 'Payload sin id_reserva_principal' },
      { status: 422 },
    );
  }

  try {
    // 1) Dedup por id_evento ────────────────────────────────────────
    if (r.id_evento) {
      const { data: dup } = await supabase
        .from('logs_webhook_orbe')
        .select('id')
        .eq('id_evento', r.id_evento)
        .limit(1)
        .maybeSingle();
      if (dup) {
        return Response.json({ ok: true, duplicado: true, id_evento: r.id_evento });
      }
    }

    // 2) Historial inmutable ────────────────────────────────────────
    await supabase.from('logs_webhook_orbe').insert(reservaColumns(r));

    // 3) Upsert de la reserva (NO toca ghl_appointment_id) ──────────
    const { data: reserva, error: upsertErr } = await supabase
      .from('reservas_orbe')
      .upsert(reservaColumns(r), { onConflict: 'id_reserva_principal' })
      .select('id_reserva_principal, estado, ghl_appointment_id')
      .single();
    if (upsertErr) throw upsertErr;

    const priorAppointmentId: string | null = reserva?.ghl_appointment_id ?? null;
    const estado = reserva?.estado ?? r.estado;

    // 4) Upsert de contacto en GHL (devuelve id directo, sin wait) ──
    const contact = await upsertContact({
      firstName: r.nombre,
      lastName: r.apellido,
      email: r.email,
      phone: r.telefono,
    });

    // 4b) Disparar inbound webhook de GHL para que corran las
    //     automatizaciones del equipo (como hacía n8n). No bloquea.
    await fireInboundWebhook(GHL_INBOUND_HOOKS.contactoReserva, {
      first_name: r.nombre,
      last_name: r.apellido,
      email: r.email,
      phone: r.telefono,
      estado: r.estado,
      id_reserva: r.id_reserva_principal,
      check_in: r.check_in,
      check_out: r.check_out,
      tipo_habitacion: r.tipo_habitacion,
      adultos: r.adultos,
      ninos: r.ninos,
      monto_total: r.monto_total,
      moneda: r.moneda,
    });

    // 5) Decisor: Cancelar / Crear / Actualizar / Sin acción ────────
    const title = `Reserva ${r.id_reserva_principal} - ${r.nombre} ${r.apellido}`.trim();
    let accion: 'cancelar' | 'crear' | 'actualizar' | 'sin_accion';

    if (estado === 'Cancel' && priorAppointmentId) {
      accion = 'cancelar';
      await deleteAppointment(priorAppointmentId);
      await supabase
        .from('reservas_orbe')
        .update({ ghl_appointment_id: null })
        .eq('id_reserva_principal', r.id_reserva_principal);
      await addContactTags(contact.id, ['Cancelado ❌']);
      await fireInboundWebhook(GHL_INBOUND_HOOKS.marcarCancelado, {
        email: r.email,
        nombre: r.nombre,
        apellido: r.apellido,
        estado: 'Cancelado',
        id_reserva: r.id_reserva_principal,
      });
    } else if (estado === 'Commit' && !priorAppointmentId) {
      accion = 'crear';
      const appt = await createAppointment({
        contactId: contact.id,
        startTime: r.check_in!,
        endTime: r.check_out!,
        title,
        locationId: contact.locationId,
      });
      await saveAppointmentId(supabase, r.id_reserva_principal, appt.id);
      await addContactTags(contact.id, ['Confirmada ✅']);
    } else if (estado === 'Commit' && priorAppointmentId) {
      accion = 'actualizar';
      // GHL no expone update de cita aquí: borrar la vieja y crear una nueva.
      await deleteAppointment(priorAppointmentId).catch(() => {});
      const appt = await createAppointment({
        contactId: contact.id,
        startTime: r.check_in!,
        endTime: r.check_out!,
        title,
        locationId: contact.locationId,
      });
      await saveAppointmentId(supabase, r.id_reserva_principal, appt.id);
      await addContactTags(contact.id, ['Confirmada ✅']);
    } else {
      accion = 'sin_accion';
      await supabase.from('logs_workflow_warnings').insert({
        workflow: WORKFLOW,
        mensaje: 'Estado/appointment_id no matchea ningún caso del decisor',
        contexto: {
          estado,
          ghl_appointment_id: priorAppointmentId,
          id_reserva: r.id_reserva_principal,
        },
      });
    }

    return Response.json({
      ok: true,
      id_reserva: r.id_reserva_principal,
      estado,
      accion,
      contactId: contact.id,
    });
  } catch (err) {
    await logWorkflowError({
      workflow: WORKFLOW,
      error: err,
      context: { id_reserva: r.id_reserva_principal, id_evento: r.id_evento },
    });
    return Response.json({ error: 'Error procesando la reserva' }, { status: 500 });
  }
}
