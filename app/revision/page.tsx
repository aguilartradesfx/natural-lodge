import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { listReviews, type RuleRow } from '@/lib/reviews';
import { listVersions, type PromptVersion } from '@/lib/prompt-versions';
import { RULE_AGENT_KEYS } from '@/lib/review-constants';
import { ReviewWorkspace } from '@/components/review/ReviewWorkspace';
import type { Prompt } from '@/components/AgentWorkspace';

export const dynamic = 'force-dynamic';

export default async function RevisionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();

  const [reviews, { data: rules }, { data: prompts }] = await Promise.all([
    listReviews({ limit: 100 }),
    admin
      .from('nlcn_learned_rules')
      .select('*')
      .in('status', ['propuesta', 'aprobada'])
      .order('created_at', { ascending: false }),
    admin.from('nlcn_agent_prompts').select('*').order('agent_key'),
  ]);

  // Historial por agente. Son consultas chicas (20 filas por agente como tope).
  const versionesPorAgente: Record<string, PromptVersion[]> = {};
  await Promise.all(
    RULE_AGENT_KEYS.map(async (key) => {
      versionesPorAgente[key] = await listVersions(key);
    }),
  );

  return (
    <ReviewWorkspace
      userEmail={user?.email || null}
      initialReviews={reviews}
      initialRules={(rules || []) as RuleRow[]}
      prompts={(prompts || []) as Prompt[]}
      initialVersions={versionesPorAgente}
    />
  );
}
