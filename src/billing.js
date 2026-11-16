// GrouZ — abonnements via RevenueCat (Google Play Billing + Apple In-App Purchase)
// Fonctionne uniquement dans l'application native (Android / iOS). Sur le web : pas d'achat.
// Variables : VITE_RC_ANDROID_KEY (clé publique Android "goog_...") et VITE_RC_IOS_KEY (clé iOS "appl_...")
const cap = () => (typeof window !== "undefined" ? window.Capacitor : null);
export const isNative = () => !!cap()?.isNativePlatform?.();
const platform = () => cap()?.getPlatform?.();

let Purchases = null;
let ready = false;

export const ENTITLEMENT = "premium";

export async function initBilling(userId) {
  if (!isNative()) return false;
  const apiKey = platform() === "ios" ? import.meta.env.VITE_RC_IOS_KEY : import.meta.env.VITE_RC_ANDROID_KEY;
  if (!apiKey) return false;
  try {
    Purchases = cap().registerPlugin("Purchases");           // plugin natif @revenuecat/purchases-capacitor
    await Purchases.configure({ apiKey, appUserID: userId }); // l'identifiant RevenueCat = l'identifiant Supabase
    ready = true;
    return true;
  } catch (e) { console.warn("billing init", e); return false; }
}

export const billingReady = () => ready;

// Renvoie le forfait à vendre : { id, title, price, period, raw }
export async function getPremiumPackage() {
  if (!ready) return null;
  const offerings = await Purchases.getOfferings();
  const pkg = offerings?.current?.availablePackages?.[0];
  if (!pkg) return null;
  const p = pkg.product || {};
  return { id: pkg.identifier, title: p.title, price: p.priceString, raw: pkg };
}

const isActive = (info) => !!info?.customerInfo?.entitlements?.active?.[ENTITLEMENT] || !!info?.entitlements?.active?.[ENTITLEMENT];

// true si l'achat est validé ; false si annulé par l'utilisateur
export async function buyPremium(pkg) {
  try {
    const res = await Purchases.purchasePackage({ aPackage: pkg.raw });
    return isActive(res);
  } catch (e) {
    if (e?.userCancelled || /cancel/i.test(e?.message || "")) return false;
    throw e;
  }
}

export async function restorePurchases() {
  if (!ready) return false;
  const res = await Purchases.restorePurchases();
  return isActive(res);
}

export const manageSubscriptionUrl = () =>
  platform() === "ios" ? "https://apps.apple.com/account/subscriptions" : "https://play.google.com/store/account/subscriptions";
