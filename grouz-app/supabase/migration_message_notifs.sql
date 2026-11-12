-- ════════════════════════════════════════════════════════════════
-- GrouZ — notification à chaque message privé reçu
-- À coller dans Supabase → SQL Editor → Run (une seule fois)
-- (nécessite d'avoir lancé migration_notif_links.sql avant)
-- ════════════════════════════════════════════════════════════════

alter table public.notifications add column if not exists kind text;
alter table public.notifications add column if not exists ref_id uuid;

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

-- Vérification : doit afficher une ligne "direct_message_notify"
select tgname from pg_trigger
where tgrelid = 'public.direct_messages'::regclass and not tgisinternal;
