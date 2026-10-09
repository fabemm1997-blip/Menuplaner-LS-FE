export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  const email = process.env.MIGROS_EMAIL;
  const password = process.env.MIGROS_PASSWORD;
  const results = { email_set: !!email, password_set: !!password, steps: [] };

  try {
    // Step 1: Fetch login page
    const step1 = await fetch("https://login.migros.ch/account", {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "de-CH,de;q=0.9",
      },
      redirect: "follow",
    });

    const cookies1 = step1.headers.get("set-cookie") || "";
    const html1 = await step1.text();
    const csrfMatch = html1.match(/name="_csrf"\s+value="([^"]+)"/) ||
                      html1.match(/"csrfToken"\s*:\s*"([^"]+)"/) ||
                      html1.match(/csrf[_-]token['"]\s*content=['"]([^'"]+)/i) ||
                      html1.match(/window\.__NUXT__.*?csrf.*?['"]([a-zA-Z0-9_-]{20,})['"]/);

    results.steps.push({
      step: "1_login_page",
      status: step1.status,
      url: step1.url,
      cookies: cookies1.slice(0, 200),
      csrf_found: !!csrfMatch,
      csrf_value: csrfMatch ? csrfMatch[1].slice(0, 20) + "..." : null,
      html_snippet: html1.slice(0, 300),
    });

    // Step 2: Try guest token to see if API works at all
    const step2 = await fetch("https://www.migros.ch/authentication/public/v1/api/guest", {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
        "Accept": "application/json",
      },
    });
    const cookies2 = step2.headers.get("set-cookie") || "";
    results.steps.push({
      step: "2_guest_token",
      status: step2.status,
      leshopch_found: cookies2.includes("leshopch"),
      cookies: cookies2.slice(0, 200),
    });

    // Step 3: Try login API directly
    const step3 = await fetch("https://login.migros.ch/account/login", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: email, password }),
      redirect: "follow",
    });
    const body3 = await step3.text();
    results.steps.push({
      step: "3_login_post",
      status: step3.status,
      url: step3.url,
      cookies: (step3.headers.get("set-cookie") || "").slice(0, 200),
      body_snippet: body3.slice(0, 300),
    });

  } catch (e) {
    results.error = e.message;
  }

  return res.status(200).json(results);
}
