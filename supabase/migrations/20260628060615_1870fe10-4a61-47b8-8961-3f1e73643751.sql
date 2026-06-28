
-- set_updated_at doesn't need elevated privileges
ALTER FUNCTION public.set_updated_at() SECURITY INVOKER;

-- lock down EXECUTE on both helpers; triggers still fire (they bypass EXECUTE checks)
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_subscription() FROM PUBLIC, anon, authenticated;
