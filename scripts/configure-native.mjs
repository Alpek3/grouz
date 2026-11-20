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
    "android.permission.POST_NOTIFICATIONS",
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
    NSMicrophoneUsageDescription: "GrouZ utilise le micro pour tes messages vocaux et tes appels.",
    NSCameraUsageDescription: "GrouZ utilise l'appareil photo pour tes photos, vidéos et appels vidéo.",
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
// Notifications push iOS : mode d'arrière-plan, droit « aps-environment », initialisation Firebase
if (fs.existsSync(plistPath)) {
  let plist = fs.readFileSync(plistPath, "utf8");
  if (!plist.includes("<key>UIBackgroundModes</key>")) {
    plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, "\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>remote-notification</string>\n\t</array>\n</dict>\n</plist>\n");
    fs.writeFileSync(plistPath, plist);
    log("Info.plist : notifications en arrière-plan activées");
  }
}
const entPath = path.join(root, "ios/App/App/App.entitlements");
if (fs.existsSync(path.join(root, "ios/App"))) {
  fs.writeFileSync(entPath, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n\t<key>aps-environment</key>\n\t<string>production</string>\n</dict>\n</plist>\n`);
  if (fs.existsSync(pbxPath)) {
    let pbx = fs.readFileSync(pbxPath, "utf8");
    if (!pbx.includes("CODE_SIGN_ENTITLEMENTS")) {
      pbx = pbx.replace(/PRODUCT_BUNDLE_IDENTIFIER = fr\.grouz\.app;/g, "CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = fr.grouz.app;");
      fs.writeFileSync(pbxPath, pbx);
      log("iOS : droit Push Notifications ajouté");
    }
  }
  const adPath = path.join(root, "ios/App/App/AppDelegate.swift");
  if (fs.existsSync(adPath)) {
    let ad = fs.readFileSync(adPath, "utf8");
    if (!ad.includes("FirebaseCore")) {
      ad = ad.replace("import UIKit", "import UIKit\n#if canImport(FirebaseCore)\nimport FirebaseCore\n#endif");
      ad = ad.replace(/(didFinishLaunchingWithOptions[^{]*\{)/, "$1\n        #if canImport(FirebaseCore)\n        if FirebaseApp.app() == nil { FirebaseApp.configure() }\n        #endif");
      fs.writeFileSync(adPath, ad);
      log("AppDelegate : initialisation Firebase ajoutée");
    }
  }
}
console.log("✅ Configuration native terminée");
