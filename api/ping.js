// Täglicher Vercel-Cron (vercel.json): hält das Supabase-Projekt im Gratis-Plan aktiv, damit es nicht
// pausiert. Eine Anfrage an den Auth-Dienst reicht als Lebenszeichen (Daten liegen im Schema «menu», anonym nicht lesbar).
// URL und Publishable Key sind öffentlich und fest eingetragen – die Vercel-Variablen zeigten nicht
// auf dieses Projekt.
const SUPABASE_URL = "https://bwnnhrhjvcrjidaqkkzf.supabase.co";
const SUPABASE_KEY = "sb_publishable_vE3lREJGQpdiSPmaj7zGmQ_PX1Gf-rN";

export default async function handler(req, res) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_KEY },
    });
    return res.status(200).json({ ok: r.ok, status: r.status, pinged: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
