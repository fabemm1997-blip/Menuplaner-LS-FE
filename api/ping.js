// Täglicher Vercel-Cron (vercel.json): hält das Supabase-Projekt im Gratis-Plan aktiv, damit es nicht
// pausiert. Eine Leseanfrage reicht als Lebenszeichen (ohne Login liefert RLS einfach eine leere Liste).
// URL und Publishable Key sind öffentlich und fest eingetragen – die Vercel-Variablen zeigten nicht
// auf dieses Projekt.
const SUPABASE_URL = "https://lsgjtbfogugaypcewvdm.supabase.co";
const SUPABASE_KEY = "sb_publishable_HDLUGvJCBCdES7lbF_CHLg_k0G7aUXi";

export default async function handler(req, res) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?select=key&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    return res.status(200).json({ ok: r.ok, status: r.status, pinged: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
