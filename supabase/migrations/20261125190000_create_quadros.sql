-- Quadro (lousa livre / mapa mental) do Taskfloww Empresa.
-- Cada pessoa vê e altera apenas os próprios quadros.
CREATE TABLE IF NOT EXISTS public.quadros (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces (id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT 'Novo quadro',
  data jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[],"view":{"x":0,"y":0,"zoom":1}}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quadros_owner_updated_idx ON public.quadros (owner_id, updated_at DESC);

ALTER TABLE public.quadros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quadros_select_own" ON public.quadros;
CREATE POLICY "quadros_select_own" ON public.quadros
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "quadros_insert_own" ON public.quadros;
CREATE POLICY "quadros_insert_own" ON public.quadros
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "quadros_update_own" ON public.quadros;
CREATE POLICY "quadros_update_own" ON public.quadros
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "quadros_delete_own" ON public.quadros;
CREATE POLICY "quadros_delete_own" ON public.quadros
  FOR DELETE TO authenticated USING (owner_id = auth.uid());
