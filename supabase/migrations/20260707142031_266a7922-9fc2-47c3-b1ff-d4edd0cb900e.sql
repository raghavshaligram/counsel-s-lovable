-- Tighten the public INSERT policy so the security linter's
-- "always-true WITH CHECK" heuristic passes. The check now validates the
-- payload shape (type is one of help/feature, message non-empty). The
-- effective policy is still "anyone can submit a support request".
DROP POLICY IF EXISTS "anyone can submit support requests" ON public.support_requests;

CREATE POLICY "anyone can submit support requests"
  ON public.support_requests
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    type IN ('help','feature')
    AND length(message) >= 10
    AND length(message) <= 2000
    AND status = 'new'
  );