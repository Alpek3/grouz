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
