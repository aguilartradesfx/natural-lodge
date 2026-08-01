-- ════════════════════════════════════════════════════════════════
-- Corrección: archivar el prompt vivo como versión 1 al primer cambio.
--
-- La migración inicial sembró la versión 1 de cada agente EXISTENTE en ese
-- momento. Un agente creado después no tenía ninguna versión, así que su
-- primer `nlcn_apply_prompt_version` guardaba el prompt YA MODIFICADO como
-- versión 1: no quedaba registro del texto anterior y el cambio era
-- irreversible.
--
-- Ahora la función archiva el prompt vivo como versión 1 antes de crear la
-- versión nueva, dentro de la misma transacción. Todo agente tiene punto de
-- retorno desde su primer cambio, sin importar cuándo se creó.
-- ════════════════════════════════════════════════════════════════

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

  -- Si el agente todavía no tiene historial, se archiva primero su prompt
  -- vivo como versión 1. Sin esto, el primer cambio no tendría a dónde volver.
  IF NOT EXISTS (SELECT 1 FROM nlcn_prompt_versions WHERE agent_key = p_agent_key) THEN
    INSERT INTO nlcn_prompt_versions
      (agent_key, version_number, system_prompt, change_summary, created_by)
    SELECT p_agent_key, 1, p.system_prompt,
           'Versión inicial (archivada al primer cambio)', 'sistema'
      FROM nlcn_agent_prompts p
     WHERE p.agent_key = p_agent_key;
  END IF;

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
