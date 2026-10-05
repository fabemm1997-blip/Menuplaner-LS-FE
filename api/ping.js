export default async function handler(req, res) {
  try {
    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/app_settings?key=eq.ping&select=value`,
      {
        headers: {
          apikey: process.env.SUPABASE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
        },
      }
    );
    const ok = r.ok;
    // Update ping timestamp
    await fetch(`${process.env.SUPABASE_URL}/rest/v1/app_settings`, {
      method: "POST",
      headers: {
        apikey: process.env.SUPABASE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({ key: "ping", value: new Date().toISOString() }),
    });
    return res.status(200).json({ ok, pinged: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
