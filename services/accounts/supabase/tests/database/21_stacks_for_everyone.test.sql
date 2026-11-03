begin;
\ir _helpers.psql
select plan(17);

select tests.create_user('own@example.com') as own \gset
select tests.create_user('co@example.com') as co \gset
select tests.create_user('mem@example.com') as mem \gset
select tests.create_user('mem2@example.com') as mem2 \gset
select tests.create_user('fresh@example.com') as fresh \gset

-- Any user owns up to 10 Stacks.
select tests.sign_in_as('own@example.com');
insert into public.teams (owner_id, name) select :'own', 'Stack ' || n from generate_series(1, 10) n;
select is((select count(*)::int from public.teams where owner_id = :'own'), 10, 'a plain user creates 10 stacks');
select throws_ok(format('insert into public.teams (owner_id, name) values (%L, %L)', :'own', 'Eleven'),
  '54000', null, 'the 11th stack is refused');
select tests.sign_out();

select id as team from public.teams where owner_id = :'own' order by name limit 1 \gset
insert into public.team_members (team_id, user_id, role) values
  (:'team', :'co', 'co_captain'), (:'team', :'mem', 'player'), (:'team', :'mem2', 'player');

-- Party invites through a Stack: owner and co-captain reach members; members reach nobody.
select tests.sign_in_as('own@example.com');
select ok(public.can_invite(:'mem'), 'the owner can invite a member');
select tests.sign_out();
select tests.sign_in_as('co@example.com');
select ok(public.can_invite(:'mem'), 'a co-captain can invite a member');
select tests.sign_out();
select tests.sign_in_as('mem@example.com');
select ok(not public.can_invite(:'own'), 'a member cannot invite the owner through the stack');
select ok(not public.can_invite(:'mem2'), 'a member cannot invite another member through the stack');
select tests.sign_out();
insert into public.friendships (requester_id, addressee_id, status) values (:'mem', :'mem2', 'accepted');
select tests.sign_in_as('mem@example.com');
select ok(public.can_invite(:'mem2'), 'friends still invite each other');
select tests.sign_out();

-- The invite send log is for the service role only.
select tests.sign_in_as('own@example.com');
select throws_ok('select count(*) from public.invite_sends', '42501', null, 'users cannot read the send log');
select throws_ok(format('select public.claim_invite_send(%L, %L, %L)', :'own', :'team', 'a@example.com'),
  '42501', null, 'users cannot claim sends');
select tests.sign_out();

-- Limits, counted from the log. Older accounts first.
update auth.users set created_at = now() - interval '30 days' where id in (:'own', :'co');
select is(public.claim_invite_send(:'own', :'team', 'a@example.com'), 'ok', 'the first send is allowed');
select is(public.claim_invite_send(:'own', :'team', 'a@example.com'), 'resend_wait', 'a resend within a minute waits');
update public.invite_sends set sent_at = now() - interval '2 minutes';
select is(public.claim_invite_send(:'co', :'team', 'a@example.com'), 'ok', 'a second send to the address after a minute');
update public.invite_sends set sent_at = now() - interval '2 minutes';
select is(public.claim_invite_send(:'own', :'team', 'a@example.com'), 'ok', 'a third send to the address');
update public.invite_sends set sent_at = now() - interval '2 minutes';
select is(public.claim_invite_send(:'co', :'team', 'a@example.com'), 'address_daily', 'the fourth send to one address in a day is refused');

insert into public.invite_sends (sender_id, email) select :'own', 'x' || n || '@example.com' from generate_series(1, 28) n;
select is(public.claim_invite_send(:'own', :'team', 'b@example.com'), 'sender_daily', 'a sender stops at 30 a day');

insert into public.invite_sends (sender_id, email) select :'fresh', 'y' || n || '@example.com' from generate_series(1, 5) n;
select is(public.claim_invite_send(:'fresh', null, 'c@example.com'), 'new_account', 'a new account stops at 5 a day');

insert into public.invite_sends (sender_id, email, sent_at)
  select :'mem', 'z' || n || '@example.com', now() - interval '1 hour' from generate_series(1, 300) n;
select is(public.claim_invite_send(:'co', :'team', 'd@example.com'), 'site_daily', 'the site stops at 300 a day');

select * from finish();
rollback;
