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
