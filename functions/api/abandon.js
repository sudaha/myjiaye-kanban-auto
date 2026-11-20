// 放弃项目云端同步 API（Cloudflare Pages Functions + KV）
// GET  /api/abandon          -> { ok, items: {id: {title, platform, at}} }
// POST /api/abandon          -> body {id, platform, title, action: "abandon"|"restore"}
// 轻量口令防护：写操作需带 x-abandon-token（与前端 app.js 的 ABANDON_TOKEN 一致）。
// 注意：这是防误写而非真鉴权，token 会随前端代码下发，团队内部使用可接受。
const KEY = "abandoned";
const TOKEN = "jiaye-abandon-95306";

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function onRequestGet(context) {
  const map = (await context.env.ABANDONED.get(KEY, "json")) || {};
  return json({ ok: true, items: map });
}

export async function onRequestPost(context) {
  if (context.request.headers.get("x-abandon-token") !== TOKEN) {
    return json({ ok: false, error: "forbidden" }, 403);
  }
  let body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json({ ok: false, error: "bad json" }, 400);
  }
  const id = String(body.id || "");
  if (!id || id.length > 128) return json({ ok: false, error: "bad id" }, 400);
  const map = (await context.env.ABANDONED.get(KEY, "json")) || {};
  if (body.action === "restore") {
    delete map[id];
  } else {
    map[id] = {
      title: String(body.title || "").slice(0, 120),
      platform: String(body.platform || "rail").slice(0, 16),
      at: new Date().toISOString().slice(0, 16).replace("T", " "),
    };
  }
  await context.env.ABANDONED.put(KEY, JSON.stringify(map));
  return json({ ok: true, id });
}
