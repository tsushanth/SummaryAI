-- Add output_language to recordings — user-selected language for the generated summary.
-- BCP-47 codes (e.g., 'en', 'es', 'fr-FR', 'pt-BR'); NULL = let the model default to English.
ALTER TABLE recordings
ADD COLUMN IF NOT EXISTS output_language TEXT;
