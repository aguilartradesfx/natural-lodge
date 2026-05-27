import { createClient } from '@/lib/supabase/server';

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, error: new Response('No autorizado', { status: 401 }) };
  return { user, error: null as null, supabase };
}
