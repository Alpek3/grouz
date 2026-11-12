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
