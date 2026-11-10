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
