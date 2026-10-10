import { requireUser } from "./_auth.js";

// Migros Shopping List Integration
// Uses unofficial Migros API - may break if Migros changes their API

const MIGROS_LOGIN_URL = "https://login.migros.ch";
const MIGROS_API_URL = "https://www.migros.ch";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "de-CH,de;q=0.9",
  "Origin": "https://www.migros.ch",
  "Referer": "https://www.migros.ch/",
};

function parseCookies(headers) {
  const cookies = {};
  const raw = headers.get ? headers.get("set-cookie") : headers["set-cookie"];
  if (!raw) return cookies;
  const parts = Array.isArray(raw) ? raw : [raw];
  for (const part of parts) {
    const [kv] = part.split(";");
    const [k, v] = kv.split("=");
    if (k && v) cookies[k.trim()] = v.trim();
  }
  return cookies;
}

function cookieString(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}

async function getMigrosSession() {
  const email = process.env.MIGROS_EMAIL;
  const password = process.env.MIGROS_PASSWORD;
  if (!email || !password) throw new Error("MIGROS_EMAIL oder MIGROS_PASSWORD fehlt in Env Vars");

  // Step 1: Get CSRF token + initial cookies
  const initRes = await fetch(`${MIGROS_LOGIN_URL}/account`, {
    headers: DEFAULT_HEADERS,
    redirect: "follow",
  });
  const initCookies = parseCookies(initRes.headers);
  const initHtml = await initRes.text();

  // Extract CSRF token
  const csrfMatch = initHtml.match(/name="_csrf"\s+value="([^"]+)"/) ||
                    initHtml.match(/"csrfToken"\s*:\s*"([^"]+)"/) ||
                    initHtml.match(/csrf[_-]token['"]\s*content=['"]([^'"]+)/i);
  const csrf = csrfMatch ? csrfMatch[1] : null;

  // Step 2: Login POST
  const loginBody = new URLSearchParams({
    username: email,
    password: password,
    ...(csrf ? { _csrf: csrf } : {}),
  });

  const loginRes = await fetch(`${MIGROS_LOGIN_URL}/account/login`, {
    method: "POST",
    headers: {
      ...DEFAULT_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": cookieString(initCookies),
      ...(csrf ? { "X-CSRF-TOKEN": csrf } : {}),
    },
    body: loginBody.toString(),
    redirect: "follow",
  });

  const loginCookies = { ...initCookies, ...parseCookies(loginRes.headers) };

  // Step 3: Get leshopch token
  const tokenRes = await fetch(`${MIGROS_API_URL}/authentication/public/v1/api/login`, {
    method: "POST",
    headers: {
      ...DEFAULT_HEADERS,
      "Cookie": cookieString(loginCookies),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  const tokenCookies = { ...loginCookies, ...parseCookies(tokenRes.headers) };
  const leshopch = tokenCookies["leshopch"];

  if (!leshopch) {
    // Try guest token as fallback
    const guestRes = await fetch(`${MIGROS_API_URL}/authentication/public/v1/api/guest`, {
      headers: { ...DEFAULT_HEADERS },
    });
    const guestCookies = parseCookies(guestRes.headers);
    return { token: guestCookies["leshopch"], cookies: guestCookies, isGuest: true };
  }

  return { token: leshopch, cookies: tokenCookies, isGuest: false };
}

async function searchProduct(query, token) {
  const url = `${MIGROS_API_URL}/product-display/public/v1/api/search?q=${encodeURIComponent(query)}&from=0&size=3&lang=de`;
  const res = await fetch(url, {
    headers: { ...DEFAULT_HEADERS, "Cookie": `leshopch=${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const products = data?.hits?.hit || data?.results || [];
  if (!products.length) return null;
  const first = products[0];
  return {
    id: first.fields?.migrosid || first.migrosId || first.id,
    name: first.fields?.name || first.name,
    quantity: 1,
  };
}

async function addToShoppingList(products, token, cookies) {
  // Try Migros shopping list API
  const items = products.map(p => ({ migrosId: p.id, quantity: p.quantity || 1 }));
  const res = await fetch(`${MIGROS_API_URL}/shoppinglist/public/v1/api/items`, {
    method: "POST",
    headers: {
      ...DEFAULT_HEADERS,
      "Content-Type": "application/json",
      "Cookie": cookieString({ ...cookies, leshopch: token }),
    },
    body: JSON.stringify({ items }),
  });
  return res.ok ? await res.json() : null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (!(await requireUser(req, res))) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { items } = req.body;
  if (!items?.length) return res.status(400).json({ error: "Keine Produkte angegeben" });

  try {
    // Step 1: Login
    const session = await getMigrosSession();
    if (!session.token) return res.status(401).json({ error: "Migros Login fehlgeschlagen. Bitte Email/Passwort in Vercel prüfen." });
    if (session.isGuest) return res.status(401).json({ error: "Login nicht möglich – nur als Gast eingeloggt. Bitte Email/Passwort prüfen." });

    // Step 2: Search each item
    const found = [];
    const notFound = [];
    for (const item of items) {
      const product = await searchProduct(item.name, session.token);
      if (product) found.push({ ...product, originalName: item.name });
      else notFound.push(item.name);
    }

    if (!found.length) {
      return res.status(200).json({ success: false, error: "Keine Produkte gefunden", notFound });
    }

    // Step 3: Add to shopping list
    const result = await addToShoppingList(found, session.token, session.cookies);

    return res.status(200).json({
      success: true,
      added: found.map(f => f.originalName),
      notFound,
      count: found.length,
      listResult: result,
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
