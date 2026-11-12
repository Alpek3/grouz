-- ════════════════════════════════════════════════════════════════
-- GrouZ — schéma Supabase (à coller dans SQL Editor puis "Run")
-- ════════════════════════════════════════════════════════════════

-- ── TABLES ──────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  pseudo text not null unique check (char_length(pseudo) between 3 and 24),
  name text not null,
  age int not null check (age >= 13),
  gender text not null,
  bio text default '',
  avatar_url text,
  created_at timestamptz default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  category text not null,
  date date not null,
  time text not null,
  location text not null,
  lat double precision,
  lng double precision,
  max_people int not null default 6 check (max_people between 2 and 50),
  description text not null,
  created_at timestamptz default now()
);

create table public.activity_members (
  activity_id uuid references public.activities(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz default now(),
  primary key (activity_id, user_id)
);

create table public.activity_messages (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'text' check (type in ('text','voice')),
  text text,
  audio_path text,
  duration int,
  created_at timestamptz default now()
);

create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz default now(),
  check (requester_id <> addressee_id)
);
create unique index friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'text' check (type in ('text','voice')),
  text text,
  audio_path text,
  duration int,
  created_at timestamptz default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null,
  read boolean default false,
  created_at timestamptz default now()
);

create index on public.activity_messages (activity_id, created_at);
create index on public.direct_messages (sender_id, receiver_id, created_at);
create index on public.notifications (user_id, created_at desc);

-- ── FONCTIONS UTILES ────────────────────────────────────────────
create function public.is_accepted_member(a uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from activity_members
                 where activity_id = a and user_id = auth.uid() and status = 'accepted');
$$;

create function public.is_creator(a uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from activities where id = a and creator_id = auth.uid());
$$;

create function public.are_friends(a uuid, b uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from friendships where status = 'accepted'
    and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a)));
$$;

-- ── TRIGGERS ────────────────────────────────────────────────────
-- Création du profil à l'inscription (pseudo, âge, genre obligatoires)
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, pseudo, name, age, gender, bio)
  values (new.id,
          new.raw_user_meta_data->>'pseudo',
          new.raw_user_meta_data->>'name',
          (new.raw_user_meta_data->>'age')::int,
          new.raw_user_meta_data->>'gender',
          coalesce(new.raw_user_meta_data->>'bio',''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Nouvelle sortie : le créateur est membre accepté + notif à ses amis
create function public.on_activity_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  insert into activity_members (activity_id, user_id, status)
  values (new.id, new.creator_id, 'accepted');
  select name into who from profiles where id = new.creator_id;
  insert into notifications (user_id, text)
  select case when requester_id = new.creator_id then addressee_id else requester_id end,
         '🗺 ' || who || ' a publié une nouvelle sortie : "' || new.title || '"'
  from friendships
  where status = 'accepted' and new.creator_id in (requester_id, addressee_id);
  return new;
end $$;
create trigger activity_created after insert on activities
  for each row execute function public.on_activity_created();

-- Inscription : vérifie la capacité + notifie
create function public.on_member_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare act activities; who text; cnt int;
begin
  select * into act from activities where id = new.activity_id;
  if tg_op = 'INSERT' and new.status = 'pending' then
    select name into who from profiles where id = new.user_id;
    insert into notifications (user_id, text)
    values (act.creator_id, '🔔 ' || who || ' souhaite rejoindre "' || act.title || '"');
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status = 'pending' then
    select count(*) into cnt from activity_members
      where activity_id = new.activity_id and status = 'accepted';
    if cnt > act.max_people then
      raise exception 'Sortie complète';
    end if;
    insert into notifications (user_id, text)
    values (new.user_id, '✅ Vous avez été accepté dans "' || act.title || '" !');
  end if;
  return new;
end $$;
create trigger member_change after insert or update on activity_members
  for each row execute function public.on_member_change();

-- Amitié : notifications
create function public.on_friendship_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if tg_op = 'INSERT' then
    select name into who from profiles where id = new.requester_id;
    insert into notifications (user_id, text)
    values (new.addressee_id, '👋 ' || who || ' veut vous ajouter en ami !');
  elsif new.status = 'accepted' and old.status = 'pending' then
    select name into who from profiles where id = new.addressee_id;
    insert into notifications (user_id, text)
    values (new.requester_id, '✅ ' || who || ' a accepté votre demande d''amitié !');
  end if;
  return new;
end $$;
create trigger friendship_change after insert or update on friendships
  for each row execute function public.on_friendship_change();

-- ── SÉCURITÉ (Row Level Security) ───────────────────────────────
alter table profiles          enable row level security;
alter table activities        enable row level security;
alter table activity_members  enable row level security;
alter table activity_messages enable row level security;
alter table friendships       enable row level security;
alter table direct_messages   enable row level security;
alter table notifications     enable row level security;

-- profils : visibles par tous les connectés, modifiables par soi
create policy "profiles_read"   on profiles for select to authenticated using (true);
create policy "profiles_update" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- sorties : visibles par tous, gérées par le créateur
create policy "activities_read"   on activities for select to authenticated using (true);
create policy "activities_insert" on activities for insert to authenticated with check (creator_id = auth.uid());
create policy "activities_update" on activities for update to authenticated using (creator_id = auth.uid());
create policy "activities_delete" on activities for delete to authenticated using (creator_id = auth.uid());

-- membres : acceptés visibles par tous ; en attente visibles par la personne et l'organisateur
create policy "members_read" on activity_members for select to authenticated
  using (status = 'accepted' or user_id = auth.uid() or is_creator(activity_id));
create policy "members_join" on activity_members for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
create policy "members_accept" on activity_members for update to authenticated
  using (is_creator(activity_id)) with check (is_creator(activity_id));
create policy "members_leave" on activity_members for delete to authenticated
  using (user_id = auth.uid() or is_creator(activity_id));

-- chat de groupe : réservé aux membres acceptés
create policy "amsg_read" on activity_messages for select to authenticated
  using (is_accepted_member(activity_id));
create policy "amsg_send" on activity_messages for insert to authenticated
  with check (sender_id = auth.uid() and is_accepted_member(activity_id));

-- amis
create policy "friends_read" on friendships for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));
create policy "friends_request" on friendships for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');
create policy "friends_accept" on friendships for update to authenticated
  using (addressee_id = auth.uid()) with check (addressee_id = auth.uid());
create policy "friends_delete" on friendships for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- messages privés : uniquement entre amis
create policy "dm_read" on direct_messages for select to authenticated
  using (auth.uid() in (sender_id, receiver_id));
create policy "dm_send" on direct_messages for insert to authenticated
  with check (sender_id = auth.uid() and are_friends(sender_id, receiver_id));

-- notifications : les siennes uniquement (créées par les triggers)
create policy "notif_read"   on notifications for select to authenticated using (user_id = auth.uid());
create policy "notif_update" on notifications for update to authenticated using (user_id = auth.uid());

-- ── TEMPS RÉEL ──────────────────────────────────────────────────
alter publication supabase_realtime add table
  activity_messages, direct_messages, notifications, activity_members, friendships;

-- ── STOCKAGE (photos de profil + messages vocaux) ───────────────
insert into storage.buckets (id, name, public) values ('avatars','avatars', true);
insert into storage.buckets (id, name, public) values ('voices','voices', false);

create policy "avatars_read"   on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars_write"  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "voices_read"  on storage.objects for select to authenticated using (bucket_id = 'voices');
create policy "voices_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'voices' and (storage.foldername(name))[1] = auth.uid()::text);


-- ════════════════════════════════════════════════════════════════
-- GrouZ — localisation + "Personnes près de toi"
-- À coller dans Supabase → SQL Editor → Run (une seule fois)
-- ════════════════════════════════════════════════════════════════

-- Position approximative de chaque personne (visible UNIQUEMENT par elle-même)
create table if not exists public.user_locations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  city text,
  updated_at timestamptz default now()
);
alter table public.user_locations enable row level security;

create policy "loc_read_own"   on public.user_locations for select to authenticated using (user_id = auth.uid());
create policy "loc_insert_own" on public.user_locations for insert to authenticated with check (user_id = auth.uid());
create policy "loc_update_own" on public.user_locations for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "loc_delete_own" on public.user_locations for delete to authenticated using (user_id = auth.uid());

-- Recherche des personnes proches : ne renvoie jamais les coordonnées,
-- seulement la ville et une distance arrondie à 5 km.
-- Les mineurs (<18) et les adultes ne se voient pas entre eux.
create or replace function public.nearby_users(radius_km double precision default 50)
returns table (id uuid, pseudo text, name text, age int, gender text, bio text,
               avatar_url text, city text, distance_km int)
language sql security definer set search_path = public stable as $$
  with me as (
    select l.lat, l.lng, p.age
    from user_locations l join profiles p on p.id = l.user_id
    where l.user_id = auth.uid()
  ),
  d as (
    select p.id, p.pseudo, p.name, p.age, p.gender, p.bio, p.avatar_url, l.city,
           6371 * acos(least(1, greatest(-1,
             cos(radians(me.lat)) * cos(radians(l.lat)) * cos(radians(l.lng) - radians(me.lng))
             + sin(radians(me.lat)) * sin(radians(l.lat))))) as km
    from me
    join user_locations l on l.user_id <> auth.uid()
    join profiles p on p.id = l.user_id
    where (me.age >= 18) = (p.age >= 18)
      and not exists (
        select 1 from friendships f
        where (f.requester_id = auth.uid() and f.addressee_id = p.id)
           or (f.addressee_id = auth.uid() and f.requester_id = p.id))
  )
  select id, pseudo, name, age, gender, bio, avatar_url, city,
         greatest(5, (round(km / 5) * 5))::int as distance_km
  from d
  where km <= radius_km
  order by km
  limit 50;
$$;

revoke all on function public.nearby_users(double precision) from public, anon;
grant execute on function public.nearby_users(double precision) to authenticated;


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


-- ════════════════════════════════════════════════════════════════
-- GrouZ — notification à chaque message privé reçu
-- À coller dans Supabase → SQL Editor → Run (une seule fois)
-- (nécessite d'avoir lancé migration_notif_links.sql avant)
-- ════════════════════════════════════════════════════════════════

-- Une seule notification non lue par conversation : elle est remplacée
-- par la plus récente, pour ne pas inonder la cloche.
create or replace function public.on_direct_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; preview text;
begin
  select name into who from profiles where id = new.sender_id;
  preview := case when new.type = 'voice' then '🎙 Message vocal'
                  else left(coalesce(new.text, ''), 60) end;
  delete from notifications
    where user_id = new.receiver_id and kind = 'message'
      and ref_id = new.sender_id and read = false;
  insert into notifications (user_id, text, kind, ref_id)
  values (new.receiver_id, '💬 ' || who || ' : ' || preview, 'message', new.sender_id);
  return new;
end $$;

create or replace trigger direct_message_notify
  after insert on public.direct_messages
  for each row execute function public.on_direct_message();


-- ════════════════════════════════════════════════════════════════
-- GrouZ — photos, vidéos et GIFs dans les messages privés
-- À coller dans Supabase → SQL Editor → Run (une seule fois)
-- ════════════════════════════════════════════════════════════════

-- 1. Nouveaux types de message + colonnes
do $$ begin
  alter table public.direct_messages drop constraint if exists direct_messages_type_check;
end $$;
alter table public.direct_messages add constraint direct_messages_type_check
  check (type in ('text','voice','image','video','gif'));
alter table public.direct_messages add column if not exists media_path text;  -- fichier envoyé (photo/vidéo)
alter table public.direct_messages add column if not exists media_url text;   -- lien d'un GIF

-- 2. Espace de stockage privé pour les photos/vidéos (30 Mo max par fichier)
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 31457280)
on conflict (id) do nothing;

do $$ begin
  create policy "media_read" on storage.objects for select to authenticated
    using (bucket_id = 'media');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "media_write" on storage.objects for insert to authenticated
    with check (bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;

-- 3. Notification adaptée au type de message
create or replace function public.on_direct_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; preview text;
begin
  select name into who from profiles where id = new.sender_id;
  preview := case new.type
    when 'voice' then '🎙 Message vocal'
    when 'image' then '📷 Photo'
    when 'video' then '🎥 Vidéo'
    when 'gif'   then 'GIF'
    else left(coalesce(new.text, ''), 60) end;
  delete from notifications
    where user_id = new.receiver_id and kind = 'message'
      and ref_id = new.sender_id and read = false;
  insert into notifications (user_id, text, kind, ref_id)
  values (new.receiver_id, '💬 ' || who || ' : ' || preview, 'message', new.sender_id);
  return new;
end $$;
-- ════════════════════════════════════════════════════════════════
-- GrouZ — blocage, signalement, suppression de compte
-- À coller dans Supabase → SQL Editor → Run (une seule fois)
-- ════════════════════════════════════════════════════════════════

-- 1. Blocages (visibles uniquement par la personne qui bloque)
create table if not exists public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;

do $$ begin
  create policy "blocks_read_own" on public.user_blocks for select to authenticated using (blocker_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "blocks_insert_own" on public.user_blocks for insert to authenticated with check (blocker_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "blocks_delete_own" on public.user_blocks for delete to authenticated using (blocker_id = auth.uid());
exception when duplicate_object then null; end $$;

-- 2. Signalements (consultables par toi dans Table Editor → reports)
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete set null,
  context text default 'profile',
  context_id text,
  reason text not null,
  details text,
  status text default 'open',
  created_at timestamptz default now()
);
alter table public.reports enable row level security;
do $$ begin
  create policy "reports_insert_own" on public.reports for insert to authenticated with check (reporter_id = auth.uid());
exception when duplicate_object then null; end $$;

-- 3. Qui est bloqué (dans les deux sens)
create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from user_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

-- 4. Bloquer = supprimer l'amitié
create or replace function public.on_block_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from friendships
   where (requester_id = new.blocker_id and addressee_id = new.blocked_id)
      or (requester_id = new.blocked_id and addressee_id = new.blocker_id);
  return new;
end $$;
create or replace trigger block_created after insert on public.user_blocks
  for each row execute function public.on_block_created();

-- 5. Plus de message ni de demande d'ami entre personnes bloquées
do $$ begin
  drop policy if exists "dm_send" on public.direct_messages;
  create policy "dm_send" on public.direct_messages for insert to authenticated
    with check (sender_id = auth.uid() and are_friends(sender_id, receiver_id) and not is_blocked(sender_id, receiver_id));
  drop policy if exists "friends_request" on public.friendships;
  create policy "friends_request" on public.friendships for insert to authenticated
    with check (requester_id = auth.uid() and status = 'pending' and not is_blocked(requester_id, addressee_id));
end $$;

-- 6. « Près de toi » ignore les personnes bloquées
create or replace function public.nearby_users(radius_km double precision default 50)
returns table (id uuid, pseudo text, name text, age int, gender text, bio text,
               avatar_url text, city text, distance_km int)
language sql security definer set search_path = public stable as $$
  with me as (
    select l.lat, l.lng, p.age
    from user_locations l join profiles p on p.id = l.user_id
    where l.user_id = auth.uid()
  ),
  d as (
    select p.id, p.pseudo, p.name, p.age, p.gender, p.bio, p.avatar_url, l.city,
           6371 * acos(least(1, greatest(-1,
             cos(radians(me.lat)) * cos(radians(l.lat)) * cos(radians(l.lng) - radians(me.lng))
             + sin(radians(me.lat)) * sin(radians(l.lat))))) as km
    from me
    join user_locations l on l.user_id <> auth.uid()
    join profiles p on p.id = l.user_id
    where (me.age >= 18) = (p.age >= 18)
      and not is_blocked(auth.uid(), p.id)
      and not exists (
        select 1 from friendships f
        where (f.requester_id = auth.uid() and f.addressee_id = p.id)
           or (f.addressee_id = auth.uid() and f.requester_id = p.id))
  )
  select id, pseudo, name, age, gender, bio, avatar_url, city,
         greatest(5, (round(km / 5) * 5))::int as distance_km
  from d where km <= radius_km order by km limit 50;
$$;

-- 6b. Âge minimum : 15 ans (majorité numérique en France)
do $$ begin
  alter table public.profiles drop constraint if exists profiles_age_check;
  alter table public.profiles add constraint profiles_age_check check (age >= 15) not valid;
end $$;

-- 7. Suppression de compte (exigée par l'App Store et Google Play)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid();   -- tout le reste part en cascade
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 8. Chacun peut supprimer ses propres fichiers (photos, vocaux, vidéos)
do $$ begin
  create policy "own_files_delete" on storage.objects for delete to authenticated
    using (bucket_id in ('avatars', 'voices', 'media') and (storage.foldername(name))[1] = auth.uid()::text);
exception when duplicate_object then null; end $$;
-- ════════════════════════════════════════════════════════════════
-- GrouZ — suppression d'une sortie : les participants sont prévenus
-- À coller dans Supabase → SQL Editor → Run (une seule fois)
-- ════════════════════════════════════════════════════════════════

create or replace function public.on_activity_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select name into who from profiles where id = old.creator_id;
  insert into notifications (user_id, text, kind)
  select m.user_id,
         '❌ La sortie "' || old.title || '" a été annulée par ' || coalesce(who, 'l''organisateur'),
         'activity_cancelled'
  from activity_members m
  where m.activity_id = old.id and m.user_id <> old.creator_id;
  return old;
end $$;

create or replace trigger activity_deleted
  before delete on public.activities
  for each row execute function public.on_activity_deleted();
