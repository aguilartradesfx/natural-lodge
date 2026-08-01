/**
 * Verificación de punta a punta del ciclo de retroalimentación contra la base
 * REAL, con datos sintéticos y un agente temporal que se borran al terminar.
 *
 * Apagada por defecto: hace llamadas de verdad a Claude (cuestan dinero) y
 * escribe en Supabase, así que `npm test` la saltea. Para correrla:
 *
 *   set -a && . ./.env.local && set +a && E2E_REAL=1 npx vitest run lib/review-cycle.e2e.test.ts
 *
 * (Las variables se exportan a mano porque `dotenv` cargaría después de que
 * `lib/anthropic.ts` ya leyó ANTHROPIC_API_KEY.)
 */
import { describe, it, expect } from 'vitest';

import { createAdminClient } from '@/lib/supabase/admin';
import { scanAndSummarize } from '@/lib/review-scan';
import { saveFeedback, generateRuleForReview } from '@/lib/reviews';
import { applyPromptChange, listVersions, restoreVersion } from '@/lib/prompt-versions';
import { canTransition } from '@/lib/learned-rules';

const TEL = '+50600000000';
const AGENTE_TMP = '__prueba_e2e__';
const hace = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

describe.skipIf(!process.env.E2E_REAL)('ciclo completo contra la base real', () => {
  it('resume, recibe feedback, genera regla, aplica y restaura', { timeout: 300_000 }, async () => {
    const db = createAdminClient();

    // Limpieza previa por si una corrida anterior quedó a medias.
    await db.from('chatbot_logs').delete().eq('phone', TEL);
    await db.from('nlcn_conversation_reviews').delete().eq('phone', TEL);
    await db.from('nlcn_learned_rules').delete().eq('agent_key', AGENTE_TMP);
    await db.from('nlcn_prompt_versions').delete().eq('agent_key', AGENTE_TMP);
    await db.from('nlcn_agent_prompts').delete().eq('agent_key', AGENTE_TMP);

    await db.from('chatbot_logs').insert([
      {
        phone: TEL, contact_id: 'e2e', conversation_id: '',
        message_in: 'Hola, ¿cómo llego al lodge desde el aeropuerto de Liberia?',
        message_out: 'Podés tomar un bus público hasta Cañas y de ahí otro bus.',
        has_reservation: false, agente_usado: 'ventas', transferir_a_ventas: true,
        created_at: hace(10),
      },
      {
        phone: TEL, contact_id: 'e2e', conversation_id: '',
        message_in: '¿Y no tienen algún traslado ustedes?',
        message_out: 'No manejo esa información, te recomiendo consultar en recepción.',
        has_reservation: false, agente_usado: 'ventas', transferir_a_ventas: true,
        created_at: hace(9.9),
      },
    ]);

    // 1) Barrido
    const scan = await scanAndSummarize();
    console.log('· barrido:', JSON.stringify(scan));
    expect(scan.creados).toBeGreaterThanOrEqual(1);

    const { data: review } = await db
      .from('nlcn_conversation_reviews').select('*').eq('phone', TEL).maybeSingle();
    expect(review).toBeTruthy();
    console.log(`✓ resumen: "${review.summary}"`);
    console.log(`  desenlace=${review.outcome} riesgo=${review.risk_score} prioridad=${review.priority}`);
    expect(review.summary?.length).toBeGreaterThan(10);
    expect(review.signals).toContain('derivado_ventas');
    expect(review.priority).toBeGreaterThanOrEqual(20);

    // 2) Idempotencia
    const scan2 = await scanAndSummarize();
    expect(scan2.creados).toBe(0);
    console.log('✓ idempotencia: el segundo barrido no duplicó nada');

    // 3) Feedback
    const { data: logs } = await db
      .from('chatbot_logs').select('id').eq('phone', TEL).order('created_at').limit(1);
    await saveFeedback({
      reviewId: review.id,
      rating: 'mal',
      comment:
        'Perdimos una venta. Cuando pregunten cómo llegar desde Liberia, hay que ofrecer primero el traslado privado del lodge, que cuesta 180 dólares por trayecto.',
      anchors: [{ chatbot_log_id: logs![0].id, verdict: 'mal', comment: 'lo mandó al bus' }],
      userEmail: 'prueba-e2e@bralto.io',
    });
    const { data: revisada } = await db
      .from('nlcn_conversation_reviews').select('status').eq('id', review.id).maybeSingle();
    expect(revisada!.status).toBe('revisada');
    console.log('✓ feedback guardado; la revisión quedó como revisada');

    // 4) Regla
    const regla = await generateRuleForReview(review.id, 'prueba-e2e@bralto.io');
    expect(regla).toBeTruthy();
    console.log(`✓ regla generada (${regla!.kind}) para "${regla!.agent_key}"`);
    console.log(`  cuándo: ${regla!.trigger_text}`);
    console.log(`  qué:    ${regla!.rule_text.slice(0, 200)}`);
    expect(regla!.status).toBe('propuesta');

    // 5) Máquina de estados
    expect(canTransition('propuesta', 'aplicada', 'nueva')).toBe(false);
    expect(canTransition('propuesta', 'aprobada', 'conflicto')).toBe(false);
    console.log('✓ la máquina de estados rechaza las transiciones inválidas');

    // 6) Aplicación atómica sobre un agente temporal
    await db.from('nlcn_agent_prompts').insert({
      agent_key: AGENTE_TMP, display_name: 'Prueba E2E',
      description: 'temporal', system_prompt: 'PROMPT ORIGINAL DE PRUEBA.',
    });
    const { data: reglaTmp } = await db.from('nlcn_learned_rules').insert({
      agent_key: AGENTE_TMP,
      trigger_text: 'preguntan cómo llegar desde Liberia',
      rule_text: 'Ofrecé el traslado privado a 180 dólares por trayecto.',
      kind: 'nueva', status: 'aprobada', created_by: 'prueba-e2e@bralto.io',
    }).select().single();

    const v = await applyPromptChange({
      agentKey: AGENTE_TMP,
      systemPrompt: 'PROMPT ORIGINAL DE PRUEBA.\n\nOfrecé el traslado privado a 180 dólares.',
      ruleIds: [reglaTmp!.id],
      changeSummary: '1 regla integrada',
      userEmail: 'prueba-e2e@bralto.io',
    });
    console.log(`✓ aplicación atómica → versión ${v.versionNumber}`);

    const { data: vivo } = await db
      .from('nlcn_agent_prompts').select('system_prompt').eq('agent_key', AGENTE_TMP).maybeSingle();
    expect(vivo!.system_prompt).toMatch(/180/);

    const { data: aplicada } = await db
      .from('nlcn_learned_rules').select('status, applied_version_id').eq('id', reglaTmp!.id).maybeSingle();
    expect(aplicada!.status).toBe('aplicada');
    expect(aplicada!.applied_version_id).toBe(v.versionId);
    console.log('✓ la regla quedó aplicada y enlazada a su versión');

    // 7) Restaurar
    const versiones = await listVersions(AGENTE_TMP);
    console.log(`· historial: ${versiones.map((x) => 'v' + x.version_number).join(', ')}`);
    const v1 = versiones.find((x) => x.version_number === 1)!;
    const rest = await restoreVersion({
      agentKey: AGENTE_TMP, versionId: v1.id, userEmail: 'prueba-e2e@bralto.io',
    });
    const { data: restaurado } = await db
      .from('nlcn_agent_prompts').select('system_prompt').eq('agent_key', AGENTE_TMP).maybeSingle();
    expect(restaurado!.system_prompt).toBe('PROMPT ORIGINAL DE PRUEBA.');
    console.log(`✓ restaurado a v1 creando la versión ${rest.versionNumber}`);

    // Limpieza
    await db.from('nlcn_learned_rules').delete().eq('agent_key', AGENTE_TMP);
    await db.from('nlcn_prompt_versions').delete().eq('agent_key', AGENTE_TMP);
    await db.from('nlcn_agent_prompts').delete().eq('agent_key', AGENTE_TMP);
    await db.from('nlcn_learned_rules').delete().eq('source_review_id', review.id);
    await db.from('nlcn_conversation_reviews').delete().eq('phone', TEL);
    await db.from('chatbot_logs').delete().eq('phone', TEL);

    const { data: q1 } = await db.from('chatbot_logs').select('id').eq('phone', TEL);
    const { data: q2 } = await db.from('nlcn_conversation_reviews').select('id').eq('phone', TEL);
    const { data: q3 } = await db.from('nlcn_agent_prompts').select('agent_key').eq('agent_key', AGENTE_TMP);
    expect([q1?.length, q2?.length, q3?.length]).toEqual([0, 0, 0]);
    console.log('✓ limpieza verificada');
  });
});
