-- Ensure every new auth user gets a profile + a default 'free' subscription row.
-- Functions already exist (handle_new_user_profile, handle_new_user_subscription)
-- but the triggers were missing, so users created before an admin set a plan
-- never had a subscriptions row -- making the workspace fall back to 'free'.
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

DROP TRIGGER IF EXISTS on_auth_user_created_subscription ON auth.users;
CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();

-- Backfill: any existing auth user without a row gets the defaults.
INSERT INTO public.profiles (user_id, email)
  SELECT u.id, u.email FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE p.user_id IS NULL;
INSERT INTO public.subscriptions (user_id, plan, status)
  SELECT u.id, 'free', 'active' FROM auth.users u
  LEFT JOIN public.subscriptions s ON s.user_id = u.id
  WHERE s.user_id IS NULL;

-- Enable realtime so the workspace unlocks paid features the moment an
-- admin changes the user's plan, without a manual reload.
ALTER TABLE public.subscriptions REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;