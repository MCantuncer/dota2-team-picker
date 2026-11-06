-- Steam is the only way to sign in, so no account links Steam later: the steam-link function and its
-- pending requests are gone.
drop table public.steam_link_requests;
