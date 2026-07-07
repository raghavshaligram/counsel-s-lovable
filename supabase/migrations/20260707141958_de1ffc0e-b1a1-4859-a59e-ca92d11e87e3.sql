-- Support requests: help + feature-request submissions from the workspace chips.
CREATE TABLE public.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('help','feature')),
  title text,
  message text NOT NULL,
  name text,
  email text,
  plan text,
  page text,
  user_agent text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','in-progress','done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Grants — anon + authenticated can INSERT (support form works signed-out).
-- SELECT/UPDATE/DELETE are gated by owner-only RLS below.
GRANT INSERT ON public.support_requests TO anon;
GRANT INSERT, SELECT, UPDATE, DELETE ON public.support_requests TO authenticated;
GRANT ALL ON public.support_requests TO service_role;

ALTER TABLE public.support_requests ENABLE ROW LEVEL SECURITY;

-- Anyone (anon or signed-in) can submit a request.
CREATE POLICY "anyone can submit support requests"
  ON public.support_requests
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Only the OWNER (checked in server functions via OWNER_USER_ID env var)
-- interacts with rows through server functions using service_role. No
-- direct client SELECT/UPDATE is allowed.
CREATE POLICY "no client select"
  ON public.support_requests
  FOR SELECT
  TO authenticated
  USING (false);

CREATE TRIGGER support_requests_updated_at
  BEFORE UPDATE ON public.support_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX support_requests_created_at_idx
  ON public.support_requests (created_at DESC);