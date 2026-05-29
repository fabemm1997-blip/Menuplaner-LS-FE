import { useState, useEffect, useCallback } from "react";

// ── Supabase config ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://lsgjtbfogugaypcewvdm.supabase.co";
const SUPABASE_KEY = "sb_publishable_HDLUGvJCBCdES7lbF_CHLg_k0G7aUXi";

const sb = {
  headers: {
    "Content-Type": "application/json",
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
  },
  async signUp(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST", headers: this.headers,
      body: JSON.stringify({ email, password }),
    });
    return r.json();
  },
  async signIn(email, password) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: this.headers,
      body: JSON.stringify({ email, password }),
    });
    return r.json();
  },
  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { ...this.headers, Authorization: `Bearer ${token}` },
    });
  },
  authHeaders(token) {
    return { ...this.headers, Authorization: `Bearer ${token}` };
  },
  async getMeals(token, weekStart) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/meals?week_start=eq.${weekStart}&select=*`,
      { headers: this.authHeaders(token) }
    );
    return r.json();
  },
  async upsertMeal(token, meal) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/meals`, {
      method: "POST",
      headers: { ...this.authHeaders(token), Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(meal),
    });
    return r.json();
  },
  async deleteMeal(token, id) {
    await fetch(`${SUPABASE_URL}/rest/v1/meals?id=eq.${id}`, {
      method: "DELETE", headers: this.authHeaders(token),
    });
  },
  async getShoppingItems(token, weekStart) {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/shopping_items?week_start=eq.${weekStart}&select=*&order=category,name`,
      { headers: this.authHeaders(token) }
    );
    return r.json();
  },
  async upsertShoppingItem(token, item) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/shopping_items`, {
      method: "POST",
      headers: { ...this.authHeaders(token), Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(item),
    });
    return r.json();
  },
  async deleteShoppingItem(token, id) {
    await fetch(`${SUPABASE_URL}/rest/v1/shopping_items?id=eq.${id}`, {
      method: "DELETE", headers: this.authHeaders(token),
    });
  },
  async updateShoppingItem(token, id, updates) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/shopping_items?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...this.authHeaders(token), Prefer: "return=representation" },
      body: JSON.stringify(updates),
    });
    return r.json();
  },
};

// ── Claude API ───────────────────────────────────────────────────────────────
async function extractWithClaude(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const d = await r.json();
  return d.content?.map(b => b.text || "").join("") || "";
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const DAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const SLOTS = ["morgen", "mittag", "abend"];
const SLOT_LABELS = { morgen: "☀️ Morgen", mittag: "🌤 Mittag", abend: "🌙 Abend" };

function getMonday(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}
function weekKey(d) {
  return d.toISOString().split("T")[0];
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function fmt(d) {
  return d.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" });
}

// ── SQL Setup hint ───────────────────────────────────────────────────────────
const SQL_HINT = `
-- Run this in Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS meals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  day_index int NOT NULL,
  slot text NOT NULL,
  name text,
  link text,
  persons int DEFAULT 2,
  also_next_lunch boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(week_start, day_index, slot)
);
CREATE TABLE IF NOT EXISTS shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  name text NOT NULL,
  amount text,
  category text DEFAULT 'Sonstiges',
  checked boolean DEFAULT false,
  manual boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_users" ON meals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_users" ON shopping_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
`;

// ════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("mp_token") || null);
  const [page, setPage] = useState("plan"); // plan | shopping
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [meals, setMeals] = useState([]);
  const [shopping, setShopping] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSql, setShowSql] = useState(false);

  const wk = weekKey(weekStart);

  // load data
  const loadMeals = useCallback(async () => {
    if (!token) return;
    const data = await sb.getMeals(token, wk);
    if (Array.isArray(data)) setMeals(data);
  }, [token, wk]);

  const loadShopping = useCallback(async () => {
    if (!token) return;
    const data = await sb.getShoppingItems(token, wk);
    if (Array.isArray(data)) setShopping(data);
  }, [token, wk]);

  useEffect(() => { loadMeals(); }, [loadMeals]);
  useEffect(() => { loadShopping(); }, [loadShopping]);

  function getMeal(dayIdx, slot) {
    return meals.find(m => m.day_index === dayIdx && m.slot === slot) || null;
  }

  async function saveMeal(dayIdx, slot, updates) {
    const existing = getMeal(dayIdx, slot);
    const meal = {
      week_start: wk, day_index: dayIdx, slot,
      name: "", link: "", persons: 2, also_next_lunch: false,
      ...(existing || {}), ...updates,
    };
    if (existing?.id) meal.id = existing.id;
    await sb.upsertMeal(token, meal);
    await loadMeals();
  }

  async function removeMeal(dayIdx, slot) {
    const m = getMeal(dayIdx, slot);
    if (m?.id) { await sb.deleteMeal(token, m.id); await loadMeals(); }
  }

  // ── Generate shopping list via Claude ──────────────────────────────────────
  async function generateShoppingList() {
    setLoading(true);
    try {
      const mealsWithContent = meals.filter(m => m.name || m.link);
      if (!mealsWithContent.length) { alert("Keine Menüs diese Woche erfasst."); setLoading(false); return; }

      const mealDescriptions = mealsWithContent.map(m => {
        const day = DAYS[m.day_index];
        const slot = SLOT_LABELS[m.slot];
        const persons = m.persons || 2;
        return `- ${day} ${slot}: "${m.name || "Unbenannt"}" für ${persons} Personen${m.link ? ` (Rezept: ${m.link})` : ""}`;
      }).join("\n");

      const prompt = `Du bist ein Kochassistent. Erstelle eine Einkaufsliste für folgende Menüs:

${mealDescriptions}

Antworte NUR mit einem JSON-Array (kein Markdown, keine Erklärung):
[
  {"name": "Zutatname", "amount": "Menge + Einheit", "category": "Kategorie"},
  ...
]

Kategorien: Gemüse & Früchte, Fleisch & Fisch, Milchprodukte, Getreide & Backwaren, Hülsenfrüchte, Gewürze & Saucen, Konserven, Tiefkühl, Sonstiges

Passe Mengen an die jeweilige Personenanzahl an. Fasse gleiche Zutaten zusammen.`;

      const raw = await extractWithClaude(prompt);
      const clean = raw.replace(/```json|```/g, "").trim();
      const items = JSON.parse(clean);

      // clear existing AI items, keep manual ones
      const manualItems = shopping.filter(s => s.manual);
      for (const s of shopping.filter(s => !s.manual)) {
        await sb.deleteShoppingItem(token, s.id);
      }
      for (const item of items) {
        await sb.upsertShoppingItem(token, {
          week_start: wk, name: item.name, amount: item.amount,
          category: item.category || "Sonstiges", checked: false, manual: false,
        });
      }
      await loadShopping();
      setPage("shopping");
    } catch (e) {
      alert("Fehler beim Generieren: " + e.message);
    }
    setLoading(false);
  }

  if (!token) return <LoginPage onLogin={(t) => { localStorage.setItem("mp_token", t); setToken(t); }} />;

  return (
    <div style={styles.app}>
      <style>{globalCss}</style>

      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logo}>
            <span style={styles.logoIcon}>🥗</span>
            <span style={styles.logoText}>Menüplaner</span>
          </div>
          <nav style={styles.nav}>
            <button style={{ ...styles.navBtn, ...(page === "plan" ? styles.navActive : {}) }} onClick={() => setPage("plan")}>
              📅 Wochenplan
            </button>
            <button style={{ ...styles.navBtn, ...(page === "shopping" ? styles.navActive : {}) }} onClick={() => setPage("shopping")}>
              🛒 Einkaufsliste
            </button>
          </nav>
          <div style={styles.headerRight}>
            <button style={styles.sqlBtn} onClick={() => setShowSql(!showSql)} title="DB Setup">⚙️</button>
            <button style={styles.logoutBtn} onClick={async () => { await sb.signOut(token); localStorage.removeItem("mp_token"); setToken(null); }}>
              Abmelden
            </button>
          </div>
        </div>
      </header>

      {showSql && (
        <div style={styles.sqlBox}>
          <strong>📋 Einmalig in Supabase SQL Editor ausführen:</strong>
          <pre style={styles.sqlPre}>{SQL_HINT}</pre>
          <button style={styles.closeBtn} onClick={() => setShowSql(false)}>Schliessen</button>
        </div>
      )}

      <main style={styles.main}>
        {page === "plan" ? (
          <PlanPage
            weekStart={weekStart}
            setWeekStart={setWeekStart}
            getMeal={getMeal}
            saveMeal={saveMeal}
            removeMeal={removeMeal}
            generateShoppingList={generateShoppingList}
            loading={loading}
          />
        ) : (
          <ShoppingPage
            shopping={shopping}
            weekStart={weekStart}
            token={token}
            wk={wk}
            loadShopping={loadShopping}
            sb={sb}
          />
        )}
      </main>
    </div>
  );
}

// ── Login Page ────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handle() {
    setError(""); setLoading(true);
    try {
      const fn = mode === "login" ? sb.signIn.bind(sb) : sb.signUp.bind(sb);
      const data = await fn(email, password);
      if (data.access_token) {
        onLogin(data.access_token);
      } else if (data.error || data.msg) {
        setError(data.error_description || data.msg || "Fehler");
      } else if (mode === "signup") {
        setError("Bestätigungs-Email gesendet! Bitte Email bestätigen, dann einloggen.");
        setMode("login");
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div style={styles.loginWrap}>
      <style>{globalCss}</style>
      <div style={styles.loginCard}>
        <div style={styles.loginLogo}>🥗</div>
        <h1 style={styles.loginTitle}>Menüplaner</h1>
        <p style={styles.loginSub}>Für euch zwei 💑</p>
        <div style={styles.loginTabs}>
          <button style={{ ...styles.tab, ...(mode === "login" ? styles.tabActive : {}) }} onClick={() => setMode("login")}>Anmelden</button>
          <button style={{ ...styles.tab, ...(mode === "signup" ? styles.tabActive : {}) }} onClick={() => setMode("signup")}>Registrieren</button>
        </div>
        <input style={styles.input} type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} />
        <input style={styles.input} type="password" placeholder="Passwort" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} />
        {error && <p style={styles.error}>{error}</p>}
        <button style={styles.primaryBtn} onClick={handle} disabled={loading}>
          {loading ? "⏳ Laden…" : mode === "login" ? "Anmelden" : "Registrieren"}
        </button>
      </div>
    </div>
  );
}

// ── Plan Page ─────────────────────────────────────────────────────────────────
function PlanPage({ weekStart, setWeekStart, getMeal, saveMeal, removeMeal, generateShoppingList, loading }) {
  const [editCell, setEditCell] = useState(null); // {dayIdx, slot}

  return (
    <div>
      {/* Week nav */}
      <div style={styles.weekNav}>
        <button style={styles.weekBtn} onClick={() => setWeekStart(addDays(weekStart, -7))}>← Vorwoche</button>
        <span style={styles.weekLabel}>
          {fmt(weekStart)} – {fmt(addDays(weekStart, 6))}
        </span>
        <button style={styles.weekBtn} onClick={() => setWeekStart(addDays(weekStart, 7))}>Nächste Woche →</button>
      </div>

      {/* Days grid */}
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
                return (
                  <MealTile
                    key={slot}
                    slot={slot}
                    meal={meal}
                    isEdit={isEdit}
                    onEdit={() => setEditCell(isEdit ? null : { dayIdx: i, slot })}
                    onSave={(updates) => { saveMeal(i, slot, updates); setEditCell(null); }}
                    onRemove={() => removeMeal(i, slot)}
                  />
                );
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
function MealTile({ slot, meal, isEdit, onEdit, onSave, onRemove }) {
  const [name, setName] = useState(meal?.name || "");
  const [link, setLink] = useState(meal?.link || "");
  const [persons, setPersons] = useState(meal?.persons || 2);
  const [alsoLunch, setAlsoLunch] = useState(meal?.also_next_lunch || false);

  useEffect(() => {
    setName(meal?.name || "");
    setLink(meal?.link || "");
    setPersons(meal?.persons || 2);
    setAlsoLunch(meal?.also_next_lunch || false);
  }, [meal, isEdit]);

  function handleSave() {
    onSave({ name, link, persons, also_next_lunch: alsoLunch });
  }

  const hasContent = meal?.name || meal?.link;

  return (
    <div style={{ ...styles.tile, ...(hasContent ? styles.tileActive : {}) }}>
      <div style={styles.tileHeader}>
        <span style={styles.slotLabel}>{SLOT_LABELS[slot]}</span>
        <div style={styles.tileActions}>
          {hasContent && !isEdit && (
            <button style={styles.iconBtn} onClick={onRemove} title="Löschen">✕</button>
          )}
          <button style={styles.iconBtn} onClick={onEdit} title={isEdit ? "Schliessen" : "Bearbeiten"}>
            {isEdit ? "✓" : hasContent ? "✎" : "+"}
          </button>
        </div>
      </div>

      {!isEdit && hasContent && (
        <div style={styles.mealInfo}>
          {meal.name && <div style={styles.mealName}>{meal.name}</div>}
          {meal.link && (
            <a href={meal.link} target="_blank" rel="noreferrer" style={styles.mealLink}>
              🔗 Rezept öffnen
            </a>
          )}
          <div style={styles.mealMeta}>
            👥 {meal.persons} {meal.persons === 1 ? "Person" : "Personen"}
            {meal.also_next_lunch && <span style={styles.lunchBadge}>→ morgen Mittag</span>}
          </div>
        </div>
      )}

      {isEdit && (
        <div style={styles.editForm}>
          <input style={styles.tileInput} placeholder="Menüname" value={name} onChange={e => setName(e.target.value)} />
          <input style={styles.tileInput} placeholder="🔗 Rezept-Link (optional)" value={link} onChange={e => setLink(e.target.value)} />
          <div style={styles.personRow}>
            <span style={styles.personLabel}>👥 Personen:</span>
            <button style={styles.countBtn} onClick={() => setPersons(Math.max(1, persons - 1))}>−</button>
            <span style={styles.personCount}>{persons}</span>
            <button style={styles.countBtn} onClick={() => setPersons(persons + 1)}>+</button>
          </div>
          {slot === "abend" && (
            <label style={styles.checkLabel}>
              <input type="checkbox" checked={alsoLunch} onChange={e => setAlsoLunch(e.target.checked)} style={{ marginRight: 6 }} />
              Auch morgen Mittag
            </label>
          )}
          <button style={styles.saveBtn} onClick={handleSave}>Speichern</button>
        </div>
      )}
    </div>
  );
}

// ── Shopping Page ─────────────────────────────────────────────────────────────
function ShoppingPage({ shopping, token, wk, loadShopping, sb }) {
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newCat, setNewCat] = useState("Sonstiges");

  const CATS = ["Gemüse & Früchte", "Fleisch & Fisch", "Milchprodukte", "Getreide & Backwaren", "Hülsenfrüchte", "Gewürze & Saucen", "Konserven", "Tiefkühl", "Sonstiges"];

  const grouped = CATS.reduce((acc, cat) => {
    const items = shopping.filter(s => s.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  async function toggleCheck(item) {
    await sb.updateShoppingItem(token, item.id, { checked: !item.checked });
    await loadShopping();
  }

  async function updateAmount(item, amount) {
    await sb.updateShoppingItem(token, item.id, { amount });
    await loadShopping();
  }

  async function deleteItem(id) {
    await sb.deleteShoppingItem(token, id);
    await loadShopping();
  }

  async function addItem() {
    if (!newName.trim()) return;
    await sb.upsertShoppingItem(token, {
      week_start: wk, name: newName.trim(), amount: newAmount, category: newCat, checked: false, manual: true,
    });
    setNewName(""); setNewAmount("");
    await loadShopping();
  }

  const total = shopping.length;
  const done = shopping.filter(s => s.checked).length;

  return (
    <div style={styles.shoppingWrap}>
      {/* Progress */}
      <div style={styles.progressCard}>
        <div style={styles.progressTop}>
          <span style={styles.progressLabel}>Einkaufsliste</span>
          <span style={styles.progressCount}>{done} / {total} erledigt</span>
        </div>
        <div style={styles.progressBar}>
          <div style={{ ...styles.progressFill, width: total ? `${(done / total) * 100}%` : "0%" }} />
        </div>
      </div>

      {/* Add item */}
      <div style={styles.addCard}>
        <input style={{ ...styles.input, marginBottom: 0, flex: 1 }} placeholder="Zutat hinzufügen…" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && addItem()} />
        <input style={{ ...styles.input, marginBottom: 0, width: 100 }} placeholder="Menge" value={newAmount} onChange={e => setNewAmount(e.target.value)} />
        <select style={styles.select} value={newCat} onChange={e => setNewCat(e.target.value)}>
          {CATS.map(c => <option key={c}>{c}</option>)}
        </select>
        <button style={styles.addBtn} onClick={addItem}>+ Hinzufügen</button>
      </div>

      {/* Items */}
      {Object.keys(grouped).length === 0 && (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>🛒</div>
          <p>Noch keine Einträge. Menüs erfassen und Einkaufsliste generieren!</p>
        </div>
      )}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} style={styles.catSection}>
          <div style={styles.catHeader}>{cat}</div>
          {items.map(item => (
            <div key={item.id} style={{ ...styles.shoppingItem, ...(item.checked ? styles.shoppingItemDone : {}) }}>
              <button style={styles.checkCircle} onClick={() => toggleCheck(item)}>
                {item.checked ? "✓" : ""}
              </button>
              <span style={{ ...styles.itemName, ...(item.checked ? styles.strikethrough : {}) }}>{item.name}</span>
              <input
                style={styles.amountInput}
                value={item.amount || ""}
                onChange={e => updateAmount(item, e.target.value)}
                placeholder="Menge"
              />
              <button style={styles.deleteItemBtn} onClick={() => deleteItem(item.id)}>✕</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const C = {
  bg: "#0f1117",
  surface: "#1a1d27",
  card: "#22263a",
  border: "#2e3250",
  accent: "#6c8fff",
  accentGlow: "rgba(108,143,255,0.15)",
  green: "#4caf82",
  text: "#e8eaf6",
  muted: "#8b90b0",
  danger: "#ff6b6b",
  today: "rgba(108,143,255,0.08)",
};

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${C.bg}; color: ${C.text}; font-family: 'DM Sans', sans-serif; }
  ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: ${C.bg}; } ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
  input, select { color: ${C.text}; background: ${C.surface}; }
  input::placeholder { color: ${C.muted}; }
  a { color: ${C.accent}; }
`;

const styles = {
  app: { minHeight: "100vh", background: C.bg, color: C.text },
  header: { position: "sticky", top: 0, zIndex: 100, background: C.surface, borderBottom: `1px solid ${C.border}`, backdropFilter: "blur(12px)" },
  headerInner: { maxWidth: 1200, margin: "0 auto", padding: "12px 24px", display: "flex", alignItems: "center", gap: 16 },
  logo: { display: "flex", alignItems: "center", gap: 10, marginRight: "auto" },
  logoIcon: { fontSize: 24 },
  logoText: { fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 300, letterSpacing: "-0.5px", color: C.text },
  nav: { display: "flex", gap: 8 },
  navBtn: { padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 13, fontFamily: "inherit", transition: "all .15s" },
  navActive: { background: C.accentGlow, border: `1px solid ${C.accent}`, color: C.accent },
  headerRight: { display: "flex", gap: 8, alignItems: "center" },
  sqlBtn: { padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 14 },
  logoutBtn: { padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 12, fontFamily: "inherit" },
  sqlBox: { background: "#1a1200", border: `1px solid #554400`, margin: "16px 24px", borderRadius: 10, padding: 16, maxWidth: 900 },
  sqlPre: { background: "#111", borderRadius: 6, padding: 12, fontSize: 11, overflowX: "auto", color: "#adb", marginTop: 8, marginBottom: 8 },
  closeBtn: { padding: "4px 12px", borderRadius: 6, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, cursor: "pointer", fontSize: 12 },
  main: { maxWidth: 1200, margin: "0 auto", padding: "24px 16px" },

  // Week nav
  weekNav: { display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 24 },
  weekBtn: { padding: "8px 18px", borderRadius: 8, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  weekLabel: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 300, color: C.text, minWidth: 180, textAlign: "center" },

  // Days grid
  daysGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, overflowX: "auto" },
  dayCol: { minWidth: 130, background: C.surface, borderRadius: 12, border: `1px solid ${C.border}`, padding: 8, display: "flex", flexDirection: "column", gap: 6 },
  dayColToday: { border: `1px solid ${C.accent}`, background: C.today },
  dayHeader: { padding: "4px 4px 8px", borderBottom: `1px solid ${C.border}`, marginBottom: 2 },
  dayName: { display: "block", fontSize: 12, fontWeight: 600, color: C.text, letterSpacing: "0.5px" },
  dayDate: { display: "block", fontSize: 11, color: C.muted, marginTop: 2 },

  // Tile
  tile: { background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 8, minHeight: 60, transition: "border-color .15s" },
  tileActive: { border: `1px solid ${C.border}`, background: "#1e2235" },
  tileHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  slotLabel: { fontSize: 10, color: C.muted, fontWeight: 500 },
  tileActions: { display: "flex", gap: 4 },
  iconBtn: { width: 20, height: 20, borderRadius: 4, border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 },
  mealInfo: { display: "flex", flexDirection: "column", gap: 3 },
  mealName: { fontSize: 12, fontWeight: 500, color: C.text, lineHeight: 1.3 },
  mealLink: { fontSize: 11, color: C.accent },
  mealMeta: { fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  lunchBadge: { background: C.accentGlow, color: C.accent, padding: "1px 6px", borderRadius: 4, fontSize: 9 },

  // Edit form
  editForm: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 },
  tileInput: { width: "100%", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 5, padding: "5px 7px", fontSize: 11, color: C.text, fontFamily: "inherit", outline: "none" },
  personRow: { display: "flex", alignItems: "center", gap: 6 },
  personLabel: { fontSize: 10, color: C.muted, flex: 1 },
  countBtn: { width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.border}`, background: C.surface, color: C.text, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" },
  personCount: { fontSize: 13, fontWeight: 600, minWidth: 18, textAlign: "center" },
  checkLabel: { fontSize: 11, color: C.muted, display: "flex", alignItems: "center", cursor: "pointer" },
  saveBtn: { background: C.accent, color: "#fff", border: "none", borderRadius: 5, padding: "5px 0", fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 600 },

  // Generate button
  generateWrap: { display: "flex", justifyContent: "center", marginTop: 28 },
  generateBtn: { padding: "12px 32px", borderRadius: 10, background: C.accent, border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", boxShadow: `0 0 24px ${C.accentGlow}`, transition: "opacity .15s" },

  // Login
  loginWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: `radial-gradient(ellipse at 50% 30%, rgba(108,143,255,0.1) 0%, ${C.bg} 70%)` },
  loginCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 40, width: 380, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 24px 64px rgba(0,0,0,0.5)" },
  loginLogo: { fontSize: 48, textAlign: "center" },
  loginTitle: { fontFamily: "'Fraunces', serif", fontWeight: 300, fontSize: 32, textAlign: "center", letterSpacing: "-1px" },
  loginSub: { textAlign: "center", color: C.muted, fontSize: 14, marginTop: -8 },
  loginTabs: { display: "flex", gap: 0, background: C.card, borderRadius: 8, padding: 3 },
  tab: { flex: 1, padding: "8px 0", borderRadius: 6, border: "none", background: "transparent", color: C.muted, cursor: "pointer", fontSize: 13, fontFamily: "inherit" },
  tabActive: { background: C.surface, color: C.text, boxShadow: "0 1px 4px rgba(0,0,0,0.3)" },
  input: { width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 14, color: C.text, fontFamily: "inherit", outline: "none", marginBottom: 0 },
  error: { color: C.danger, fontSize: 12, textAlign: "center" },
  primaryBtn: { padding: "12px 0", borderRadius: 8, background: C.accent, border: "none", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", marginTop: 4 },

  // Shopping
  shoppingWrap: { maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 },
  progressCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 },
  progressTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  progressLabel: { fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 300 },
  progressCount: { color: C.muted, fontSize: 13 },
  progressBar: { height: 6, background: C.card, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", background: C.green, borderRadius: 3, transition: "width .3s ease" },
  addCard: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  select: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 10px", fontSize: 12, color: C.text, fontFamily: "inherit", outline: "none" },
  addBtn: { padding: "10px 16px", borderRadius: 8, background: C.accent, border: "none", color: "#fff", fontSize: 13, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap" },
  emptyState: { textAlign: "center", padding: "48px 24px", color: C.muted },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  catSection: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" },
  catHeader: { padding: "10px 16px", background: C.card, fontSize: 12, fontWeight: 600, color: C.muted, textTransform: "uppercase", letterSpacing: "0.8px", borderBottom: `1px solid ${C.border}` },
  shoppingItem: { display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: `1px solid ${C.border}`, transition: "background .15s" },
  shoppingItemDone: { opacity: 0.5 },
  checkCircle: { width: 22, height: 22, borderRadius: "50%", border: `2px solid ${C.border}`, background: "transparent", cursor: "pointer", fontSize: 11, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  itemName: { flex: 1, fontSize: 14, color: C.text },
  strikethrough: { textDecoration: "line-through", color: C.muted },
  amountInput: { width: 90, background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 8px", fontSize: 12, color: C.muted, fontFamily: "inherit", outline: "none" },
  deleteItemBtn: { background: "transparent", border: "none", color: C.muted, cursor: "pointer", fontSize: 12, padding: "2px 4px" },
};
