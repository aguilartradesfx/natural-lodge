-- Tabla del estado global del bot (single row, id siempre = 1)
CREATE TABLE IF NOT EXISTS nlcn_bot_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT,
  CONSTRAINT single_row CHECK (id = 1)
);

-- Tabla de prompts por agente
CREATE TABLE IF NOT EXISTS nlcn_agent_prompts (
  agent_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

-- Trigger para auto-actualizar updated_at
CREATE OR REPLACE FUNCTION nlcn_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS nlcn_bot_state_touch ON nlcn_bot_state;
CREATE TRIGGER nlcn_bot_state_touch
  BEFORE UPDATE ON nlcn_bot_state
  FOR EACH ROW EXECUTE FUNCTION nlcn_touch_updated_at();

DROP TRIGGER IF EXISTS nlcn_agent_prompts_touch ON nlcn_agent_prompts;
CREATE TRIGGER nlcn_agent_prompts_touch
  BEFORE UPDATE ON nlcn_agent_prompts
  FOR EACH ROW EXECUTE FUNCTION nlcn_touch_updated_at();

-- Habilitar RLS
ALTER TABLE nlcn_bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcn_agent_prompts ENABLE ROW LEVEL SECURITY;

-- Policies: solo usuarios autenticados pueden leer/escribir
DROP POLICY IF EXISTS "auth_read_state" ON nlcn_bot_state;
CREATE POLICY "auth_read_state" ON nlcn_bot_state
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_write_state" ON nlcn_bot_state;
CREATE POLICY "auth_write_state" ON nlcn_bot_state
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read_prompts" ON nlcn_agent_prompts;
CREATE POLICY "auth_read_prompts" ON nlcn_agent_prompts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_write_prompts" ON nlcn_agent_prompts;
CREATE POLICY "auth_write_prompts" ON nlcn_agent_prompts
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- IMPORTANTE: el rol `postgres` (service_role en n8n) bypassa RLS por default,
-- así que n8n sigue pudiendo leer estas tablas sin problemas.

-- Insertar fila única del estado
INSERT INTO nlcn_bot_state (id, is_enabled) VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

-- Insertar filas placeholder de prompts (el seed real corre después)
INSERT INTO nlcn_agent_prompts (agent_key, display_name, description, system_prompt) VALUES
  ('soporte', 'Soporte', 'Atiende huéspedes con reservas activas (check-in, info del lodge, modificaciones).', 'PLACEHOLDER'),
  ('bigday', 'BigDay', 'Maneja la dinámica de avistamiento de aves Big Day Caño Negro.', 'PLACEHOLDER'),
  ('ventas', 'Ventas — Lorena', 'Convierte prospectos sin reserva en huéspedes confirmados.', 'PLACEHOLDER')
ON CONFLICT (agent_key) DO NOTHING;
