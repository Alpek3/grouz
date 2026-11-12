# GrouZ — construire les applications iPhone et Android (sans Mac)

Tout se fait sur **codemagic.io**, qui fournit des Mac et des machines Android à la demande.
Le fichier `codemagic.yaml` décrit deux constructions : `ios-testflight` et `android-release`.

## 1. Compte Codemagic
1. codemagic.io → **Sign up** avec ton compte GitHub (dépôt `Alpek3/grouz`).
2. **Add application** → choisis le dépôt `grouz` → type « Capacitor / Ionic » ou « Other » → utilise le fichier **codemagic.yaml**.

## 2. Variables du site (groupe `grouz_env`)
Codemagic → **Teams → Global variables and secrets** (ou Environment variables du projet) → crée le groupe **grouz_env** avec :
- `VITE_SUPABASE_URL` = l'adresse de ton projet Supabase
- `VITE_SUPABASE_ANON_KEY` = ta clé publique `sb_publishable_…`
- `VITE_KLIPY_KEY` = ta clé Klipy (facultatif)

## 3. iPhone (nécessite le compte Apple Developer actif)
1. **App Store Connect** → Utilisateurs et accès → **Intégrations → Clés** → génère une clé API (rôle **App Manager**). Télécharge le fichier `.p8` (une seule fois), note le **Key ID** et l'**Issuer ID**.
2. Codemagic → **Teams → Integrations → App Store Connect** → ajoute la clé avec le nom **GrouZ** (le même que dans le yaml).
3. Dans App Store Connect → **Apps → +** → nouvelle app : nom GrouZ, langue française, identifiant `fr.grouz.app` (à enregistrer avant dans developer.apple.com → Identifiers si besoin).
4. Codemagic → lance le workflow **ios-testflight**. L'app arrive dans **TestFlight**, que tu installes ensuite sur ton iPhone.

## 4. Android
1. Codemagic → **Code signing identities → Android keystores** → génère un keystore nommé **grouz_keystore**. **Télécharge et conserve une copie** (sans lui, impossible de mettre à jour l'app).
2. Lance le workflow **android-release** : à la fin, tu télécharges le fichier **.aab** dans « Artifacts ».
3. Dans Google Play Console → ton app → **Test fermé** → crée une version → envoie le .aab → ajoute tes 12 testeurs.

## 5. Mises à jour
- Chaque build incrémente automatiquement le numéro de version (variable BUILD_NUMBER).
- Une modification du site (code dans `src/`) n'apparaît dans les apps qu'après un **nouveau build** et une nouvelle version envoyée aux stores.

## Si un build échoue
Ouvre le build dans Codemagic, déplie l'étape en rouge et envoie les dernières lignes d'erreur. Les premiers builds demandent souvent 1 à 3 ajustements : ce fichier n'a pas pu être testé sur un vrai Codemagic.
