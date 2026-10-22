-- User profiles and favorite heroes.
--
-- Every sign-up (email or Steam) creates an auth.users row, and a trigger
-- below gives it a matching profiles row. Users can read and edit only their
-- own data. Steam and rank fields are written by the Steam login and
-- profile sync functions (service role), never by the user.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 40),
  avatar_url text,
  -- SteamID64, set only for users who signed in with Steam.
  steam_id text unique check (steam_id ~ '^[0-9]{17}$'),
  -- OpenDota rank tier: tens digit is the medal (1 Herald ... 8 Immortal),
  -- ones digit the star. Null when unknown or hidden.
  rank_tier smallint check (rank_tier between 10 and 80),
  -- The user's own record per hero from OpenDota: {"<heroId>": {"games": n, "wins": n}}.
  hero_stats jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One row per user. Steam and rank fields are filled by the profile sync.';

create table public.favorite_heroes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  hero_id smallint not null check (hero_id > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, hero_id)
);

-- Rank bracket as the engine uses it (1 Herald ... 8 Immortal).
create function public.rank_bracket(p public.profiles)
returns smallint
language sql
immutable
as $$
  select (p.rank_tier / 10)::smallint
$$;

-- Keep updated_at current.
create function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

-- Create a profile for every new user. Steam users get their SteamID from
-- app_metadata, which only the server can set.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, steam_id)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)), 40),
    new.raw_app_meta_data ->> 'steam_id'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Row level security: each user sees and changes only their own rows.
alter table public.profiles enable row level security;
alter table public.favorite_heroes enable row level security;

create policy "Read own profile" on public.profiles
for select to authenticated using ((select auth.uid()) = id);

create policy "Update own profile" on public.profiles
for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Users may only change their name and picture; the rest comes from the sync.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

create policy "Read own favorites" on public.favorite_heroes
for select to authenticated using ((select auth.uid()) = user_id);

create policy "Add own favorites" on public.favorite_heroes
for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Remove own favorites" on public.favorite_heroes
for delete to authenticated using ((select auth.uid()) = user_id);

revoke update on public.favorite_heroes from anon, authenticated;
