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
