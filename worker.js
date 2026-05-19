const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

const memoryStore = globalThis.__MYLITTLESYS_STORE__ || new Map();
globalThis.__MYLITTLESYS_STORE__ = memoryStore;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: JSON_HEADERS });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "mylittlesys", storage: storageMode(env) });
    }

    if (url.pathname === "/calendar") {
      return renderCalendar(url);
    }

    if (url.pathname.startsWith("/api/rpc/")) {
      const method = decodeURIComponent(url.pathname.slice("/api/rpc/".length));
      return handleRpc(request, env, method);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("mylittlesys worker is running", {
      headers: { "content-type": "text/plain; charset=utf-8" }
    });
  }
};

async function handleRpc(request, env, method) {
  try {
    if (request.method !== "POST") {
      return json({ error: "POST required" }, 405);
    }

    const body = await request.json().catch(() => ({}));
    const args = Array.isArray(body.args) ? body.args : [];

    if (!rpcHandlers[method]) {
      return json({ error: `Unknown RPC method: ${method}` }, 404);
    }

    const result = await rpcHandlers[method](env, ...args);
    return json({ result });
  } catch (error) {
    return json({ error: error.message || String(error) }, 500);
  }
}

const rpcHandlers = {
  getWebAppUrl: async () => "",
  runMeToAuthorizeDrive: async () => ({ success: true }),

  loginUser: async (env, username, password) => {
    const users = await getUsers(env);
    const user = users.find((item) => item.username === username && item.password === password);
    if (!user) return { success: false, msg: "帳號或密碼錯誤" };
    const { password: _password, ...publicUser } = user;
    return { success: true, user: publicUser };
  },

  getAllUsers: async (env) => {
    const users = await getUsers(env);
    return users.map(({ password, ...user }) => ({ ...user, password: "" }));
  },

  saveUserData: async (env, userData) => {
    const incoming = normalizeUser(userData || {});
    if (!incoming.username) return { success: false, msg: "缺少帳號" };

    const users = await getUsers(env);
    const existingIndex = users.findIndex((user) => user.username === incoming.username);
    if (existingIndex >= 0) {
      users[existingIndex] = {
        ...users[existingIndex],
        ...incoming,
        password: incoming.password || users[existingIndex].password
      };
    } else {
      users.push({ ...incoming, password: incoming.password || "123456" });
    }
    await setRecord(env, "users", users);
    return { success: true };
  },

  getMyMenus: async (env, username) => {
    const projects = await getProjects(env, "richmenu");
    return filterProjects(projects, username);
  },

  getAllFlexProjects: async (env, username) => {
    const all = [
      ...(await getProjects(env, "flex_v1")),
      ...(await getProjects(env, "flex_v2")),
      ...(await getProjects(env, "flex_v3"))
    ];
    return filterProjects(all, username);
  },

  saveRichMenu: async (env, data) => saveProject(env, "richmenu", data),
  saveFlexToSheet: async (env, data) => saveProject(env, "flex_v1", data),
  saveFlexV1: async (env, data) => saveProject(env, "flex_v1", data),
  saveFlexV2: async (env, data) => saveProject(env, "flex_v2", data),
  saveFlexV3: async (env, data) => saveProject(env, "flex_v3", data),

  uploadImageToDrive: async (env, base64, filename) => {
    const id = crypto.randomUUID();
    await setRecord(env, `image:${id}`, {
      id,
      filename: filename || "upload.png",
      base64,
      createdAt: new Date().toISOString()
    });
    return { success: true, url: `kv://${id}`, id };
  },

  getMenuImageBase64: async (env, imageRef) => {
    if (!imageRef) return "";
    if (String(imageRef).startsWith("data:")) return imageRef;
    if (String(imageRef).startsWith("kv://")) {
      const image = await getRecord(env, `image:${String(imageRef).slice(5)}`, null);
      return image?.base64 || "";
    }
    return imageRef;
  },

  publishRichMenuToLine: async (_env, token, jsonText, imageBase64) => {
    if (!token) return { success: false, msg: "缺少 LINE Channel Access Token" };
    const config = JSON.parse(jsonText);
    const lineBody = {
      size: config.size,
      selected: true,
      name: config.name || config.chatBarText || "Rich Menu",
      chatBarText: config.chatBarText || "選單",
      areas: Array.isArray(config.areas) ? config.areas : []
    };

    const createRes = await fetch("https://api.line.me/v2/bot/richmenu", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(lineBody)
    });
    const createText = await createRes.text();
    if (!createRes.ok) return { success: false, msg: createText };
    const created = JSON.parse(createText);

    const image = dataUriToBytes(imageBase64);
    const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${created.richMenuId}/content`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": image.contentType
      },
      body: image.bytes
    });
    if (!uploadRes.ok) return { success: false, msg: await uploadRes.text(), richMenuId: created.richMenuId };

    const defaultRes = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${created.richMenuId}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` }
    });
    if (!defaultRes.ok) return { success: false, msg: await defaultRes.text(), richMenuId: created.richMenuId };

    return { success: true, richMenuId: created.richMenuId };
  },

  fetchMonthEvents: async () => [],

  getLineVoomMedia: async (_env, targetUrl) => {
    if (!targetUrl) return { success: false, msg: "缺少網址" };
    const html = await fetchText(targetUrl);
    return { success: true, media: extractMedia(html, targetUrl) };
  },

  extractMediaFromJsonData: async (_env, data) => extractMedia(JSON.stringify(data || {}), ""),
  findMediaInObject: async (_env, data) => extractMedia(JSON.stringify(data || {}), ""),
  getMetaTagContent: async (_env, targetUrl) => {
    const html = await fetchText(targetUrl);
    return { success: true, meta: extractMeta(html) };
  }
};

async function saveProject(env, sheet, data = {}) {
  if (!data.username || !data.filename) return { success: false, msg: "缺少 username 或 filename" };

  const projects = await getProjects(env, sheet);
  const now = new Date().toISOString();
  const record = {
    sheet,
    username: data.username,
    company: data.company || "",
    filename: data.filename,
    json: data.json || "{}",
    image: data.image || "",
    time: now
  };
  const index = projects.findIndex((item) => item.username === record.username && item.filename === record.filename);
  if (index >= 0) projects[index] = { ...projects[index], ...record };
  else projects.unshift(record);

  await setRecord(env, `projects:${sheet}`, projects);
  return { success: true };
}

async function getProjects(env, sheet) {
  return getRecord(env, `projects:${sheet}`, []);
}

function filterProjects(projects, username) {
  if (username === "admin") return projects;
  return projects.filter((item) => item.username === username);
}

async function getUsers(env) {
  const configuredUser = env.ADMIN_USER || "admin";
  const configuredPass = env.ADMIN_PASS || "admin123";
  const users = await getRecord(env, "users", null);
  if (users) return users;
  return [
    normalizeUser({
      username: configuredUser,
      password: configuredPass,
      name: "系統管理員",
      permissions: "12345",
      rmQuota: "∞",
      flexQuota: "∞"
    }),
    normalizeUser({
      username: "demo",
      password: "demo123",
      name: "Demo User",
      permissions: "12",
      rmQuota: "10",
      flexQuota: "20"
    })
  ];
}

function normalizeUser(user) {
  return {
    username: String(user.username || "").trim(),
    password: String(user.password || ""),
    name: String(user.name || user.username || ""),
    permissions: String(user.permissions || "12"),
    rmQuota: String(user.rmQuota || user.richMenuQuota || "10"),
    flexQuota: String(user.flexQuota || "20")
  };
}

async function getRecord(env, key, fallback) {
  if (env.MYLITTLESYS_KV) {
    const value = await env.MYLITTLESYS_KV.get(key, "json");
    return value ?? fallback;
  }
  return memoryStore.has(key) ? memoryStore.get(key) : fallback;
}

async function setRecord(env, key, value) {
  if (env.MYLITTLESYS_KV) {
    await env.MYLITTLESYS_KV.put(key, JSON.stringify(value));
    return;
  }
  memoryStore.set(key, value);
}

function storageMode(env) {
  return env.MYLITTLESYS_KV ? "kv" : "memory";
}

function dataUriToBytes(dataUri) {
  const match = String(dataUri || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("圖片格式必須是 data URI base64");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { contentType: match[1], bytes };
}

async function fetchText(targetUrl) {
  const res = await fetch(targetUrl, {
    headers: { "user-agent": "mylittlesys-worker/1.0" }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.text();
}

function extractMeta(html) {
  const meta = {};
  for (const match of html.matchAll(/<meta\s+[^>]*(?:property|name)=["']([^"']+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi)) {
    meta[match[1]] = decodeHtml(match[2]);
  }
  return meta;
}

function extractMedia(text, baseUrl) {
  const media = [];
  const seen = new Set();
  const patterns = [
    /https?:\/\/[^"'\s<>]+?\.(?:jpg|jpeg|png|gif|webp|mp4|mov)(?:\?[^"'\s<>]*)?/gi,
    /<meta\s+[^>]*(?:property|name)=["'](?:og:image|og:video|twitter:image)["'][^>]*content=["']([^"']+)["'][^>]*>/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1] || match[0];
      const url = absolutize(decodeHtml(raw), baseUrl);
      if (url && !seen.has(url)) {
        seen.add(url);
        media.push({ url });
      }
    }
  }
  return media;
}

function absolutize(value, baseUrl) {
  try {
    return new URL(value, baseUrl || undefined).toString();
  } catch {
    return value;
  }
}

function decodeHtml(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function renderCalendar(url) {
  const cid = url.searchParams.get("cid") || "";
  const embed = cid
    ? `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(cid)}&ctz=Asia%2FTaipei`
    : "";
  return new Response(`<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>行事曆查詢</title>
  <style>
    body { margin: 0; font-family: system-ui, "Noto Sans TC", sans-serif; background: #f8fafc; color: #0f172a; }
    .empty { min-height: 100vh; display: grid; place-items: center; text-align: center; padding: 32px; }
    iframe { width: 100vw; height: 100vh; border: 0; display: block; }
  </style>
</head>
<body>
  ${embed ? `<iframe src="${embed}" title="Google Calendar"></iframe>` : `<main class="empty"><div><h1>行事曆查詢</h1><p>請在上方輸入 Google Calendar ID 後重新整理。</p></div></main>`}
</body>
</html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
