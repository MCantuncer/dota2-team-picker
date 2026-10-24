begin;
\ir _helpers.psql
select plan(2);

-- A new table without row level security would be readable by anyone with the public key.
select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'every table in public has row level security on'
);

-- Security definer functions must pin search_path, or a caller could hijack the names they use.
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') $$,
  'every security definer function in public sets search_path'
);

select * from finish();
rollback;
