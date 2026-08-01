-- ════════════════════════════════════════════════════════════════
-- Migración: ciclo de retroalimentación del chatbot.
--
-- Resumen de conversaciones → revisión humana → reglas aprendidas →
-- cambio aprobado al system_prompt, con historial restaurable.
--
-- Idempotente. El service_role (que usan las API routes) bypassa RLS.
-- ════════════════════════════════════════════════════════════════

-- ── Revisiones: una fila por episodio de conversación ───────────
-- Un "episodio" es un bloque de mensajes de un mismo (phone, agente)
-- separado del siguiente por >= REVIEW_IDLE_HOURS de silencio.
CREATE TABLE IF NOT EXISTS nlcn_conversation_reviews (
  id             BIGSERIAL PRIMARY KEY,
  phone          TEXT NOT NULL,
  agente         TEXT NOT NULL,
  contact_id     TEXT,
  window_start   TIMESTAMPTZ NOT NULL,
  window_end     TIMESTAMPTZ NOT NULL,
  turn_count     INTEGER NOT NULL DEFAULT 0,
  summary        TEXT,
  topics         JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcome        TEXT,
  risk_score     INTEGER NOT NULL DEFAULT 0,
  signals        JSONB NOT NULL DEFAULT '[]'::jsonb,
  priority       INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pendiente',
  human_rating   TEXT,
  human_comment  TEXT,
  reviewed_by    TEXT,
  reviewed_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotencia del barrido: el cron puede correr dos veces sobre los
-- mismos datos sin duplicar filas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_nlcn_reviews_episodio
  ON nlcn_conversation_reviews (phone, agente, window_end);

CREATE INDEX IF NOT EXISTS idx_nlcn_reviews_bandeja
  ON nlcn_conversation_reviews (status, priority DESC, window_end DESC);

CREATE INDEX IF NOT EXISTS idx_nlcn_reviews_created
  ON nlcn_conversation_reviews (created_at);

-- ── Feedback anclado a una respuesta puntual del bot ─────────────
CREATE TABLE IF NOT EXISTS nlcn_message_feedback (
  id              BIGSERIAL PRIMARY KEY,
  review_id       BIGINT NOT NULL REFERENCES nlcn_conversation_reviews(id) ON DELETE CASCADE,
  chatbot_log_id  BIGINT NOT NULL,
  verdict         TEXT NOT NULL CHECK (verdict IN ('bien', 'mal')),
  comment         TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nlcn_msg_feedback_review
  ON nlcn_message_feedback (review_id);

-- ── Versiones del prompt (historial restaurable) ─────────────────
-- Cada fila guarda el prompt RESULTANTE de esa versión, no el anterior.
CREATE TABLE IF NOT EXISTS nlcn_prompt_versions (
  id              BIGSERIAL PRIMARY KEY,
  agent_key       TEXT NOT NULL,
  version_number  INTEGER NOT NULL,
  system_prompt   TEXT NOT NULL,
  change_summary  TEXT,
  rule_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_nlcn_prompt_versions
  ON nlcn_prompt_versions (agent_key, version_number);

-- ── Reglas aprendidas ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nlcn_learned_rules (
  id                 BIGSERIAL PRIMARY KEY,
  agent_key          TEXT NOT NULL,
  source_review_id   BIGINT REFERENCES nlcn_conversation_reviews(id) ON DELETE SET NULL,
  trigger_text       TEXT NOT NULL,
  rule_text          TEXT NOT NULL,
  rationale          TEXT,
  kind               TEXT NOT NULL DEFAULT 'nueva' CHECK (kind IN ('nueva', 'conflicto')),
  conflict_excerpt   TEXT,
  status             TEXT NOT NULL DEFAULT 'propuesta'
                     CHECK (status IN ('propuesta', 'aprobada', 'aplicada', 'rechazada')),
  rejection_reason   TEXT,
  created_by         TEXT,
  reviewed_by        TEXT,
  reviewed_at        TIMESTAMPTZ,
  applied_version_id BIGINT REFERENCES nlcn_prompt_versions(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nlcn_rules_cola
  ON nlcn_learned_rules (status, agent_key, created_at DESC);

-- ── Semilla: versión 1 con el prompt actual de cada agente ───────
-- Garantiza que ningún agente quede sin punto de retorno.
INSERT INTO nlcn_prompt_versions (agent_key, version_number, system_prompt, change_summary, created_by)
SELECT p.agent_key, 1, p.system_prompt, 'Versión inicial (antes del ciclo de feedback)', 'migración'
FROM nlcn_agent_prompts p
WHERE NOT EXISTS (
  SELECT 1 FROM nlcn_prompt_versions v WHERE v.agent_key = p.agent_key
);

-- ── Aplicación atómica del cambio al prompt ──────────────────────
-- Crea la versión nueva, actualiza el prompt vivo y marca las reglas
-- como aplicadas. O pasa todo o no pasa nada: si algo falla, la
-- función aborta y Postgres revierte la transacción completa.
CREATE OR REPLACE FUNCTION nlcn_apply_prompt_version(
  p_agent_key      TEXT,
  p_system_prompt  TEXT,
  p_rule_ids       BIGINT[],
  p_change_summary TEXT,
  p_created_by     TEXT
)
RETURNS TABLE (version_id BIGINT, version_number INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_next    INTEGER;
  v_id      BIGINT;
BEGIN
  -- Bloquea las versiones de este agente para que dos aplicaciones
  -- simultáneas no reclamen el mismo version_number.
  PERFORM 1 FROM nlcn_prompt_versions
    WHERE agent_key = p_agent_key FOR UPDATE;

  SELECT COALESCE(MAX(v.version_number), 0) + 1 INTO v_next
    FROM nlcn_prompt_versions v WHERE v.agent_key = p_agent_key;

  INSERT INTO nlcn_prompt_versions
    (agent_key, version_number, system_prompt, change_summary, rule_ids, created_by)
  VALUES
    (p_agent_key, v_next, p_system_prompt, p_change_summary,
     to_jsonb(COALESCE(p_rule_ids, ARRAY[]::BIGINT[])), p_created_by)
  RETURNING id INTO v_id;

  UPDATE nlcn_agent_prompts
     SET system_prompt = p_system_prompt,
         updated_by    = p_created_by
   WHERE agent_key = p_agent_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe el agente %', p_agent_key;
  END IF;

  -- Solo reglas aprobadas pasan a aplicada. Una regla en otro estado
  -- se ignora en silencio: la validación dura vive en la API.
  UPDATE nlcn_learned_rules
     SET status = 'aplicada',
         applied_version_id = v_id
   WHERE id = ANY(COALESCE(p_rule_ids, ARRAY[]::BIGINT[]))
     AND status = 'aprobada';

  RETURN QUERY SELECT v_id, v_next;
END;
$$;
