/* ============================================================
   Cloudflare Pages Function — /api/schedule
   GET  → публічне читання розкладу з KV (без пароля)
   PUT  → запис розкладу в KV (потребує X-Edit-Password)
   Прив'язки (Cloudflare Dashboard → Pages → Settings):
     - KV namespace: SCHEDULE_KV
     - Environment variable: EDIT_PASSWORD (Secret)
   ============================================================ */

const KV_KEY = "schedule";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Edit-Password",
  "Access-Control-Max-Age": "86400"
};

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  ...CORS_HEADERS
};

function json(body, status){
  return new Response(JSON.stringify(body), { status: status || 200, headers: JSON_HEADERS });
}

/* ---------- OPTIONS (CORS preflight) ---------- */
export async function onRequestOptions(){
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/* ---------- GET: публічне читання ---------- */
export async function onRequestGet(context){
  const { env } = context;
  if (!env.SCHEDULE_KV) return json({ error: "KV не налаштовано" }, 500);

  try {
    const raw = await env.SCHEDULE_KV.get(KV_KEY);
    if (!raw){
      return json({ version: 1, children: [], updatedAt: null });
    }
    const parsed = JSON.parse(raw);
    return json(parsed);
  } catch (e){
    return json({ error: "Не вдалося прочитати дані", detail: String(e) }, 500);
  }
}

/* ---------- PUT: запис (потребує пароль) ---------- */
export async function onRequestPut(context){
  const { request, env } = context;
  if (!env.SCHEDULE_KV) return json({ error: "KV не налаштовано" }, 500);
  if (!env.EDIT_PASSWORD) return json({ error: "EDIT_PASSWORD не налаштовано" }, 500);

  const provided = request.headers.get("X-Edit-Password") || "";
  if (provided !== env.EDIT_PASSWORD){
    return json({ error: "Невірний пароль" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (e){
    return json({ error: "Некоректний JSON" }, 400);
  }

  if (!body || typeof body !== "object" || !Array.isArray(body.children)){
    return json({ error: "Відсутнє поле children" }, 400);
  }

  body.updatedAt = new Date().toISOString();

  try {
    await env.SCHEDULE_KV.put(KV_KEY, JSON.stringify(body));
    return json({ ok: true, updatedAt: body.updatedAt });
  } catch (e){
    return json({ error: "Не вдалося зберегти", detail: String(e) }, 500);
  }
}

/* ---------- Fallback для інших методів ---------- */
export async function onRequest(context){
  return json({ error: "Метод не підтримується" }, 405);
}