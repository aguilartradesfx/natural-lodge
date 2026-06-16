-- ════════════════════════════════════════════════════════════════
-- Migración: tablas operativas que n8n creó en el Postgres compartido.
--
-- Estas tablas YA EXISTEN en producción (n8n las creó). Esta migración
-- las documenta y permite reconstruir el entorno desde cero. Es 100%
-- idempotente (CREATE TABLE IF NOT EXISTS) — si una tabla ya existe con
-- otro esquema, NO la modifica; solo aplica a entornos nuevos.
--
-- El service_role (que usan las API routes server-side) bypassa RLS,
-- igual que lo hacía el rol `postgres` en n8n.
-- ════════════════════════════════════════════════════════════════

-- ── Flujo 1: Reservas Orbe ──────────────────────────────────────
-- Tabla principal de reservas. Upsert por id_reserva_principal.
CREATE TABLE IF NOT EXISTS reservas_orbe (
  id                      BIGSERIAL PRIMARY KEY,
  id_reserva_principal    TEXT UNIQUE NOT NULL,
  id_reserva_secundario   TEXT,
  id_evento               TEXT,
  estado                  TEXT,
  nombre                  TEXT,
  apellido                TEXT,
  telefono                TEXT,
  email                   TEXT,
  check_in                TIMESTAMPTZ,
  check_out               TIMESTAMPTZ,
  fecha_creacion_reserva  TIMESTAMPTZ,
  adultos                 INTEGER DEFAULT 0,
  ninos                   INTEGER DEFAULT 0,
  tipo_habitacion         TEXT,
  cantidad_habitaciones   INTEGER DEFAULT 1,
  monto_total             NUMERIC(12,2) DEFAULT 0,
  moneda                  TEXT DEFAULT 'USD',
  monto_tarifa_base       NUMERIC(12,2) DEFAULT 0,
  nombre_hotel            TEXT,
  id_hotel                TEXT,
  tipo_canal_venta        TEXT,
  agente_origen           TEXT,
  timestamp_webhook       TIMESTAMPTZ,
  ghl_appointment_id      TEXT,
  etiqueta_actual         TEXT,
  etiqueta_actualizada_en TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reservas_orbe_telefono ON reservas_orbe (telefono);
CREATE INDEX IF NOT EXISTS idx_reservas_orbe_email ON reservas_orbe (email);
CREATE INDEX IF NOT EXISTS idx_reservas_orbe_checkin ON reservas_orbe (check_in);
CREATE INDEX IF NOT EXISTS idx_reservas_orbe_estado ON reservas_orbe (estado);

-- Historial inmutable de cada webhook recibido (también sirve de dedup por id_evento).
CREATE TABLE IF NOT EXISTS logs_webhook_orbe (
  id                      BIGSERIAL PRIMARY KEY,
  id_evento               TEXT,
  id_reserva_principal    TEXT,
  id_reserva_secundario   TEXT,
  estado                  TEXT,
  nombre                  TEXT,
  apellido                TEXT,
  telefono                TEXT,
  email                   TEXT,
  check_in                TIMESTAMPTZ,
  check_out               TIMESTAMPTZ,
  fecha_creacion_reserva  TIMESTAMPTZ,
  adultos                 INTEGER,
  ninos                   INTEGER,
  tipo_habitacion         TEXT,
  cantidad_habitaciones   INTEGER,
  monto_total             NUMERIC(12,2),
  moneda                  TEXT,
  monto_tarifa_base       NUMERIC(12,2),
  nombre_hotel            TEXT,
  id_hotel                TEXT,
  tipo_canal_venta        TEXT,
  agente_origen           TEXT,
  timestamp_webhook       TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_webhook_orbe_evento ON logs_webhook_orbe (id_evento);

-- Warnings del Switch decisor (estado/appointment que no matchea ningún caso).
CREATE TABLE IF NOT EXISTS logs_workflow_warnings (
  id          BIGSERIAL PRIMARY KEY,
  workflow    TEXT,
  mensaje     TEXT,
  contexto    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Flujo 2: Etiquetas proactivas ───────────────────────────────
CREATE TABLE IF NOT EXISTS logs_etiquetas_proactivas (
  id                    BIGSERIAL PRIMARY KEY,
  id_reserva_principal  TEXT,
  email                 TEXT,
  etiqueta_anterior     TEXT,
  etiqueta_nueva        TEXT,
  fecha_envio           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Flujo 4: Errores ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logs_workflow_errors (
  id             BIGSERIAL PRIMARY KEY,
  workflow_name  TEXT,
  workflow_id    TEXT,
  execution_id   TEXT,
  last_node      TEXT,
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Chatbot ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chatbot_logs (
  id                  BIGSERIAL PRIMARY KEY,
  phone               TEXT,
  contact_id          TEXT,
  conversation_id     TEXT,
  message_in          TEXT,
  message_out         TEXT,
  has_reservation     BOOLEAN,
  agente_usado        TEXT,
  transferir_a_ventas BOOLEAN,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para el rate-limit (COUNT por phone en ventana de 60s).
CREATE INDEX IF NOT EXISTS idx_chatbot_logs_phone_created ON chatbot_logs (phone, created_at);

-- Memoria conversacional del chatbot (reemplaza memoryPostgresChat de n8n).
-- session_key = "<phone>_<agente>" (ej. "+50688887777_soporte").
CREATE TABLE IF NOT EXISTS nlcn_chat_memory (
  id           BIGSERIAL PRIMARY KEY,
  session_key  TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nlcn_chat_memory_session ON nlcn_chat_memory (session_key, created_at);

-- updated_at automático en reservas_orbe (reutiliza la función del init).
DROP TRIGGER IF EXISTS reservas_orbe_touch ON reservas_orbe;
CREATE TRIGGER reservas_orbe_touch
  BEFORE UPDATE ON reservas_orbe
  FOR EACH ROW EXECUTE FUNCTION nlcn_touch_updated_at();
