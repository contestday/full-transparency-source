-- Stop exposing the sign-up trigger function over the API (17 Nov 2026).
--
-- handle_new_user() only runs from the on_auth_user_created trigger on
-- auth.users. Postgres does not check EXECUTE when firing a trigger, so
-- revoking it leaves sign-up working while removing the
-- /rest/v1/rpc/handle_new_user endpoint flagged by the security advisor.

revoke execute on function public.handle_new_user() from public, anon, authenticated;
