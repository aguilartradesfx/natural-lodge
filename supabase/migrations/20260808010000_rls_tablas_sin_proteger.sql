-- Cierra el acceso público a las tablas internas.
--
-- Supabase le da a los roles `anon` y `authenticated` permisos completos sobre
-- las tablas de `public`, y el anon key viaja en el bundle del navegador. Sin
-- RLS, cualquiera con esa llave podía leer, modificar y borrar conversaciones
-- de huéspedes (teléfono y texto de los mensajes) por la API REST.
--
-- Todas estas tablas se usan únicamente desde el servidor con el service role,
-- que ignora RLS. Activarlo sin políticas las deja accesibles solo para él, que
-- es exactamente el alcance que necesitan.

ALTER TABLE chatbot_logs                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_mensajes_atendidos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcn_chat_memory             ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcn_conversation_reviews    ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcn_message_feedback        ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcn_learned_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE nlcn_prompt_versions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs_workflow_errors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs_workflow_warnings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs_etiquetas_proactivas    ENABLE ROW LEVEL SECURITY;
