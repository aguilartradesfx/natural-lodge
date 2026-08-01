-- ════════════════════════════════════════════════════════════════
-- El agente de evento (hoy "Big Day") pasa a ser configurable.
--
-- Antes: el nombre y las palabras que activaban al agente estaban
-- escritas en el código (lib/agent-router.ts). Cambiar de evento
-- exigía tocar código y desplegar.
--
-- Ahora: nombre, información, prompt, palabras clave y encendido se
-- editan desde el panel. El agent_key ('bigday') NO cambia: es el
-- identificador interno que usan la memoria conversacional y los
-- logs, y renombrarlo rompería el historial.
-- ════════════════════════════════════════════════════════════════

-- Permite apagar un agente sin borrarlo. Solo el agente de evento se
-- puede apagar desde el panel; soporte y ventas quedan siempre activos
-- porque son los que atienden el día a día.
ALTER TABLE nlcn_agent_prompts
  ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT true;

-- Palabras que hacen que este agente conteste. Vacío = no se activa
-- por palabras (es el caso de soporte y ventas, que se eligen por si
-- el huésped tiene reserva o no).
ALTER TABLE nlcn_agent_prompts
  ADD COLUMN IF NOT EXISTS keywords JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Marca cuál es el agente de evento: el único que muestra los
-- controles extra en el panel y el único que se puede apagar.
ALTER TABLE nlcn_agent_prompts
  ADD COLUMN IF NOT EXISTS is_event BOOLEAN NOT NULL DEFAULT false;

-- Semilla: 'bigday' queda marcado como el agente de evento, con las
-- mismas palabras que hasta hoy estaban en el código. El comportamiento
-- no cambia hasta que alguien lo edite desde el panel.
UPDATE nlcn_agent_prompts
   SET is_event = true,
       keywords = '[
         "avistamiento", "big day", "bigday", "big-day", "#bigdaycanonegro",
         "ebird", "concurso", "pajarero", "birding", "birdwatching",
         "global big day", "dinamica", "dinámica", "premio caño negro",
         "premio cano negro", "foto de ave", "fotos de aves"
       ]'::jsonb
 WHERE agent_key = 'bigday'
   AND is_event = false
   AND keywords = '[]'::jsonb;
