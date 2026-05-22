import { createClient } from '@/lib/supabase/server';
import { Dashboard } from '@/components/Dashboard';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: state } = await supabase.from('nlcn_bot_state').select('*').eq('id', 1).single();
  const { data: prompts } = await supabase.from('nlcn_agent_prompts').select('*').order('agent_key');

  return <Dashboard user={user} initialState={state} initialPrompts={prompts || []} />;
}
