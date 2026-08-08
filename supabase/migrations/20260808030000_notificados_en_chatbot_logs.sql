-- Cuántos miembros del equipo recibieron el aviso de escalamiento.
--
-- El nodo "Internal notification" de GHL se ejecuta pero no entrega el
-- WhatsApp, y no deja rastro en ningún lado. Ahora el aviso lo manda nuestro
-- código por SMS y esta columna registra cuántos lo recibieron: un 0 es una
-- alarma, no un silencio.
ALTER TABLE chatbot_logs ADD COLUMN IF NOT EXISTS notificados INTEGER;
