// Gemeinsamer Login-Check für die API-Routen (Dateien mit _ sind auf Vercel keine eigene Route).
// Erwartet «Authorization: Bearer <Supabase-Access-Token>» eines angemeldeten Nutzers und prüft ihn
// bei Supabase. Ohne gültigen Login: 401 – so kann niemand die Routen auf unsere Kosten nutzen.
const SUPABASE_URL = process.env.SUPABASE_URL || "https://lsgjtbfogugaypcewvdm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_HDLUGvJCBCdES7lbF_CHLg_k0G7aUXi";

export async function requireUser(req, res) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
      if (r.ok) return await r.json();
    } catch {}
  }
  res.status(401).json({ success: false, error: { type: "unauthorized", message: "Nicht angemeldet" } });
  return null;
}
