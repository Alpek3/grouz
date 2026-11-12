-- ════════════════════════════════════════════════════════════════
-- GrouZ — notifications cliquables (type + cible)
-- À coller dans Supabase → SQL Editor → Run (une seule fois)
-- ════════════════════════════════════════════════════════════════

alter table public.notifications add column if not exists kind text;
alter table public.notifications add column if not exists ref_id uuid;

-- Nouvelle sortie : notifie les amis (cible = la sortie)
create or replace function public.on_activity_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  insert into activity_members (activity_id, user_id, status)
  values (new.id, new.creator_id, 'accepted');
  select name into who from profiles where id = new.creator_id;
  insert into notifications (user_id, text, kind, ref_id)
  select case when requester_id = new.creator_id then addressee_id else requester_id end,
         '🗺 ' || who || ' a publié une nouvelle sortie : "' || new.title || '"',
         'friend_activity', new.id
  from friendships
  where status = 'accepted' and new.creator_id in (requester_id, addressee_id);
  return new;
end $$;

-- Demande d'inscription / acceptation (cible = la sortie)
create or replace function public.on_member_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare act activities; who text; cnt int;
begin
  select * into act from activities where id = new.activity_id;
  if tg_op = 'INSERT' and new.status = 'pending' then
    select name into who from profiles where id = new.user_id;
    insert into notifications (user_id, text, kind, ref_id)
    values (act.creator_id, '🔔 ' || who || ' souhaite rejoindre "' || act.title || '"', 'join_request', act.id);
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status = 'pending' then
    select count(*) into cnt from activity_members
      where activity_id = new.activity_id and status = 'accepted';
    if cnt > act.max_people then
      raise exception 'Sortie complète';
    end if;
    insert into notifications (user_id, text, kind, ref_id)
    values (new.user_id, '✅ Vous avez été accepté dans "' || act.title || '" !', 'join_accepted', act.id);
  end if;
  return new;
end $$;

-- Amitié (cible = la personne)
create or replace function public.on_friendship_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if tg_op = 'INSERT' then
    select name into who from profiles where id = new.requester_id;
    insert into notifications (user_id, text, kind, ref_id)
    values (new.addressee_id, '👋 ' || who || ' veut vous ajouter en ami !', 'friend_request', new.requester_id);
  elsif new.status = 'accepted' and old.status = 'pending' then
    select name into who from profiles where id = new.addressee_id;
    insert into notifications (user_id, text, kind, ref_id)
    values (new.requester_id, '✅ ' || who || ' a accepté votre demande d''amitié !', 'friend_accepted', new.addressee_id);
  end if;
  return new;
end $$;
