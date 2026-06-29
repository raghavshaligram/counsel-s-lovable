
-- Firm Templates: cloud-synced config presets (Bates, header/footer, stamp)
CREATE TABLE public.firm_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('bates', 'header-footer', 'stamp')),
  name TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_templates TO authenticated;
GRANT ALL ON public.firm_templates TO service_role;

ALTER TABLE public.firm_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own firm templates"
  ON public.firm_templates FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_firm_templates_user_kind ON public.firm_templates(user_id, kind, updated_at DESC);

CREATE TRIGGER firm_templates_set_updated_at
  BEFORE UPDATE ON public.firm_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Case Sessions: saved workspace manifest (config + file refs, never bytes)
CREATE TABLE public.case_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_sessions TO authenticated;
GRANT ALL ON public.case_sessions TO service_role;

ALTER TABLE public.case_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own case sessions"
  ON public.case_sessions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_case_sessions_user ON public.case_sessions(user_id, updated_at DESC);

CREATE TRIGGER case_sessions_set_updated_at
  BEFORE UPDATE ON public.case_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
