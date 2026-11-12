// Prépare les projets natifs générés par `npx cap add android|ios` :
//  - autorisations Android (localisation, micro, caméra)
//  - textes d'explication iOS (Info.plist, en français)
//  - numéro de build automatique (BUILD_NUMBER de Codemagic)
//  - signature Android via les variables Codemagic (CM_KEYSTORE_*)
// Utilisation : node scripts/configure-native.mjs
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const build = process.env.BUILD_NUMBER;
const log = (m) => console.log("• " + m);

// ───────────── Android ─────────────
const manifestPath = path.join(root, "android/app/src/main/AndroidManifest.xml");
if (fs.existsSync(manifestPath)) {
  let xml = fs.readFileSync(manifestPath, "utf8");
  const perms = [
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.CAMERA",
  ];
  let add = "";
  for (const p of perms) if (!xml.includes(p)) add += `    <uses-permission android:name="${p}" />\n`;
  if (!xml.includes("android.hardware.camera"))
    add += `    <uses-feature android:name="android.hardware.camera" android:required="false" />\n`;
  if (add) {
    xml = xml.replace(/<\/manifest>\s*$/, add + "</manifest>\n");
    fs.writeFileSync(manifestPath, xml);
    log("AndroidManifest : autorisations ajoutées");
  } else log("AndroidManifest : déjà à jour");
} else log("Android non généré (ignoré)");

const gradlePath = path.join(root, "android/app/build.gradle");
if (fs.existsSync(gradlePath)) {
  let g = fs.readFileSync(gradlePath, "utf8");
  if (build) {
    g = g.replace(/versionCode\s+\d+/, `versionCode ${build}`);
    log(`Android versionCode = ${build}`);
  }
  if (process.env.CM_KEYSTORE_PATH && !g.includes("signingConfigs.release")) {
    const signing = `
    signingConfigs {
        release {
            storeFile file(System.getenv("CM_KEYSTORE_PATH"))
            storePassword System.getenv("CM_KEYSTORE_PASSWORD")
            keyAlias System.getenv("CM_KEY_ALIAS")
            keyPassword System.getenv("CM_KEY_PASSWORD")
        }
    }
`;
    if (/buildTypes\s*\{\s*release\s*\{/.test(g)) {
      g = g.replace(/buildTypes\s*\{\s*release\s*\{/, `${signing.trim()}\n    buildTypes {\n        release {\n            signingConfig signingConfigs.release`);
      log("Android : signature de la version release configurée");
    } else {
      console.warn("⚠ Bloc buildTypes/release introuvable : signature Android non configurée");
    }
  }
  fs.writeFileSync(gradlePath, g);
}

// ───────────── iOS ─────────────
const plistPath = path.join(root, "ios/App/App/Info.plist");
if (fs.existsSync(plistPath)) {
  let plist = fs.readFileSync(plistPath, "utf8");
  const keys = {
    NSLocationWhenInUseUsageDescription: "GrouZ utilise ta position pour centrer la carte sur toi et te proposer des sorties et des personnes près de chez toi.",
    NSMicrophoneUsageDescription: "GrouZ utilise le micro pour enregistrer tes messages vocaux.",
    NSCameraUsageDescription: "GrouZ utilise l'appareil photo pour te permettre d'envoyer des photos et des vidéos dans tes messages.",
    NSPhotoLibraryUsageDescription: "GrouZ accède à tes photos pour que tu puisses choisir ta photo de profil et envoyer des photos et des vidéos.",
  };
  let add = "";
  for (const [k, v] of Object.entries(keys))
    if (!plist.includes(`<key>${k}</key>`)) add += `\t<key>${k}</key>\n\t<string>${v}</string>\n`;
  if (!plist.includes("<key>ITSAppUsesNonExemptEncryption</key>"))
    add += `\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n`;   // pas de chiffrement propriétaire
  if (add) {
    plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, add + "</dict>\n</plist>\n");
    fs.writeFileSync(plistPath, plist);
    log("Info.plist : textes d'autorisation ajoutés");
  } else log("Info.plist : déjà à jour");
} else log("iOS non généré (ignoré)");

const pbxPath = path.join(root, "ios/App/App.xcodeproj/project.pbxproj");
if (fs.existsSync(pbxPath) && build) {
  let pbx = fs.readFileSync(pbxPath, "utf8");
  pbx = pbx.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
  fs.writeFileSync(pbxPath, pbx);
  log(`iOS build = ${build}`);
}
console.log("✅ Configuration native terminée");
