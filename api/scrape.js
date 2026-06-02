export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { url } = req.method === "POST" ? req.body : req.query;
  if (!url) {
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Scrape Test</title>
  <style>
    body { font-family: sans-serif; max-width: 700px; margin: 40px auto; padding: 0 16px; background: #0f1117; color: #e8eaf6; }
    input { width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #2e3250; background: #1a1d27; color: #e8eaf6; font-size: 14px; box-sizing: border-box; margin-top: 8px; }
    button { margin-top: 10px; padding: 10px 24px; border-radius: 8px; border: none; background: #6c8fff; color: #fff; font-size: 14px; cursor: pointer; }
    pre { background: #1a1d27; border: 1px solid #2e3250; border-radius: 8px; padding: 16px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; word-break: break-all; margin-top: 12px; }
    .status { margin-top: 10px; font-size: 13px; }
    .ok { color: #4caf82; } .err { color: #ff6b6b; } .warn { color: #ffb347; }
  </style>
</head>
<body>
  <h2>🔍 Rezept URL Scrape + Extract Test</h2>
  <input id="url" type="text" placeholder="https://www.fooby.ch/de/rezepte/..." />
  <button onclick="test()">Testen</button>
  <div class="status" id="status"></div>
  <pre id="result" style="display:none"></pre>
  <script>
    async function test() {
      const url = document.getElementById("url").value.trim();
      if (!url) return;
      document.getElementById("status").textContent = "⏳ Lade und extrahiere…";
      document.getElementById("status").className = "status";
      document.getElementById("result").style.display = "none";
      try {
        const r = await fetch("/api/scrape?url=" + encodeURIComponent(url));
        const data = await r.json();
        const cls = data.success ? "ok" : "err";
        document.getElementById("status").textContent = data.success
          ? "✅ Erfolg – Methode: " + data.method + (data.ingredients?.length ? " – " + data.ingredients.length + " Zutaten" : "")
          : "❌ " + data.error;
        document.getElementById("status").className = "status " + cls;
        document.getElementById("result").style.display = "block";
        document.getElementById("result").textContent = JSON.stringify(data, null, 2);
      } catch(e) {
        document.getElementById("status").textContent = "❌ " + e.message;
        document.getElementById("status").className = "status err";
      }
    }
  </script>
</body>
</html>`);
  }

  try {
    // Step 1: Fetch the page
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "de-CH,de;q=0.9",
      },
    });

    if (!response.ok) return res.status(200).json({ success: false, error: `HTTP ${response.status}` });

    const html = await response.text();

    // Step 2: Try schema.org/Recipe JSON-LD
    const jsonLdBlocks = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
    let recipeData = null;

    for (const block of jsonLdBlocks) {
      try {
        const inner = block.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
        const parsed = JSON.parse(inner);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item["@type"] === "Recipe") { recipeData = item; break; }
          if (Array.isArray(item["@type"]) && item["@type"].includes("Recipe")) { recipeData = item; break; }
          if (item["@graph"]) {
            const r = item["@graph"].find(g => g["@type"] === "Recipe");
            if (r) { recipeData = r; break; }
          }
        }
      } catch {}
      if (recipeData) break;
    }

    // Step 3: If schema.org found, parse ingredients
    if (recipeData) {
      const rawIngredients = recipeData.recipeIngredient || [];

      // If ingredients is already a clean array → use Claude to structure them
      const ingredientText = Array.isArray(rawIngredients)
        ? rawIngredients.join("\n")
        : String(rawIngredients);

      const structured = await claudeParseIngredients(ingredientText, recipeData.name, recipeData.recipeYield);

      return res.status(200).json({
        success: true,
        method: "schema.org → Claude strukturiert",
        name: recipeData.name,
        servings: recipeData.recipeYield,
        ingredients: structured,
        raw_ingredients: rawIngredients,
      });
    }

    // Step 4: No schema.org → send HTML snippet to Claude
    // Extract body text, remove scripts/styles
    const cleanHtml = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 6000);

    const structured = await claudeExtractFromHtml(cleanHtml, url);

    if (structured && structured.length > 0) {
      return res.status(200).json({
        success: true,
        method: "HTML → Claude extrahiert",
        ingredients: structured,
      });
    }

    return res.status(200).json({ success: false, error: "Keine Zutaten gefunden", htmlLength: html.length });

  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
}

async function claudeParseIngredients(ingredientText, recipeName, servings) {
  const prompt = `Strukturiere diese Zutatenliste aus dem Rezept "${recipeName || ""}" (${servings || "?"} Portionen) in ein JSON-Array.
Zutatenliste:
${ingredientText}

Antworte NUR mit JSON-Array:
[{"name":"Zutat","amount":200,"unit":"g","category":"Gemüse & Früchte"}]
Kategorien: Gemüse & Früchte, Fleisch & Fisch, Milchprodukte, Getreide & Backwaren, Hülsenfrüchte, Gewürze & Saucen, Konserven, Tiefkühl, Sonstiges
"amount" ist eine Zahl (0 wenn keine Menge angegeben). Kein Text, kein Markdown.`;

  return await callClaude(prompt);
}

async function claudeExtractFromHtml(text, url) {
  const prompt = `Extrahiere die Zutatenliste aus diesem Rezept-Text von ${url}.

Text:
${text}

Antworte NUR mit JSON-Array:
[{"name":"Zutat","amount":200,"unit":"g","category":"Gemüse & Früchte"}]
Kategorien: Gemüse & Früchte, Fleisch & Fisch, Milchprodukte, Getreide & Backwaren, Hülsenfrüchte, Gewürze & Saucen, Konserven, Tiefkühl, Sonstiges
"amount" ist eine Zahl. Falls keine Zutaten erkennbar, antworte mit leerem Array []. Kein Text, kein Markdown.`;

  return await callClaude(prompt);
}

async function callClaude(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const d = await r.json();
    const text = d.content?.map(b => b.text || "").join("") || "";
    const s = text.replace(/```json|```/gi, "").trim();
    const start = s.indexOf("["), end = s.lastIndexOf("]");
    if (start === -1 || end === -1) return [];
    return JSON.parse(s.slice(start, end + 1));
  } catch { return []; }
}
