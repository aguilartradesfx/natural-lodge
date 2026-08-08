-- Chatbot: idempotencia por mensaje y auditoría del escalamiento.
--
-- Contexto: GHL dispara un webhook por mensaje entrante, pero el webhook no
-- trae el texto. Varios mensajes seguidos generaban varias corridas que leían
-- el MISMO último mensaje y contestaban varias veces. La tabla de abajo hace
-- que gane una sola: el PRIMARY KEY resuelve la carrera sin locks.

CREATE TABLE IF NOT EXISTS chatbot_mensajes_atendidos (
  ghl_message_id TEXT PRIMARY KEY,
  contact_id     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Para poder purgar los registros viejos sin escanear la tabla entera.
CREATE INDEX IF NOT EXISTS idx_chatbot_atendidos_created
  ON chatbot_mensajes_atendidos (created_at);

-- Cuando el bot escala, promete que el equipo se comunica. Esta columna deja
-- ver si el workflow de GHL realmente se disparó: hasta ahora la promesa se
-- hacía y nadie se enteraba.
ALTER TABLE chatbot_logs ADD COLUMN IF NOT EXISTS workflow_disparado BOOLEAN;

-- Ahora el bot puede decidir NO enviar (canal desconocido, o WhatsApp fuera de
-- la ventana de 24h). El texto se sigue guardando en message_out para el ciclo
-- de revisión; esta columna dice si el huésped realmente lo recibió.
ALTER TABLE chatbot_logs ADD COLUMN IF NOT EXISTS enviado BOOLEAN;
