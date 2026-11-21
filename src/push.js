// GrouZ — notifications push (Firebase Cloud Messaging), uniquement dans l'application native.
// Plugin natif : @capacitor-firebase/messaging (installé par Codemagic).
import { supabase } from "./api";

const cap = () => (typeof window !== "undefined" ? window.Capacitor : null);
export const isNative = () => !!cap()?.isNativePlatform?.();
let FM = null, currentToken = null, listening = false;

const DEBUG = true; // TEMPORAIRE : affiche l'étape/erreur à l'écran
const dbg = (m) => { if (DEBUG) { try { alert("Push : " + m); } catch {} } };

export async function initPush(userId) {
  if (!isNative()) return false;
  try {
    dbg("démarrage");
    FM = FM || cap().registerPlugin("FirebaseMessaging");
    const perm = await FM.requestPermissions();
    dbg("autorisation = " + perm.receive);
    if (perm.receive !== "granted") return false;
    const { token } = await FM.getToken();
    if (!token) { dbg("pas de token"); return false; }
    dbg("token reçu");
    currentToken = token;
    const up = await supabase.from("push_tokens").upsert({ token, user_id: userId, platform: cap().getPlatform?.(), updated_at: new Date().toISOString() }, { onConflict: "token" });
    dbg(up.error ? "erreur Supabase : " + up.error.message : "token enregistré OK");
    if (!listening) {
      listening = true;
      FM.addListener("tokenReceived", async (e) => {                      // le jeton a changé
        if (!e?.token) return;
        currentToken = e.token;
        await supabase.from("push_tokens").upsert({ token: e.token, user_id: userId, platform: cap().getPlatform?.(), updated_at: new Date().toISOString() }, { onConflict: "token" });
      });
      FM.addListener("notificationActionPerformed", (e) => {              // l'utilisateur a touché la notification
        const d = e?.notification?.data || {};
        window.dispatchEvent(new CustomEvent("grouz:push", { detail: { kind: d.kind || null, ref_id: d.ref_id || null, id: d.notif_id || null } }));
      });
    }
    return true;
  } catch (e) { console.warn("push", e); dbg("ERREUR : " + (e?.message || JSON.stringify(e))); return false; }
}

export async function removePushToken() {
  try { if (currentToken) await supabase.from("push_tokens").delete().eq("token", currentToken); } catch {}
  currentToken = null;
}
