import { useState, useEffect, useCallback } from "react";

const SUPABASE_URL = "https://lsgjtbfogugaypcewvdm.supabase.co";
const SUPABASE_KEY = "sb_publishable_HDLUGvJCBCdES7lbF_CHLg_k0G7aUXi";

const sb = {
  headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  async signUp(email, password) { return (await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method: "POST", headers: this.headers, body: JSON.stringify({ email, password }) })).json(); },
  async signIn(email, password) { return (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: this.headers, body: JSON.stringify({ email, password }) })).json(); },
  async signOut(token) { await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { ...this.headers, Authorization: `Bearer ${token}` } }); },
  async refreshToken(rt) { return (await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: this.headers, body: JSON.stringify({ refresh_token: rt }) })).json(); },
  authHeaders(token) { return { ...this.headers, Authorization: `Bearer ${token}` }; },
  async getMeals(token, weekStart) { return (await fetch(`${SUPABASE_URL}/rest/v1/meals?week_start=eq.${weekStart}&select=*`, { headers: this.authHeaders(token) })).json(); },
  async upsertMeal(token, meal) { return (await fetch(`${SUPABASE_URL}/rest/v1/meals`, { method: "POST", headers: { ...this.authHeaders(token), Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(meal) })).json(); },
  async deleteMeal(token, id) { await fetch(`${SUPABASE_URL}/rest/v1/meals?id=eq.${id}`, { method: "DELETE", headers: this.authHeaders(token) }); },
  async getShoppingItems(token) { return (await fetch(`${SUPABASE_URL}/rest/v1/shopping_items?select=*&order=category,name`, { headers: this.authHeaders(token) })).json(); },
  async upsertShoppingItem(token, item) { return (await fetch(`${SUPABASE_URL}/rest/v1/shopping_items`, { method: "POST", headers: { ...this.authHeaders(token), Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(item) })).json(); },
  async deleteShoppingItem(token, id) { await fetch(`${SUPABASE_URL}/rest/v1/shopping_items?id=eq.${id}`, { method: "DELETE", headers: this.authHeaders(token) }); },
  async updateShoppingItem(token, id, updates) { return (await fetch(`${SUPABASE_URL}/rest/v1/shopping_items?id=eq.${id}`, { method: "PATCH", headers: { ...this.authHeaders(token), Prefer: "return=representation" }, body: JSON.stringify(updates) })).json(); },
  async getPdfLibrary(token) { return (await fetch(`${SUPABASE_URL}/rest/v1/pdf_library?select=*&order=name`, { headers: this.authHeaders(token) })).json(); },
  async savePdfToLibrary(token, item) { return (await fetch(`${SUPABASE_URL}/rest/v1/pdf_library`, { method: "POST", headers: { ...this.authHeaders(token), Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(item) })).json(); },
};

async function callClaude(prompt, pdfBase64 = null) {
  const messages = pdfBase64
    ? [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } }, { type: "text", text: prompt }] }]
    : [{ role: "user", content: prompt }];
  const r = await fetch("/api/claude", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ max_tokens: 2000, messages }) });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
  return d.content?.map(b => b.text || "").join("") || "";
}

function parseJSON(raw) {
  let s = raw.replace(/```json|```/gi, "").trim();
  const start = s.indexOf("["), end = s.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Kein JSON-Array: " + s.slice(0, 200));
  return JSON.parse(s.slice(start, end + 1));
}

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
function fmtFull(d) { return d.toLocaleDateString("de-CH", { weekday: "short", day: "2-digit", month: "2-digit" }); }
function emptyRecipe() { return { id: Date.now() + Math.random(), type: "link", name: "", link: "", pdf_name: "", pdf_base64: "", recipe_persons: 2 }; }
function useIsMobile() {
  const [m, setM] = useState(window.innerWidth < 768);
  useEffect(() => { const h = () => setM(window.innerWidth < 768); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h); }, []);
  return m;
}

function saveSession(s) { localStorage.setItem("mp_token", s.access_token); localStorage.setItem("mp_refresh", s.refresh_token || ""); localStorage.setItem("mp_expires", String(Date.now() + (s.expires_in || 3600) * 1000)); }
function clearSession() { ["mp_token","mp_refresh","mp_expires"].forEach(k => localStorage.removeItem(k)); }
function isTokenExpired() { return Date.now() > parseInt(localStorage.getItem("mp_expires") || "0") - 60000; }

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("mp_token"));
  const [page, setPage] = useState("plan");
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [meals, setMeals] = useState([]);
  const [shopping, setShopping] = useState([]);
  const [pdfLibrary, setPdfLibrary] = useState([]);
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const wk = weekKey(weekStart);

  async function getValidToken() {
    if (!isTokenExpired()) return token;
    const rt = localStorage.getItem("mp_refresh");
    if (!rt) { clearSession(); setToken(null); return null; }
    try {
      const data = await sb.refreshToken(rt);
      if (data.access_token) { saveSession(data); setToken(data.access_token); return data.access_token; }
    } catch {}
    clearSession(); setToken(null); return null;
  }

  const loadMeals = useCallback(async () => {
    if (!token) return;
    const t = await getValidToken(); if (!t) return;
    const data = await sb.getMeals(t, wk);
    if (Array.isArray(data)) setMeals(data);
  }, [token, wk]);

  const loadShopping = useCallback(async () => {
    if (!token) return;
    const t = await getValidToken(); if (!t) return;
    const data = await sb.getShoppingItems(t);
    if (Array.isArray(data)) setShopping(data);
  }, [token, wk]);

  const loadPdfLibrary = useCallback(async () => {
    if (!token) return;
    const t = await getValidToken(); if (!t) return;
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
    await sb.upsertMeal(t, meal); await loadMeals();
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
        for (const rec of recipes) {
          const name = rec.name || rec.pdf_name || "Unbenanntes Rezept";
          lines.push(`- ${DAYS[m.day_index]} ${SLOT_LABELS[m.slot]}: "${name}" – Rezept für ${rec.recipe_persons||2} Personen, kochen für ${m.persons||2} Personen${rec.link ? ` (${rec.link})` : ""}`);
        }
      }
      const prompt = `Du bist ein Schweizer Kochassistent. Erstelle eine vollständige Einkaufsliste. Skaliere Zutaten von "Rezept für X Personen" auf "kochen für Y Personen".\n\n${lines.join("\n")}\n\nAntworte AUSSCHLIESSLICH mit einem JSON-Array:\n[{"name":"Zutat","amount":"200","unit":"g","category":"Gemüse & Früchte"}]\nKategorien: Gemüse & Früchte, Fleisch & Fisch, Milchprodukte, Getreide & Backwaren, Hülsenfrüchte, Gewürze & Saucen, Konserven, Tiefkühl, Sonstiges\n"amount" = nur Zahl als String. Gleiche Zutaten zusammenfassen.`;
      const items = parseJSON(await callClaude(prompt));
      for (const s of shopping.filter(s => !s.manual)) await sb.deleteShoppingItem(t, s.id);
      for (const item of items) await sb.upsertShoppingItem(t, { name: item.name, amount: String(item.amount ?? ""), unit: item.unit || "", category: item.category || "Sonstiges", checked: false, manual: false });
      await loadShopping(); setPage("shopping");
    } catch (e) { alert("Fehler: " + e.message); }
    setLoading(false);
  }

  if (!token) return <LoginPage onLogin={(s) => { saveSession(s); setToken(s.access_token); }} />;

  return (
    <div style={S.app}>
      <style>{globalCss}</style>
      <header style={S.header}>
        <div style={S.headerInner}>
          <div style={S.logo}><span>🥗</span><span style={S.logoText}>Menüplaner</span></div>
          <nav style={S.nav}>
            <button style={{ ...S.navBtn, ...(page === "plan" ? S.navActive : {}) }} onClick={() => setPage("plan")}>📅 Plan</button>
            <button style={{ ...S.navBtn, ...(page === "shopping" ? S.navActive : {}) }} onClick={() => setPage("shopping")}>🛒 Einkauf</button>
          </nav>
          <button style={S.logoutBtn} onClick={async () => { await sb.signOut(token); clearSession(); setToken(null); }}>↩</button>
        </div>
      </header>
      <main style={S.main}>
        {page === "plan"
          ? <PlanPage weekStart={weekStart} setWeekStart={setWeekStart} getMeal={getMeal} saveMeal={saveMeal} removeMeal={removeMeal} generateShoppingList={generateShoppingList} loading={loading} pdfLibrary={pdfLibrary} token={token} loadPdfLibrary={loadPdfLibrary} getValidToken={getValidToken} isMobile={isMobile} />
          : <ShoppingPage shopping={shopping} token={token} wk={wk} loadShopping={loadShopping} sb={sb} getValidToken={getValidToken} />}
      </main>
    </div>
  );
}

function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function handle() {
    setErr(""); setBusy(true);
    try {
      const data = await (mode === "login" ? sb.signIn(email, pw) : sb.signUp(email, pw));
      if (data.access_token) onLogin(data);
      else if (data.error_description || data.msg) setErr(data.error_description || data.msg);
      else if (mode === "signup") { setErr("Registrierung erfolgreich! Bitte einloggen."); setMode("login"); }
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <div style={S.loginWrap}><style>{globalCss}</style>
      <div style={S.loginCard}>
        <div style={{ fontSize: 48, textAlign: "center" }}>🥗</div>
        <h1 style={S.loginTitle}>Menüplaner</h1>
        <p style={{ textAlign: "center", color: C.muted, fontSize: 14, marginTop: -8 }}>Für euch zwei 💑</p>
        <div style={S.loginTabs}>
          <button style={{ ...S.tab, ...(mode === "login" ? S.tabActive : {}) }} onClick={() => setMode("login")}>Anmelden</button>
          <button style={{ ...S.tab, ...(mode === "signup" ? S.tabActive : {}) }} onClick={() => setMode("signup")}>Registrieren</button>
        </div>
        <input style={S.input} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} />
        <input style={S.input} type="password" placeholder="Passwort" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} />
        {err && <p style={{ color: C.danger, fontSize: 12, textAlign: "center" }}>{err}</p>}
        <button style={S.primaryBtn} onClick={handle} disabled={busy}>{busy ? "⏳…" : mode === "login" ? "Anmelden" : "Registrieren"}</button>
      </div>
    </div>
  );
}

// ── Plan Page ─────────────────────────────────────────────────────────────────
function PlanPage({ weekStart, setWeekStart, getMeal, saveMeal, removeMeal, generateShoppingList, loading, pdfLibrary, token, loadPdfLibrary, getValidToken, isMobile }) {
  const [editCell, setEditCell] = useState(null);
  // Mobile: show 2 days at a time, starting from today's index or 0
  const todayIdx = (() => { const d = getMonday(new Date()); const diff = Math.round((new Date().setHours(0,0,0,0) - d) / 86400000); return Math.max(0, Math.min(diff, 6)); })();
  const [dayOffset, setDayOffset] = useState(() => isMobile ? Math.min(todayIdx, 5) : 0);
  const visibleDays = isMobile ? [dayOffset] : DAYS.map((_, i) => i);

  return (
    <div>
      {/* Week nav */}
      <div style={S.weekNav}>
        <button style={S.weekBtn} onClick={() => setWeekStart(addDays(weekStart, -7))}>← Vorwoche</button>
        <span style={S.weekLabel}>{fmt(weekStart)} – {fmt(addDays(weekStart, 6))}</span>
        <button style={S.weekBtn} onClick={() => setWeekStart(addDays(weekStart, 7))}>Nächste →</button>
      </div>

      {/* Mobile day nav */}
      {isMobile && (
        <div style={S.dayNav}>
          <button style={S.dayNavBtn} onClick={() => setDayOffset(o => Math.max(0, o - 1))} disabled={dayOffset === 0}>‹</button>
          <span style={S.dayNavLabel}>
            {DAYS[dayOffset]}, {fmtFull(addDays(weekStart, dayOffset))}
          </span>
          <button style={S.dayNavBtn} onClick={() => setDayOffset(o => Math.min(6, o + 1))} disabled={dayOffset >= 6}>›</button>
        </div>
      )}

      {/* Days */}
      <div style={{ ...S.daysGrid, gridTemplateColumns: isMobile ? "1fr" : "repeat(7, 1fr)" }}>
        {visibleDays.map(i => {
          const date = addDays(weekStart, i);
          const isToday = fmt(date) === fmt(new Date());
          return (
            <div key={i} style={{ ...S.dayCol, ...(isToday ? S.dayColToday : {}) }}>
              <div style={S.dayHeader}>
                <span style={S.dayName}>{DAYS[i]}</span>
                <span style={S.dayDate}>{fmt(date)}</span>
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

      <div style={S.generateWrap}>
        <button style={S.generateBtn} onClick={generateShoppingList} disabled={loading}>
          {loading ? "⏳ Generiere…" : "🛒 Einkaufsliste generieren"}
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
    updateRecipe(id, "pdf_base64", base64); updateRecipe(id, "type", "pdf");
    try { const t = await getValidToken(); if (t) await sb.savePdfToLibrary(t, { name: file.name, pdf_base64: base64 }); await loadPdfLibrary(); } catch {}
    try { const raw = await callClaude("Extrahiere den Menünamen aus diesem Rezept-PDF. Antworte NUR mit dem Namen.", base64); updateRecipe(id, "name", raw.trim()); } catch {}
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
    <div style={{ ...S.tile, ...(hasContent ? S.tileActive : {}), ...(isInherited ? S.tileInherited : {}) }}>
      <div style={S.tileHeader}>
        <span style={S.slotLabel}>{SLOT_LABELS[slot]}</span>
        <div style={S.tileActions}>
          {hasContent && !isEdit && !isInherited && <button style={S.iconBtn} onClick={onRemove}>✕</button>}
          {!isInherited && <button style={S.iconBtn} onClick={onEdit}>{isEdit ? "✓" : hasContent ? "✎" : "+"}</button>}
        </div>
      </div>

      {!isEdit && hasContent && (
        <div style={S.mealInfo}>
          {isInherited && <div style={S.inheritedBadge}>↑ Vorabend</div>}
          {recipes.map((rec, i) => (
            <div key={rec.id || i} style={S.recipeRow}>
              {rec.name && <div style={S.mealName}>{rec.name}</div>}
              {rec.pdf_name && <button onClick={() => openPdf(rec)} style={S.pdfOpenBtn}>📄 {rec.pdf_name}</button>}
              {rec.link && <a href={rec.link} target="_blank" rel="noopener noreferrer" style={S.mealLink} onClick={e => { e.preventDefault(); window.open(rec.link, "_blank", "noopener,noreferrer"); }}>🔗 Rezept</a>}
            </div>
          ))}
          <div style={S.mealMeta}>
            👥 {meal?.persons ?? 2} Pers.
            {meal?.also_next_lunch && <span style={S.lunchBadge}>→ morgen</span>}
          </div>
        </div>
      )}

      {isEdit && (
        <div style={S.editForm}>
          {recipes.map((rec, i) => (
            <div key={rec.id} style={S.recipeBlock}>
              <div style={S.recipeBlockHeader}>
                <span style={S.recipeNum}>Rezept {i + 1}</span>
                <button style={S.removeRecipeBtn} onClick={() => removeRecipe(rec.id)}>✕</button>
              </div>
              <input style={S.tileInput} placeholder="Name" value={rec.name} onChange={e => updateRecipe(rec.id, "name", e.target.value)} />
              <div style={S.modeTabs}>
                {["link","pdf","library"].map(t => (
                  <button key={t} style={{ ...S.modeTab, ...(rec.type === t ? S.modeTabActive : {}) }} onClick={() => updateRecipe(rec.id, "type", t)}>
                    {t === "link" ? "🔗" : t === "pdf" ? "📤" : "📚"}
                  </button>
                ))}
              </div>
              {rec.type === "link" && <input style={S.tileInput} placeholder="https://fooby.ch/..." value={rec.link} onChange={e => updateRecipe(rec.id, "link", e.target.value)} />}
              {rec.type === "pdf" && (
                <label style={S.pdfLabel}>
                  <span style={S.pdfBtn}>{rec.pdf_name || "📄 PDF wählen…"}</span>
                  <input type="file" accept=".pdf" onChange={e => handlePdf(rec.id, e.target.files[0])} style={{ display: "none" }} />
                </label>
              )}
              {rec.type === "library" && (
                <select style={S.tileSelect} onChange={e => {
                  const item = pdfLibrary.find(p => p.id === e.target.value);
                  if (item) { updateRecipe(rec.id, "pdf_name", item.name); updateRecipe(rec.id, "pdf_base64", item.pdf_base64); if (!rec.name) updateRecipe(rec.id, "name", item.name.replace(".pdf","")); }
                }} defaultValue="">
                  <option value="" disabled>Rezept wählen…</option>
                  {pdfLibrary.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <div style={S.personRow}>
                <span style={S.personLabel}>📄 für:</span>
                <button style={S.countBtn} onClick={() => updateRecipe(rec.id, "recipe_persons", Math.max(1,(rec.recipe_persons||2)-1))}>−</button>
                <span style={S.personCount}>{rec.recipe_persons||2}</span>
                <button style={S.countBtn} onClick={() => updateRecipe(rec.id, "recipe_persons", (rec.recipe_persons||2)+1)}>+</button>
                <span style={S.personLabel}>Pers.</span>
              </div>
            </div>
          ))}
          <button style={S.addRecipeBtn} onClick={addRecipe}>+ Rezept</button>
          <div style={{ ...S.personRow, marginTop: 4 }}>
            <span style={S.personLabel}>👥 kochen für:</span>
            <button style={S.countBtn} onClick={() => setPersons(Math.max(1,persons-1))}>−</button>
            <span style={S.personCount}>{persons}</span>
            <button style={S.countBtn} onClick={() => setPersons(persons+1)}>+</button>
            <span style={S.personLabel}>Pers.</span>
          </div>
          {slot === "abend" && (
            <label style={S.checkLabel}>
              <input type="checkbox" checked={alsoLunch} onChange={e => setAlsoLunch(e.target.checked)} style={{ marginRight: 6 }} />
              Auch morgen Mittag
            </label>
          )}
          <button style={S.saveBtn} onClick={() => onSave({ persons, also_next_lunch: alsoLunch, recipes: JSON.stringify(recipes) })}>Speichern</button>
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

  const unchecked = shopping.filter(s => !s.checked);
  const checked = shopping.filter(s => s.checked);

  const grouped = CATS.reduce((acc, cat) => {
    const items = unchecked.filter(s => s.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  async function getT() { return await getValidToken(); }
  async function toggleCheck(item) { const t = await getT(); if (t) { await sb.updateShoppingItem(t, item.id, { checked: !item.checked }); await loadShopping(); } }
  async function updateField(item, field, value) { const t = await getT(); if (t) { await sb.updateShoppingItem(t, item.id, { [field]: value }); await loadShopping(); } }
  async function deleteItem(id) { const t = await getT(); if (t) { await sb.deleteShoppingItem(t, id); await loadShopping(); } }
  async function deleteAllChecked() {
    const t = await getT(); if (!t) return;
    for (const item of checked) await sb.deleteShoppingItem(t, item.id);
    await loadShopping();
  }
  async function addItem() {
    if (!newName.trim()) return;
    const t = await getT(); if (!t) return;
    await sb.upsertShoppingItem(t, { name: newName.trim(), amount: newAmount, unit: newUnit, category: newCat, checked: false, manual: true });
    setNewName(""); setNewAmount(""); setNewUnit(""); await loadShopping();
  }

  const total = shopping.length, done = checked.length;

  return (
    <div style={S.shoppingWrap}>
      <div style={S.progressCard}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={S.progressLabel}>Einkaufsliste</span>
          <span style={{ color: C.muted, fontSize: 13 }}>{done} / {total} erledigt</span>
        </div>
        <div style={S.progressBar}><div style={{ ...S.progressFill, width: total ? `${(done/total)*100}%` : "0%" }} /></div>
      </div>

      <div style={S.addCard}>
        <input style={{ ...S.input, marginBottom: 0, flex: 1, minWidth: 100 }} placeholder="Zutat…" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addItem()} />
        <input style={{ ...S.input, marginBottom: 0, width: 65 }} placeholder="Menge" value={newAmount} onChange={e => setNewAmount(e.target.value)} />
        <select style={S.select} value={newUnit} onChange={e => setNewUnit(e.target.value)}>
          {UNITS.map(u => <option key={u} value={u}>{u || "Einheit"}</option>)}
        </select>
        <select style={S.select} value={newCat} onChange={e => setNewCat(e.target.value)}>
          {CATS.map(c => <option key={c}>{c}</option>)}
        </select>
        <button style={S.addBtn} onClick={addItem}>+ Hinzufügen</button>
      </div>

      {Object.keys(grouped).length === 0 && checked.length === 0 && (
        <div style={S.emptyState}><div style={{ fontSize: 48, marginBottom: 12 }}>🛒</div><p>Noch keine Einträge.</p></div>
      )}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} style={S.catSection}>
          <div style={S.catHeader}>{cat}</div>
          {items.map(item => (
            <div key={item.id} style={S.shoppingItem}>
              <button style={S.checkCircle} onClick={() => toggleCheck(item)}>{""}</button>
              <span style={S.itemName}>{item.name}</span>
              <input style={S.amountInput} value={item.amount || ""} onChange={e => updateField(item, "amount", e.target.value)} placeholder="Menge" />
              <select style={S.unitSelect} value={item.unit || ""} onChange={e => updateField(item, "unit", e.target.value)}>
                {UNITS.map(u => <option key={u} value={u}>{u || "–"}</option>)}
              </select>
              <button style={S.deleteItemBtn} onClick={() => deleteItem(item.id)}>✕</button>
            </div>
          ))}
        </div>
      ))}

      {checked.length > 0 && (
        <>
          <div style={S.checkedHeader}>
            <span style={S.checkedTitle}>✓ Bereits gekauft ({checked.length})</span>
            <button style={S.deleteAllBtn} onClick={deleteAllChecked}>🗑 Alle löschen</button>
          </div>
          <div style={S.catSection}>
            {checked.map(item => (
              <div key={item.id} style={{ ...S.shoppingItem, ...S.shoppingItemDone }}>
                <button style={{ ...S.checkCircle, ...S.checkCircleDone }} onClick={() => toggleCheck(item)}>✓</button>
                <span style={{ ...S.itemName, ...S.strikethrough }}>{item.name}</span>
                <span style={S.amountDone}>{item.amount} {item.unit}</span>
                <button style={S.deleteItemBtn} onClick={() => deleteItem(item.id)}>✕</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Theme & Styles ────────────────────────────────────────────────────────────
const C = { bg: "#0f1117", surface: "#1a1d27", card: "#22263a", border: "#2e3250", accent: "#6c8fff", accentGlow: "rgba(108,143,255,0.15)", green: "#4caf82", text: "#e8eaf6", muted: "#8b90b0", danger: "#ff6b6b", today: "rgba(108,143,255,0.08)", inherited: "rgba(76,175,130,0.06)" };

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${C.bg}; color: ${C.text}; font-family: 'DM Sans', sans-serif; -webkit-tap-highlight-color: transparent; padding-bottom: env(safe-area-inset-bottom); }
  ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: ${C.bg}; } ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
  input, select { color: ${C.text}; background: ${C.surface}; } input::placeholder { color: ${C.muted}; }
  button { -webkit-tap-highlight-color: transparent; }
`;

const S = {
  app: { minHeight: "100vh", background: C.bg },
  header: { position: "sticky", top: 0, zIndex: 100, background: C.surface, borderBottom: `1px solid ${C.border}`, paddingTop: "env(safe-area-inset-top)" },
  headerInner: { maxWidth: 1200, margin: "0 auto", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 },
  logo: { display: "flex", alignItems: "center", gap: 8, marginRight: "auto", fontSize: 22 },
  logoText: { fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 300, letterSpacing: "-0.5px" },
  nav: { display: "flex", gap: 6 },
  navBtn: { padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  navActive: { background: C.accentGlow, border: `1px solid ${C.accent}`, color: C.accent },
  logoutBtn: { padding: "7px 12px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 16, fontFamily: "inherit" },
  main: { maxWidth: 1200, margin: "0 auto", padding: "16px 12px", minHeight: "calc(100vh - 56px)", display: "flex", flexDirection: "column" },

  weekNav: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 8 },
  weekBtn: { padding: "8px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: "pointer", fontSize: 12, fontFamily: "inherit", whiteSpace: "nowrap" },
  weekLabel: { fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 300, textAlign: "center", flex: 1 },

  dayNav: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, background: C.surface, borderRadius: 10, padding: "8px 12px", border: `1px solid ${C.border}` },
  dayNavBtn: { padding: "6px 14px", borderRadius: 7, border: `1px solid ${C.border}`, background: C.card, color: C.text, cursor: "pointer", fontSize: 18, fontFamily: "inherit" },
  dayNavLabel: { fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 300, color: C.text, textAlign: "center", flex: 1 },

  daysGrid: { display: "grid", gap: 8, flex: 1 },
  dayCol: { background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 10, display: "flex", flexDirection: "column", gap: 8 },
  dayColToday: { border: `1px solid ${C.accent}`, background: C.today },
  dayHeader: { padding: "2px 2px 8px", borderBottom: `1px solid ${C.border}`, marginBottom: 2 },
  dayName: { display: "block", fontSize: 13, fontWeight: 600, letterSpacing: "0.3px" },
  dayDate: { display: "block", fontSize: 11, color: C.muted, marginTop: 2 },

  tile: { background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, padding: 14, minHeight: 120, flex: 1 },
  tileActive: { background: "#1e2235" },
  tileInherited: { background: C.inherited, border: `1px dashed ${C.green}` },
  tileHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  slotLabel: { fontSize: 13, color: C.muted, fontWeight: 600 },
  tileActions: { display: "flex", gap: 4 },
  iconBtn: { width: 32, height: 32, borderRadius: 6, border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
  mealInfo: { display: "flex", flexDirection: "column", gap: 3 },
  inheritedBadge: { fontSize: 9, color: C.green, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" },
  recipeRow: { display: "flex", flexDirection: "column", gap: 2, paddingBottom: 3, borderBottom: `1px solid ${C.border}` },
  mealName: { fontSize: 14, fontWeight: 500, lineHeight: 1.4 },
  pdfOpenBtn: { fontSize: 11, color: C.accent, background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left", fontFamily: "inherit", textDecoration: "underline" },
  mealLink: { fontSize: 11, color: C.accent, textDecoration: "underline", cursor: "pointer" },
  mealMeta: { fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginTop: 2 },
  lunchBadge: { background: C.accentGlow, color: C.accent, padding: "1px 5px", borderRadius: 4, fontSize: 9 },

  editForm: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 },
  recipeBlock: { background: C.bg, borderRadius: 6, border: `1px solid ${C.border}`, padding: 8, display: "flex", flexDirection: "column", gap: 5 },
  recipeBlockHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  recipeNum: { fontSize: 10, color: C.accent, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" },
  removeRecipeBtn: { background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 12, padding: 0 },
  addRecipeBtn: { background: "transparent", border: `1px dashed ${C.accent}`, borderRadius: 5, padding: "6px 0", fontSize: 12, color: C.accent, cursor: "pointer", fontFamily: "inherit", textAlign: "center" },
  modeTabs: { display: "flex", gap: 2, background: C.surface, borderRadius: 5, padding: 2 },
  modeTab: { flex: 1, padding: "4px 2px", borderRadius: 4, border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 14, fontFamily: "inherit" },
  modeTabActive: { background: C.card, color: C.accent },
  tileInput: { width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: "6px 8px", fontSize: 13, color: C.text, fontFamily: "inherit", outline: "none" },
  tileSelect: { width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: "6px 8px", fontSize: 13, color: C.text, fontFamily: "inherit", outline: "none" },
  pdfLabel: { cursor: "pointer" },
  pdfBtn: { display: "block", background: C.surface, border: `1px dashed ${C.border}`, borderRadius: 5, padding: "6px 8px", fontSize: 12, color: C.muted, textAlign: "center" },
  personRow: { display: "flex", alignItems: "center", gap: 6 },
  personLabel: { fontSize: 11, color: C.muted, flex: 1 },
  countBtn: { width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: "pointer", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" },
  personCount: { fontSize: 15, fontWeight: 600, minWidth: 20, textAlign: "center" },
  checkLabel: { fontSize: 12, color: C.muted, display: "flex", alignItems: "center", cursor: "pointer" },
  saveBtn: { background: C.accent, color: "#fff", border: "none", borderRadius: 8, padding: "8px 0", fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 },

  generateWrap: { display: "flex", justifyContent: "center", marginTop: 20, paddingBottom: 20 },
  generateBtn: { padding: "14px 28px", borderRadius: 12, background: C.accent, border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 0 24px ${C.accentGlow}`, width: "100%", maxWidth: 400 },

  loginWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `radial-gradient(ellipse at 50% 30%, rgba(108,143,255,0.1) 0%, ${C.bg} 70%)`, padding: 16 },
  loginCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 32, width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" },
  loginTitle: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 30, textAlign: "center", letterSpacing: "-1px" },
  loginTabs: { display: "flex", background: C.card, borderRadius: 8, padding: 3 },
  tab: { flex: 1, padding: "9px 0", borderRadius: 6, border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 14, fontFamily: "inherit" },
  tabActive: { background: C.surface, color: C.text, boxShadow: "0 1px 4px rgba(0,0,0,0.3)" },
  input: { width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", fontSize: 16, color: C.text, fontFamily: "inherit", outline: "none", marginBottom: 0 },
  primaryBtn: { padding: "13px 0", borderRadius: 8, background: C.accent, border: "none", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 4 },

  shoppingWrap: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 },
  progressCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 },
  progressLabel: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 300 },
  progressBar: { height: 6, background: C.card, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", background: C.green, borderRadius: 3, transition: "width .3s ease" },
  addCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  select: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 8px", fontSize: 13, color: C.text, fontFamily: "inherit", outline: "none" },
  unitSelect: { width: 72, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px", fontSize: 12, color: C.muted, fontFamily: "inherit", outline: "none" },
  addBtn: { padding: "10px 16px", borderRadius: 8, background: C.accent, border: "none", color: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap" },
  emptyState: { textAlign: "center", padding: "48px 24px", color: C.muted },
  catSection: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" },
  catHeader: { padding: "10px 16px", background: C.card, fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.8px", borderBottom: `1px solid ${C.border}` },
  shoppingItem: { display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.border}` },
  shoppingItemDone: { opacity: 0.55 },
  checkCircle: { width: 26, height: 26, borderRadius: "50%", border: `2px solid ${C.border}`, background: "transparent", cursor: "pointer", fontSize: 12, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  checkCircleDone: { border: `2px solid ${C.green}`, background: "rgba(76,175,130,0.12)" },
  itemName: { flex: 1, fontSize: 15 },
  strikethrough: { textDecoration: "line-through", color: C.muted },
  amountInput: { width: 60, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "5px 6px", fontSize: 13, color: C.muted, fontFamily: "inherit", outline: "none" },
  amountDone: { fontSize: 13, color: C.muted, minWidth: 70 },
  deleteItemBtn: { background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 14, padding: "4px 6px" },
  checkedHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" },
  checkedTitle: { fontSize: 14, fontWeight: 600, color: C.green },
  deleteAllBtn: { padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.danger}`, background: "transparent", color: C.danger, cursor: "pointer", fontSize: 12, fontFamily: "inherit", fontWeight: 600 },
};
