import { createAdminClient } from '@/lib/supabase/admin';
import { fireInboundWebhook, GHL_INBOUND_HOOKS } from '@/lib/ghl';
import { todayCostaRica } from '@/lib/reservas';
import { logWorkflowError } from '@/lib/error-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WORKFLOW = 'flujo_2_etiquetas';

// ── Etiquetas y su hook de GHL ──────────────────────────────────
const ETIQUETA_3DIAS = '⏳ check-in: 3 días';
const ETIQUETA_MANANA = '🔔 check-in: mañana';
const ETIQUETA_HOY = '✅ check-in: hoy';
const ETIQUETA_CHECKOUT = '⭐ check-out: realizado';

const HOOK_BY_ETIQUETA: Record<string, string> = {
  [ETIQUETA_3DIAS]: GHL_INBOUND_HOOKS.etiqueta3Dias,
  [ETIQUETA_MANANA]: GHL_INBOUND_HOOKS.etiquetaManana,
  [ETIQUETA_HOY]: GHL_INBOUND_HOOKS.etiquetaHoy,
  [ETIQUETA_CHECKOUT]: GHL_INBOUND_HOOKS.etiquetaCheckout,
};

// Etiqueta "vieja" por defecto que asume cada transición (igual que n8n).
const ETIQUETA_VIEJA_DEFAULT: Record<string, string> = {
  [ETIQUETA_3DIAS]: '🏨 reserva activa',
  [ETIQUETA_MANANA]: ETIQUETA_3DIAS,
  [ETIQUETA_HOY]: ETIQUETA_MANANA,
  [ETIQUETA_CHECKOUT]: ETIQUETA_HOY,
};

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Fecha (YYYY-MM-DD) en timezone CR de un timestamptz. */
function crDate(value: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Costa_Rica',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function calcularEtiqueta(
  checkIn: string | null,
  checkOut: string | null,
  hoy: string,
): string | null {
  const ci = checkIn ? crDate(checkIn) : '';
  const co = checkOut ? crDate(checkOut) : '';
  if (ci && ci === addDays(hoy, 3)) return ETIQUETA_3DIAS;
  if (ci && ci === addDays(hoy, 1)) return ETIQUETA_MANANA;
  if (ci && ci === hoy) return ETIQUETA_HOY;
  if (co && co === addDays(hoy, -1)) return ETIQUETA_CHECKOUT;
  return null;
}

export async function GET(req: Request) {
  // Seguridad del cron (Vercel envía Authorization: Bearer $CRON_SECRET).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return Response.json({ error: 'No autorizado' }, { status: 401 });
    }
  }

  const supabase = createAdminClient();
  const hoy = todayCostaRica();
  const desde = addDays(hoy, -2); // ventana mínima para checkout de ayer

  let procesadas = 0;
  let actualizadas = 0;

  try {
    // Reservas activas dentro de la ventana relevante.
    const { data, error } = await supabase
      .from('reservas_orbe')
      .select('id_reserva_principal, email, telefono, nombre, apellido, check_in, check_out, etiqueta_actual')
      .eq('estado', 'Commit')
      .gte('check_out', `${desde}T00:00:00-06:00`);
    if (error) throw error;

    for (const r of data ?? []) {
      procesadas++;
      const etiquetaNueva = calcularEtiqueta(r.check_in, r.check_out, hoy);
      if (!etiquetaNueva || etiquetaNueva === r.etiqueta_actual) continue;

      const hookId = HOOK_BY_ETIQUETA[etiquetaNueva];
      const etiquetaVieja = r.etiqueta_actual || ETIQUETA_VIEJA_DEFAULT[etiquetaNueva];

      // Disparar automatización de GHL.
      if (hookId) {
        await fireInboundWebhook(hookId, {
          email: r.email,
          id_reserva: r.id_reserva_principal,
          etiqueta_nueva: etiquetaNueva,
          etiqueta_vieja: etiquetaVieja,
        });
      }

      // Persistir la etiqueta + log.
      await supabase
        .from('reservas_orbe')
        .update({ etiqueta_actual: etiquetaNueva, etiqueta_actualizada_en: new Date().toISOString() })
        .eq('id_reserva_principal', r.id_reserva_principal);

      await supabase.from('logs_etiquetas_proactivas').insert({
        id_reserva_principal: r.id_reserva_principal,
        email: r.email,
        etiqueta_anterior: r.etiqueta_actual || '',
        etiqueta_nueva: etiquetaNueva,
      });

      actualizadas++;
    }

    return Response.json({ ok: true, hoy, procesadas, actualizadas });
  } catch (err) {
    await logWorkflowError({ workflow: WORKFLOW, error: err, context: { procesadas, actualizadas } });
    return Response.json({ error: 'Error en el cron de etiquetas' }, { status: 500 });
  }
}
