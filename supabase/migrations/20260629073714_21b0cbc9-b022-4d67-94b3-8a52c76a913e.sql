CREATE TABLE public.compliance_certificates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('redaction','sanitize','bates','sovereignty')),
  source_name TEXT NOT NULL,
  case_label TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compliance_certificates TO authenticated;
GRANT ALL ON public.compliance_certificates TO service_role;

ALTER TABLE public.compliance_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can read own certificates"
  ON public.compliance_certificates FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Owner can insert own certificates"
  ON public.compliance_certificates FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owner can delete own certificates"
  ON public.compliance_certificates FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE INDEX compliance_certificates_user_created_idx
  ON public.compliance_certificates (user_id, created_at DESC);