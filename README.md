# GrouZ — mise en route

## 1. Base de données (une seule fois)
Supabase → SQL Editor → New query → colle `supabase/schema.sql` → Run.
Authentication → Providers → Email : désactive "Confirm email" pour tester.

## 2. Lancer en local
```
npm install   # à refaire si tu as déjà installé (nouvelle dépendance : leaflet)
npm run dev
```
Les clés Supabase sont déjà dans `.env` (clé publique uniquement).

## 3. Mettre en ligne (Vercel)
1. Envoie ce dossier sur GitHub (le `.env` est ignoré par git).
2. vercel.com → Add New → Project → choisis le dépôt.
3. Environment Variables : `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (mêmes valeurs que `.env`).
4. Deploy. Tu obtiens un lien HTTPS à partager (le micro l'exige).
5. Supabase → Authentication → URL Configuration → Site URL : colle ce lien.
