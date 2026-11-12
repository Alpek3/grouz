// Recherche de GIFs. Tenor a fermé son API en juin 2026 : on utilise KLIPY (gratuit),
// avec GIPHY en secours. Ajoute VITE_KLIPY_KEY (ou VITE_GIPHY_KEY) dans .env / Vercel.
const KLIPY = import.meta.env.VITE_KLIPY_KEY;
const GIPHY = import.meta.env.VITE_GIPHY_KEY;

export const gifsEnabled = !!(KLIPY || GIPHY);
export const gifProvider = KLIPY ? "KLIPY" : GIPHY ? "GIPHY" : null;

// KLIPY : item.file.{hd|md|sm|xs}.{gif|webp|...}.url — on cherche le meilleur format dispo
const klipyPick = (item, sizes, formats) => {
  const f = item?.file || {};
  for (const sz of sizes) for (const fm of formats) { const u = f?.[sz]?.[fm]?.url; if (u) return u; }
  return null;
};

export async function searchGifs(q, userId) {
  if (KLIPY) {
    const base = `https://api.klipy.com/api/v1/${KLIPY}/gifs/`;
    const common = `page=1&per_page=24&customer_id=${encodeURIComponent(userId || "anon")}`;
    const url = q ? `${base}search?q=${encodeURIComponent(q)}&${common}` : `${base}trending?${common}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("KLIPY " + r.status);
    const j = await r.json();
    return (j?.data?.data || [])
      .map(it => ({
        id: it.id ?? it.slug,
        thumb: klipyPick(it, ["sm", "xs", "md"], ["gif", "webp"]),
        url: klipyPick(it, ["md", "sm", "hd"], ["gif", "webp"]),
        title: it.title || "",
      }))
      .filter(g => g.thumb && g.url);
  }
  if (GIPHY) {
    const base = "https://api.giphy.com/v1/gifs/";
    const url = q
      ? `${base}search?api_key=${GIPHY}&q=${encodeURIComponent(q)}&limit=24&rating=pg&lang=fr`
      : `${base}trending?api_key=${GIPHY}&limit=24&rating=pg`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("GIPHY " + r.status);
    const j = await r.json();
    return (j.data || []).map(g => ({
      id: g.id,
      thumb: g.images?.fixed_width_small?.url || g.images?.fixed_width?.url,
      url: g.images?.fixed_height?.url || g.images?.original?.url,
      title: g.title || "",
    })).filter(g => g.thumb && g.url);
  }
  return [];
}
