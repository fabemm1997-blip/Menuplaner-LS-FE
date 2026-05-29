import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = "https://lsgjtbfogugaypcewvdm.supabase.co";
const SUPABASE_KEY = "sb_publishable_HDLUGvJCBCdES7lbF_CHLg_k0G7aUXi";

// ── Supabase ─────────────────────────────────────────────────────────────────
const sb = {
  headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  async signUp(email, password) { return (await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method: "POST", headers: this.headers, body: JSON.stringify({ email, password }) })).json(); },
  async signIn(email, password) { return (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: this.headers, body: JSON.stringify({ email, password }) })).json(); },
  async signOut(token) { await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { ...this.headers, Authorization: `Bearer ${token}` } }); },
  async refreshToken(refreshToken) { return (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: this.headers, body: JSON.stringify({ refresh_token: refreshToken }) })).json(); },
  authHeaders(token) { return { ...this.headers, Authorization: `Bearer ${token}` }; },
  async getMeals(token, weekStart) { return (await fetch(`${SUPABASE_URL}/rest/v1/meals?week_start=eq.${weekStart}&select=*`, { headers: this.authHeaders(token) })).json(); },
  async upsertMeal(token, meal) { return (await fetch(`${SUPABASE_URL}/rest/v1/meals`, { method: "POST", headers: { ...this.authHeaders(token), Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(meal) })).json(); },
  async deleteMeal(token, id) { await fetch(`${SUPABASE_URL}/rest/v1/meals?id=eq.${id}`, { method: "DELETE", headers: this.authHeaders(token) }); },
  async getShoppingItems(token, weekStart) { return (await fetch(`${SUPABASE_URL}/rest/v1/shopping_items?week_start=eq.${weekStart}&select=*&order=category,name`, { headers: this.authHeaders(token) })).json(); },
  async upsertShoppingItem(token, item) { return (await fetch(`${SUPABASE_URL}/rest/v1/shopping_items`, { method: "POST", headers: { ...this.authHeaders(token), Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(item) })).json(); },
  async deleteShoppingItem(token, id) { await fetch(`${SUPABASE_URL}/rest/v1/shopping_items?id=eq.${id}`, { method: "DELETE", headers: this.authHeaders(token) }); },
  async updateShoppingItem(token, id, updates) { return (await fetch(`${SUPABASE_URL}/rest/v1/shopping_items?id=eq.${id}`, { method: "PATCH", headers: { ...this.authHeaders(token), Prefer: "return=representation" }, body: JSON.stringify(updates) })).json(); },
  async getPdfLibrary(token) { return (await fetch(`${SUPABASE_URL}/rest/v1/pdf_library?select=*&order=name`, { headers: this.authHeaders(token) })).json(); },
  async savePdfToLibrary(token, item) { return (await fetch(`${SUPABASE_URL}/rest/v1/pdf_library`, { method: "POST", headers: { ...this.authHeaders(token), Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(item) })).json(); },
};

// ── Claude API ───────────────────────────────────────────────────────────────
async function callClaude(prompt, pdfBase64 = null) {
  const messages = pdfBase64
    ? [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } }, { type: "text", text: prompt }] }]
    : [{ role: "user", content: prompt }];
  const r = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ max_tokens: 2000, messages }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return d.content?.map(b => b.text || "").join("") || "";
}

function parseJSON(raw) {
  let s = raw.replace(/```json|```/gi, "").trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Kein JSON-Array gefunden in: " + s.slice(0, 200));
  return JSON.parse(s.slice(start, end + 1));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const SLOTS = ["morgen", "mittag", "abend"];
const SLOT_LABELS = { morgen: "☀️ Morgen", mittag: "🌤 Mittag", abend: "🌙 Abend" };
const UNITS = ["Stk.", "g", "kg", "ml", "l", "EL", "TL", "Bund", "Prise", "Pkg.", "Dose", ""];
const CATS = ["Gemüse & Früchte", "Fleisch & Fisch", "Milchprodukte", "Getreide & Backwaren", "Hülsenfrüchte", "Gewürze & Saucen", "Konserven", "Tiefkühl", "Sonstiges"];

function getMonday(d) {
  const date = new Date(d); const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day)); date.setHours(0,0,0,0); return date;
}
function weekKey(d) { return d.toISOString().split("T")[0]; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function fmt(d) { return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" }); }
function emptyRecipe() { return { id: Date.now() + Math.random(), type: "link", name: "", link: "", pdf_name: "", pdf_base64: "", recipe_persons: 2 }; }

// ── Token storage with refresh token ─────────────────────────────────────────
function saveSession(session) {
  localStorage.setItem("mp_token", session.access_token);
  localStorage.setItem("mp_refresh", session.refresh_token || "");
  localStorage.setItem("mp_expires", String(Date.now() + (session.expires_in || 3600) * 1000));
}
function clearSession() {
  localStorage.removeItem("mp_token");
  localStorage.removeItem("mp_refresh");
  localStorage.removeItem("mp_expires");
}
function getStoredToken() { return localStorage.getItem("mp_token"); }
function getStoredRefresh() { return localStorage.getItem("mp_refresh"); }
function isTokenExpired() {
  const exp = parseInt(localStorage.getItem("mp_expires") || "0");
  return Date.now() > exp - 60000; // refresh 1 min before expiry
}

// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [token, setToken] = useState(() => getStoredToken());
  const [page, setPage] = useState("plan");
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [meals, setMeals] = useState([]);
  const [shopping, setShopping] = useState([]);
  const [pdfLibrary, setPdfLibrary] = useState([]);
  const [loading, setLoading] = useState(false);
  const wk = weekKey(weekStart);

  // Auto-refresh token
  async function getValidToken() {
    if (!isTokenExpired()) return token;
    const refresh = getStoredRefresh();
    if (!refresh) { clearSession(); setToken(null); return null; }
    try {
      const data = await sb.refreshToken(refresh);
      if (data.access_token) {
        saveSession(data);
        setToken(data.access_token);
        return data.access_token;
      }
    } catch {}
    clearSession(); setToken(null); return null;
  }

  const loadMeals = useCallback(async () => {
    if (!token) return;
    const t = await getValidToken();
    if (!t) return;
    const data = await sb.getMeals(t, wk);
    if (Array.isArray(data)) setMeals(data);
    else if (data?.code === "PGRST301" || data?.message?.includes("401")) { clearSession(); setToken(null); }
  }, [token, wk]);

  const loadShopping = useCallback(async () => {
    if (!token) return;
    const t = await getValidToken();
    if (!t) return;
    const data = await sb.getShoppingItems(t, wk);
    if (Array.isArray(data)) setShopping(data);
  }, [token, wk]);

  const loadPdfLibrary = useCallback(async () => {
    if (!token) return;
    const t = await getValidToken();
    if (!t) return;
    const data = await sb.getPdfLibrary(t);
    if (Array.isArray(data)) setPdfLibrary(data);
  }, [token]);

  useEffect(() => { loadMeals(); }, [loadMeals]);
  useEffect(() => { loadShopping(); }, [loadShopping]);
  useEffect(() => { loadPdfLibrary(); }, [loadPdfLibrary]);

  function getMeal(dayIdx, slot) {
    if (slot === "mittag") {
      const prev = meals.find(m => m.day_index === dayIdx - 1 && m.slot === "abend" && m.also_next_lunch);
      const direct = meals.find(m => m.day_index === dayIdx && m.slot === slot);
      if (prev && !direct) return { ...prev, _inherited: true, day_index: dayIdx, slot: "mittag" };
    }
    return meals.find(m => m.day_index === dayIdx && m.slot === slot) || null;
  }

  async function saveMeal(dayIdx, slot, updates) {
    const t = await getValidToken(); if (!t) return;
    const existing = meals.find(m => m.day_index === dayIdx && m.slot === slot);
    const meal = { week_start: wk, day_index: dayIdx, slot, persons: 2, also_next_lunch: false, recipes: "[]", ...(existing || {}), ...updates };
    if (existing?.id) meal.id = existing.id;
    await sb.upsertMeal(t, meal);
    await loadMeals();
  }

  async function removeMeal(dayIdx, slot) {
    const t = await getValidToken(); if (!t) return;
    const m = meals.find(m => m.day_index === dayIdx && m.slot === slot);
    if (m?.id) { await sb.deleteMeal(t, m.id); await loadMeals(); }
  }

  async function generateShoppingList() {
    setLoading(true);
    try {
      const t = await getValidToken(); if (!t) { setLoading(false); return; }
      const mealsWithContent = meals.filter(m => { try { return JSON.parse(m.recipes || "[]").length > 0; } catch { return false; } });
      if (!mealsWithContent.length) { alert("Keine Menüs diese Woche erfasst."); setLoading(false); return; }

      const lines = [];
      for (const m of mealsWithContent) {
        const recipes = JSON.parse(m.recipes || "[]");
        const servings = m.persons || 2;
        for (const rec of recipes) {
          const recipePax = rec.recipe_persons || 2;
          const name = rec.name || rec.pdf_name || "Unbenanntes Rezept";
          const src = rec.link ? `Link: ${rec.link}` : rec.pdf_name ? `PDF: ${rec.pdf_name}` : "";
          lines.push(`- ${DAYS[m.day_index]} ${SLOT_LABELS[m.slot]}: "${name}" – Rezept für ${recipePax} Personen, kochen für ${servings} Personen${src ? ` (${src})` : ""}`);
        }
      }

      const prompt = `Du bist ein Schweizer Kochassistent. Erstelle eine vollständige Einkaufsliste. Skaliere Zutaten von "Rezept für X Personen" auf "kochen für Y Personen".

${lines.join("\n")}

Antworte AUSSCHLIESSLICH mit einem JSON-Array, kein Text davor/danach, kein Markdown:
[{"name":"Zutat","amount":"200","unit":"g","category":"Gemüse & Früchte"}]

Kategorien: Gemüse & Früchte, Fleisch & Fisch, Milchprodukte, Getreide & Backwaren, Hülsenfrüchte, Gewürze & Saucen, Konserven, Tiefkühl, Sonstiges
Einheiten: g, kg, ml, l, Stk., EL, TL, Bund, Prise, Pkg., Dose
"amount" = nur die Zahl als String. Gleiche Zutaten zusammenfassen.`;

      const raw = await callClaude(prompt);
      const items = parseJSON(raw);

      for (const s of shopping.filter(s => !s.manual)) await sb.deleteShoppingItem(t, s.id);
      for (const item of items) {
        await sb.upsertShoppingItem(t, { week_start: wk, name: item.name, amount: String(item.amount ?? ""), unit: item.unit || "", category: item.category || "Sonstiges", checked: false, manual: false });
      }
      await loadShopping();
      setPage("shopping");
    } catch (e) { alert("Fehler beim Generieren: " + e.message); }
    setLoading(false);
  }

  if (!token) return <LoginPage onLogin={(session) => { saveSession(session); setToken(session.access_token); }} />;

  return (
    <div style={styles.app}>
      <style>{globalCss}</style>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logo}><span>🥗</span><span style={styles.logoText}>Menüplaner</span></div>
          <nav style={styles.nav}>
            <button style={{ ...styles.navBtn, ...(page === "plan" ? styles.navActive : {}) }} onClick={() => setPage("plan")}>📅 Wochenplan</button>
            <button style={{ ...styles.navBtn, ...(page === "shopping" ? styles.navActive : {}) }} onClick={() => setPage("shopping")}>🛒 Einkaufsliste</button>
          </nav>
          <button style={styles.logoutBtn} onClick={async () => { await sb.signOut(token); clearSession(); setToken(null); }}>Abmelden</button>
        </div>
      </header>
      <main style={styles.main}>
        {page === "plan"
          ? <PlanPage weekStart={weekStart} setWeekStart={setWeekStart} getMeal={getMeal} saveMeal={saveMeal} removeMeal={removeMeal} generateShoppingList={generateShoppingList} loading={loading} pdfLibrary={pdfLibrary} token={token} loadPdfLibrary={loadPdfLibrary} getValidToken={getValidToken} />
          : <ShoppingPage shopping={shopping} token={token} wk={wk} loadShopping={loadShopping} sb={sb} getValidToken={getValidToken} />}
      </main>
    </div>
  );
}

// ── Login ─────────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function handle() {
    setErr(""); setLoading(true);
    try {
      const data = await (mode === "login" ? sb.signIn(email, pw) : sb.signUp(email, pw));
      if (data.access_token) onLogin(data);
      else if (data.error_description || data.msg) setErr(data.error_description || data.msg);
      else if (mode === "signup") { setErr("Registrierung erfolgreich! Bitte einloggen."); setMode("login"); }
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }

  return (
    <div style={styles.loginWrap}><style>{globalCss}</style>
      <div style={styles.loginCard}>
        <div style={{ fontSize: 48, textAlign: "center" }}>🥗</div>
        <h1 style={styles.loginTitle}>Menüplaner</h1>
        <p style={{ textAlign: "center", color: C.muted, fontSize: 14, marginTop: -8 }}>Für euch zwei 💑</p>
        <div style={styles.loginTabs}>
          <button style={{ ...styles.tab, ...(mode === "login" ? styles.tabActive : {}) }} onClick={() => setMode("login")}>Anmelden</button>
          <button style={{ ...styles.tab, ...(mode === "signup" ? styles.tabActive : {}) }} onClick={() => setMode("signup")}>Registrieren</button>
        </div>
        <input style={styles.input} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} />
        <input style={styles.input} type="password" placeholder="Passwort" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} />
        {err && <p style={{ color: C.danger, fontSize: 12, textAlign: "center" }}>{err}</p>}
        <button style={styles.primaryBtn} onClick={handle} disabled={loading}>{loading ? "⏳…" : mode === "login" ? "Anmelden" : "Registrieren"}</button>
      </div>
    </div>
  );
}

// ── Plan Page ─────────────────────────────────────────────────────────────────
function PlanPage({ weekStart, setWeekStart, getMeal, saveMeal, removeMeal, generateShoppingList, loading, pdfLibrary, token, loadPdfLibrary, getValidToken }) {
  const [editCell, setEditCell] = useState(null);
  return (
    <div>
      <div style={styles.weekNav}>
        <button style={styles.weekBtn} onClick={() => setWeekStart(addDays(weekStart, -7))}>← Vorwoche</button>
        <span style={styles.weekLabel}>{fmt(weekStart)} – {fmt(addDays(weekStart, 6))}</span>
        <button style={styles.weekBtn} onClick={() => setWeekStart(addDays(weekStart, 7))}>Nächste Woche →</button>
      </div>
      <div style={styles.daysGrid}>
        {DAYS.map((day, i) => {
          const date = addDays(weekStart, i);
          const isToday = fmt(date) === fmt(new Date());
          return (
            <div key={i} style={{ ...styles.dayCol, ...(isToday ? styles.dayColToday : {}) }}>
              <div style={styles.dayHeader}>
                <span style={styles.dayName}>{day}</span>
                <span style={styles.dayDate}>{fmt(date)}</span>
              </div>
              {SLOTS.map(slot => {
                const meal = getMeal(i, slot);
                const isEdit = editCell?.dayIdx === i && editCell?.slot === slot;
                return <MealTile key={slot} slot={slot} meal={meal} isEdit={isEdit}
                  onEdit={() => setEditCell(isEdit ? null : { dayIdx: i, slot })}
                  onSave={(u) => { saveMeal(i, slot, u); setEditCell(null); }}
                  onRemove={() => removeMeal(i, slot)}
                  pdfLibrary={pdfLibrary} token={token} loadPdfLibrary={loadPdfLibrary} getValidToken={getValidToken} />;
              })}
            </div>
          );
        })}
      </div>
      <div style={styles.generateWrap}>
        <button style={styles.generateBtn} onClick={generateShoppingList} disabled={loading}>
          {loading ? "⏳ KI generiert Liste…" : "🛒 Einkaufsliste generieren"}
        </button>
      </div>
    </div>
  );
}

// ── Meal Tile ─────────────────────────────────────────────────────────────────
function MealTile({ slot, meal, isEdit, onEdit, onSave, onRemove, pdfLibrary, token, loadPdfLibrary, getValidToken }) {
  const [persons, setPersons] = useState(meal?.persons ?? 2);
  const [alsoLunch, setAlsoLunch] = useState(meal?.also_next_lunch ?? false);
  const [recipes, setRecipes] = useState(() => { try { return JSON.parse(meal?.recipes || "[]"); } catch { return []; } });

  useEffect(() => {
    setPersons(meal?.persons ?? 2);
    setAlsoLunch(meal?.also_next_lunch ?? false);
    try { setRecipes(JSON.parse(meal?.recipes || "[]")); } catch { setRecipes([]); }
  }, [meal?.id, isEdit]);

  function addRecipe() { setRecipes(r => [...r, emptyRecipe()]); }
  function removeRecipe(id) { setRecipes(r => r.filter(x => x.id !== id)); }
  function updateRecipe(id, field, value) { setRecipes(r => r.map(x => x.id === id ? { ...x, [field]: value } : x)); }

  async function handlePdf(id, file) {
    if (!file) return;
    updateRecipe(id, "pdf_name", file.name);
    const base64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
    updateRecipe(id, "pdf_base64", base64);
    updateRecipe(id, "type", "pdf");
    try { const t = await getValidToken(); if (t) await sb.savePdfToLibrary(t, { name: file.name, pdf_base64: base64 }); await loadPdfLibrary(); } catch {}
    try { const raw = await callClaude("Extrahiere den Menünamen aus diesem Rezept-PDF. Antworte NUR mit dem Namen des Gerichts.", base64); updateRecipe(id, "name", raw.trim()); } catch {}
  }

  function openPdf(rec) {
    if (!rec.pdf_base64) return;
    const b = atob(rec.pdf_base64), arr = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
    window.open(URL.createObjectURL(new Blob([arr], { type: "application/pdf" })), "_blank");
  }

  const isInherited = meal?._inherited;
  const hasContent = recipes.length > 0;

  return (
    <div style={{ ...styles.tile, ...(hasContent ? styles.tileActive : {}), ...(isInherited ? styles.tileInherited : {}) }}>
      <div style={styles.tileHeader}>
        <span style={styles.slotLabel}>{SLOT_LABELS[slot]}</span>
        <div style={styles.tileActions}>
          {hasContent && !isEdit && !isInherited && <button style={styles.iconBtn} onClick={onRemove}>✕</button>}
          {!isInherited && <button style={styles.iconBtn} onClick={onEdit}>{isEdit ? "✓" : hasContent ? "✎" : "+"}</button>}
        </div>
      </div>

      {!isEdit && hasContent && (
        <div style={styles.mealInfo}>
          {isInherited && <div style={styles.inheritedBadge}>↑ vom Vorabend</div>}
          {recipes.map((rec, i) => (
            <div key={rec.id || i} style={styles.recipeRow}>
              {rec.name && <div style={styles.mealName}>{rec.name}</div>}
              {rec.pdf_name && <button onClick={() => openPdf(rec)} style={styles.pdfOpenBtn}>📄 {rec.pdf_name}</button>}
              {rec.link && <a href={rec.link} target="_blank" rel="noopener noreferrer" style={styles.mealLink} onClick={e => { e.preventDefault(); window.open(rec.link, "_blank", "noopener,noreferrer"); }}>🔗 Rezept öffnen</a>}
            </div>
          ))}
          <div style={styles.mealMeta}>
            👥 {meal?.persons ?? 2} {(meal?.persons ?? 2) === 1 ? "Person" : "Personen"}
            {meal?.also_next_lunch && <span style={styles.lunchBadge}>→ morgen Mittag</span>}
          </div>
        </div>
      )}

      {isEdit && (
        <div style={styles.editForm}>
          {recipes.map((rec, i) => (
            <div key={rec.id} style={styles.recipeBlock}>
              <div style={styles.recipeBlockHeader}>
                <span style={styles.recipeNum}>Rezept {i + 1}</span>
                <button style={styles.removeRecipeBtn} onClick={() => removeRecipe(rec.id)}>✕</button>
              </div>
              <input style={styles.tileInput} placeholder="Name des Gerichts" value={rec.name} onChange={e => updateRecipe(rec.id, "name", e.target.value)} />
              <div style={styles.modeTabs}>
                {["link", "pdf", "library"].map(t => (
                  <button key={t} style={{ ...styles.modeTab, ...(rec.type === t ? styles.modeTabActive : {}) }} onClick={() => updateRecipe(rec.id, "type", t)}>
                    {t === "link" ? "🔗 Link" : t === "pdf" ? "📤 PDF" : "📚 Gespeichert"}
                  </button>
                ))}
              </div>
              {rec.type === "link" && <input style={styles.tileInput} placeholder="https://fooby.ch/..." value={rec.link} onChange={e => updateRecipe(rec.id, "link", e.target.value)} />}
              {rec.type === "pdf" && (
                <label style={styles.pdfLabel}>
                  <span style={styles.pdfBtn}>{rec.pdf_name || "📄 PDF auswählen…"}</span>
                  <input type="file" accept=".pdf" onChange={e => handlePdf(rec.id, e.target.files[0])} style={{ display: "none" }} />
                </label>
              )}
              {rec.type === "library" && (
                <select style={styles.tileSelect} onChange={e => {
                  const item = pdfLibrary.find(p => p.id === e.target.value);
                  if (item) { updateRecipe(rec.id, "pdf_name", item.name); updateRecipe(rec.id, "pdf_base64", item.pdf_base64); if (!rec.name) updateRecipe(rec.id, "name", item.name.replace(".pdf", "")); }
                }} defaultValue="">
                  <option value="" disabled>Gespeichertes Rezept wählen…</option>
                  {pdfLibrary.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <div style={styles.personRow}>
                <span style={styles.personLabel}>📄 Rezept für:</span>
                <button style={styles.countBtn} onClick={() => updateRecipe(rec.id, "recipe_persons", Math.max(1, (rec.recipe_persons || 2) - 1))}>−</button>
                <span style={styles.personCount}>{rec.recipe_persons || 2}</span>
                <button style={styles.countBtn} onClick={() => updateRecipe(rec.id, "recipe_persons", (rec.recipe_persons || 2) + 1)}>+</button>
                <span style={styles.personLabel}>Pers.</span>
              </div>
            </div>
          ))}
          <button style={styles.addRecipeBtn} onClick={addRecipe}>+ Rezept hinzufügen</button>
          <div style={{ ...styles.personRow, marginTop: 4 }}>
            <span style={styles.personLabel}>👥 Kochen für:</span>
            <button style={styles.countBtn} onClick={() => setPersons(Math.max(1, persons - 1))}>−</button>
            <span style={styles.personCount}>{persons}</span>
            <button style={styles.countBtn} onClick={() => setPersons(persons + 1)}>+</button>
            <span style={styles.personLabel}>Pers.</span>
          </div>
          {slot === "abend" && (
            <label style={styles.checkLabel}>
              <input type="checkbox" checked={alsoLunch} onChange={e => setAlsoLunch(e.target.checked)} style={{ marginRight: 6 }} />
              Auch morgen Mittag
            </label>
          )}
          <button style={styles.saveBtn} onClick={() => onSave({ persons, also_next_lunch: alsoLunch, recipes: JSON.stringify(recipes) })}>Speichern</button>
        </div>
      )}
    </div>
  );
}

// ── Shopping Page ─────────────────────────────────────────────────────────────
function ShoppingPage({ shopping, token, wk, loadShopping, sb, getValidToken }) {
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newCat, setNewCat] = useState("Sonstiges");

  const grouped = CATS.reduce((acc, cat) => {
    const items = shopping.filter(s => s.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  async function getT() { return await getValidToken(); }
  async function toggleCheck(item) { const t = await getT(); if (t) { await sb.updateShoppingItem(t, item.id, { checked: !item.checked }); await loadShopping(); } }
  async function updateField(item, field, value) { const t = await getT(); if (t) { await sb.updateShoppingItem(t, item.id, { [field]: value }); await loadShopping(); } }
  async function deleteItem(id) { const t = await getT(); if (t) { await sb.deleteShoppingItem(t, id); await loadShopping(); } }
  async function addItem() {
    if (!newName.trim()) return;
    const t = await getT(); if (!t) return;
    await sb.upsertShoppingItem(t, { week_start: wk, name: newName.trim(), amount: newAmount, unit: newUnit, category: newCat, checked: false, manual: true });
    setNewName(""); setNewAmount(""); setNewUnit(""); await loadShopping();
  }

  const total = shopping.length, done = shopping.filter(s => s.checked).length;

  return (
    <div style={styles.shoppingWrap}>
      <div style={styles.progressCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={styles.progressLabel}>Einkaufsliste</span>
          <span style={{ color: C.muted, fontSize: 13 }}>{done} / {total} erledigt</span>
        </div>
        <div style={styles.progressBar}><div style={{ ...styles.progressFill, width: total ? `${(done/total)*100}%` : "0%" }} /></div>
      </div>
      <div style={styles.addCard}>
        <input style={{ ...styles.input, marginBottom: 0, flex: 1, minWidth: 100 }} placeholder="Zutat…" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addItem()} />
        <input style={{ ...styles.input, marginBottom: 0, width: 65 }} placeholder="Menge" value={newAmount} onChange={e => setNewAmount(e.target.value)} />
        <select style={styles.select} value={newUnit} onChange={e => setNewUnit(e.target.value)}>
          {UNITS.map(u => <option key={u} value={u}>{u || "Einheit"}</option>)}
        </select>
        <select style={styles.select} value={newCat} onChange={e => setNewCat(e.target.value)}>
          {CATS.map(c => <option key={c}>{c}</option>)}
        </select>
        <button style={styles.addBtn} onClick={addItem}>+ Hinzufügen</button>
      </div>
      {Object.keys(grouped).length === 0 && (
        <div style={styles.emptyState}><div style={{ fontSize: 48, marginBottom: 12 }}>🛒</div><p>Noch keine Einträge. Menüs erfassen und Einkaufsliste generieren!</p></div>
      )}
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} style={styles.catSection}>
          <div style={styles.catHeader}>{cat}</div>
          {items.map(item => (
            <div key={item.id} style={{ ...styles.shoppingItem, ...(item.checked ? styles.shoppingItemDone : {}) }}>
              <button style={{ ...styles.checkCircle, ...(item.checked ? styles.checkCircleDone : {}) }} onClick={() => toggleCheck(item)}>{item.checked ? "✓" : ""}</button>
              <span style={{ ...styles.itemName, ...(item.checked ? styles.strikethrough : {}) }}>{item.name}</span>
              <input style={styles.amountInput} value={item.amount || ""} onChange={e => updateField(item, "amount", e.target.value)} placeholder="Menge" />
              <select style={styles.unitSelect} value={item.unit || ""} onChange={e => updateField(item, "unit", e.target.value)}>
                {UNITS.map(u => <option key={u} value={u}>{u || "–"}</option>)}
              </select>
              <button style={styles.deleteItemBtn} onClick={() => deleteItem(item.id)}>✕</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const C = { bg: "#0f1117", surface: "#1a1d27", card: "#22263a", border: "#2e3250", accent: "#6c8fff", accentGlow: "rgba(108,143,255,0.15)", green: "#4caf82", text: "#e8eaf6", muted: "#8b90b0", danger: "#ff6b6b", today: "rgba(108,143,255,0.08)", inherited: "rgba(76,175,130,0.06)" };

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${C.bg}; color: ${C.text}; font-family: 'DM Sans', sans-serif; }
  ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${C.bg}; } ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
  input, select { color: ${C.text}; background: ${C.surface}; } input::placeholder { color: ${C.muted}; }
`;

const styles = {
  app: { minHeight: "100vh", background: C.bg },
  header: { position: "sticky", top: 0, zIndex: 100, background: C.surface, borderBottom: `1px solid ${C.border}` },
  headerInner: { maxWidth: 1200, margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", gap: 16 },
  logo: { display: "flex", alignItems: "center", gap: 10, marginRight: "auto", fontSize: 24 },
  logoText: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300, letterSpacing: "-0.5px" },
  nav: { display: "flex", gap: 8 },
  navBtn: { padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  navActive: { background: C.accentGlow, border: `1px solid ${C.accent}`, color: C.accent },
  logoutBtn: { padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 12, fontFamily: "inherit" },
  main: { maxWidth: 1200, margin: "0 auto", padding: "24px 16px" },
  weekNav: { display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 24 },
  weekBtn: { padding: "8px 18px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  weekLabel: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 300, minWidth: 180, textAlign: "center" },
  daysGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 },
  dayCol: { minWidth: 130, background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 8, display: "flex", flexDirection: "column", gap: 6 },
  dayColToday: { border: `1px solid ${C.accent}`, background: C.today },
  dayHeader: { padding: "4px 4px 8px", borderBottom: `1px solid ${C.border}`, marginBottom: 2 },
  dayName: { display: "block", fontSize: 12, fontWeight: 600, letterSpacing: "0.5px" },
  dayDate: { display: "block", fontSize: 11, color: C.muted, marginTop: 2 },
  tile: { background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 8, minHeight: 60 },
  tileActive: { background: "#1e2235" },
  tileInherited: { background: C.inherited, border: `1px dashed ${C.green}` },
  tileHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  slotLabel: { fontSize: 10, color: C.muted, fontWeight: 500 },
  tileActions: { display: "flex", gap: 4 },
  iconBtn: { width: 20, height: 20, borderRadius: 4, border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
  mealInfo: { display: "flex", flexDirection: "column", gap: 4 },
  inheritedBadge: { fontSize: 9, color: C.green, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" },
  recipeRow: { display: "flex", flexDirection: "column", gap: 2, paddingBottom: 4, borderBottom: `1px solid ${C.border}` },
  mealName: { fontSize: 12, fontWeight: 500, lineHeight: 1.3 },
  pdfOpenBtn: { fontSize: 11, color: C.accent, background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left", fontFamily: "inherit", textDecoration: "underline" },
  mealLink: { fontSize: 11, color: C.accent, textDecoration: "underline", cursor: "pointer" },
  mealMeta: { fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 },
  lunchBadge: { background: C.accentGlow, color: C.accent, padding: "1px 6px", borderRadius: 4, fontSize: 9 },
  editForm: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 },
  recipeBlock: { background: C.bg, borderRadius: 6, border: `1px solid ${C.border}`, padding: 8, display: "flex", flexDirection: "column", gap: 5 },
  recipeBlockHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  recipeNum: { fontSize: 10, color: C.accent, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" },
  removeRecipeBtn: { background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 11, padding: 0 },
  addRecipeBtn: { background: "transparent", border: `1px dashed ${C.accent}`, borderRadius: 5, padding: "5px 0", fontSize: 11, color: C.accent, cursor: "pointer", fontFamily: "inherit", textAlign: "center" },
  modeTabs: { display: "flex", gap: 2, background: C.surface, borderRadius: 5, padding: 2 },
  modeTab: { flex: 1, padding: "3px 2px", borderRadius: 4, border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 9, fontFamily: "inherit" },
  modeTabActive: { background: C.card, color: C.accent },
  tileInput: { width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: "5px 7px", fontSize: 11, color: C.text, fontFamily: "inherit", outline: "none" },
  tileSelect: { width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: "5px 7px", fontSize: 11, color: C.text, fontFamily: "inherit", outline: "none" },
  pdfLabel: { cursor: "pointer" },
  pdfBtn: { display: "block", background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 5, padding: "5px 7px", fontSize: 11, color: C.muted, textAlign: "center" },
  personRow: { display: "flex", alignItems: "center", gap: 5 },
  personLabel: { fontSize: 10, color: C.muted, flex: 1 },
  countBtn: { width: 20, height: 20, borderRadius: 4, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" },
  personCount: { fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: "center" },
  checkLabel: { fontSize: 11, color: C.muted, display: "flex", alignItems: "center", cursor: "pointer" },
  saveBtn: { background: C.accent, color: "#fff", border: "none", borderRadius: 5, padding: "6px 0", fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 },
  generateWrap: { display: "flex", justifyContent: "center", marginTop: 28 },
  generateBtn: { padding: "12px 32px", borderRadius: 10, background: C.accent, border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 0 24px ${C.accentGlow}` },
  loginWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `radial-gradient(ellipse at 50% 30%, rgba(108,143,255,0.1) 0%, ${C.bg} 70%)` },
  loginCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 40, width: 380, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" },
  loginTitle: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 32, textAlign: "center", letterSpacing: "-1px" },
  loginTabs: { display: "flex", background: C.card, borderRadius: 8, padding: 3 },
  tab: { flex: 1, padding: "8px 0", borderRadius: 6, border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  tabActive: { background: C.surface, color: C.text, boxShadow: "0 1px 4px rgba(0,0,0,0.3)" },
  input: { width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 14, color: C.text, fontFamily: "inherit", outline: "none", marginBottom: 0 },
  primaryBtn: { padding: "12px 0", borderRadius: 8, background: C.accent, border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 4 },
  shoppingWrap: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  progressCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 },
  progressLabel: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 300 },
  progressBar: { height: 6, background: C.card, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", background: C.green, borderRadius: 3, transition: "width .3s ease" },
  addCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  select: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 8px", fontSize: 12, color: C.text, fontFamily: "inherit", outline: "none" },
  unitSelect: { width: 72, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 4px", fontSize: 12, color: C.muted, fontFamily: "inherit", outline: "none" },
  addBtn: { padding: "10px 16px", borderRadius: 8, background: C.accent, border: "none", color: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap" },
  emptyState: { textAlign: "center", padding: "48px 24px", color: C.muted },
  catSection: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" },
  catHeader: { padding: "10px 16px", background: C.card, fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.8px", borderBottom: `1px solid ${C.border}` },
  shoppingItem: { display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: `1px solid ${C.border}` },
  shoppingItemDone: { opacity: 0.5 },
  checkCircle: { width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.border}`, background: "transparent", cursor: "pointer", fontSize: 11, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  checkCircleDone: { border: `2px solid ${C.green}`, background: "rgba(76,175,130,0.1)" },
  itemName: { flex: 1, fontSize: 14 },
  strikethrough: { textDecoration: "line-through", color: C.muted },
  amountInput: { width: 60, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 6px", fontSize: 12, color: C.muted, fontFamily: "inherit", outline: "none" },
  deleteItemBtn: { background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 12, padding: "2px 4px" },
};
