-- Local PostgreSQL test fixture only. NEVER apply this file to Supabase.
-- Minimal Auth contract for SQL authorization tests, not a simulated login flow.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key,
  email_confirmed_at timestamptz,
  is_anonymous boolean not null default false,
  raw_user_meta_data jsonb not null default '{}'
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to authenticated, service_role;
-- Model a permissive project default: the migration must revoke browser grants.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
