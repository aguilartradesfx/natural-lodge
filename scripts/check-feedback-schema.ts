import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !serviceKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, serviceKey);

const TABLAS = [
  'nlcn_conversation_reviews',
  'nlcn_message_feedback',
  'nlcn_learned_rules',
  'nlcn_prompt_versions',
];

async function main() {
  let ok = true;

  for (const tabla of TABLAS) {
    // Un select real, no `head: true`: una respuesta HEAD no trae cuerpo, así
    // que PostgREST no puede reportar "la tabla no existe" y el chequeo pasaría
    // siempre.
    const { error } = await supabase.from(tabla).select('id').limit(1);
    if (error) {
      console.error(`✗ ${tabla}: ${error.message}`);
      ok = false;
    } else {
      console.log(`✓ ${tabla}`);
    }
  }

  // Cada agente debe tener su versión 1 semilla.
  const { data: prompts } = await supabase.from('nlcn_agent_prompts').select('agent_key');
  const { data: versiones } = await supabase
    .from('nlcn_prompt_versions')
    .select('agent_key')
    .eq('version_number', 1);
  const conVersion = new Set((versiones ?? []).map((v) => v.agent_key));
  for (const p of prompts ?? []) {
    if (conVersion.has(p.agent_key)) {
      console.log(`✓ versión 1 semilla: ${p.agent_key}`);
    } else {
      console.error(`✗ falta versión 1 para ${p.agent_key}`);
      ok = false;
    }
  }

  // La función atómica debe existir. Se invoca con un agente inexistente:
  // si responde con el error de negocio, la función está instalada.
  const { error: rpcError } = await supabase.rpc('nlcn_apply_prompt_version', {
    p_agent_key: '__inexistente__',
    p_system_prompt: 'x',
    p_rule_ids: [],
    p_change_summary: 'verificación',
    p_created_by: 'check-script',
  });
  if (rpcError && /No existe el agente/.test(rpcError.message)) {
    console.log('✓ nlcn_apply_prompt_version instalada');
  } else if (rpcError) {
    console.error(`✗ nlcn_apply_prompt_version: ${rpcError.message}`);
    ok = false;
  } else {
    console.error('✗ nlcn_apply_prompt_version no validó el agente inexistente');
    ok = false;
  }

  process.exit(ok ? 0 : 1);
}

main();
