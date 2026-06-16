import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Registra un error de workflow en Supabase (reemplaza el Error Handler
 * de n8n / Flujo 4). Nunca lanza: si el log falla, solo escribe a consola.
 */
export async function logWorkflowError(input: {
  workflow: string;
  node?: string;
  error: unknown;
  context?: Record<string, unknown>;
}): Promise<void> {
  const message =
    input.error instanceof Error ? input.error.message : String(input.error);
  try {
    const supabase = createAdminClient();
    await supabase.from('logs_workflow_errors').insert({
      workflow_name: input.workflow,
      workflow_id: null,
      execution_id: null,
      last_node: input.node ?? null,
      error_message: input.context
        ? `${message} | ctx=${JSON.stringify(input.context).slice(0, 1000)}`
        : message,
    });
  } catch (logErr) {
    console.error('[logWorkflowError] no se pudo registrar el error', logErr, {
      workflow: input.workflow,
      original: message,
    });
  }
  console.error(`[${input.workflow}${input.node ? '/' + input.node : ''}]`, message);

  // Alerta por email (opcional). Reemplaza el "Enviar Email Error" de n8n.
  // Solo se dispara si RESEND_API_KEY y ERROR_ALERT_TO están configurados.
  await sendEmailAlert(input.workflow, input.node, message).catch(() => {});
}

async function sendEmailAlert(
  workflow: string,
  node: string | undefined,
  message: string,
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ERROR_ALERT_TO;
  if (!key || !to) return;

  const from = process.env.ERROR_ALERT_FROM || 'errors@send.bralto.io';
  const ahora = new Intl.DateTimeFormat('es-CR', {
    timeZone: 'America/Costa_Rica',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date());

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: `🚨 Error: ${workflow}${node ? ' → ' + node : ''}`,
      html: `<h2 style="color:#d32f2f">🚨 Error en ${workflow}</h2>
        <p><b>Nodo:</b> ${node || 'N/A'}</p>
        <p><b>Timestamp:</b> ${ahora}</p>
        <pre style="background:#f5f5f5;padding:12px;border-radius:4px;white-space:pre-wrap">${message}</pre>`,
    }),
  });
}
