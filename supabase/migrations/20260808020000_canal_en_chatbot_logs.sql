-- Canal por el que salió cada respuesta.
--
-- Sin esta columna, diagnosticar "no respondió por SMS" obliga a cruzar los
-- logs con GHL a mano. Con ella se ve de un vistazo si el bot contestó por
-- donde debía.
ALTER TABLE chatbot_logs ADD COLUMN IF NOT EXISTS canal TEXT;
