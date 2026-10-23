-- The Steam name of a linked account, so the website can show which Steam
-- account is connected. Written by the profile sync, cleared on disconnect.

alter table public.profiles
  add column steam_name text check (char_length(steam_name) <= 64);

comment on column public.profiles.steam_name is 'Steam persona name from OpenDota. Null when no Steam account is linked.';
