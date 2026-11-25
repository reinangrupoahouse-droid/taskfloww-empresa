-- Some Consultoria registrations must stay in their own directory.
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS consultoria_only boolean NOT NULL DEFAULT false;

CREATE OR REPLACE TRIGGER trg_sync_consultoria_client_to_marketing
  AFTER INSERT OR UPDATE OF name, color, description, cnpj, legal_name,
  trade_name, state_registration, municipal_registration, address, phone,
  email, responsible, avatar_path, is_active
  ON public.clients
  FOR EACH ROW WHEN (NOT NEW.consultoria_only)
  EXECUTE FUNCTION public.sync_consultoria_client_to_marketing();
