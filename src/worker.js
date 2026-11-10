const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });

const uid = () => crypto.randomUUID();
const encoder = new TextEncoder();
const COOKIE = "ssb_session";
const SESSION_SECONDS = 60 * 60 * 24 * 14;

function cookieValue(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const item = raw.split(";")
    .map(v => v.trim())
    .find(v => v.startsWith(name + "="));

  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

function setCookie(token) {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_SECONDS}`;
}

function clearCookie() {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}


async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: "SHA-256"
    },
    key,
    256
  );

  return [...new Uint8Array(bits)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}


async function currentUser(request, env) {
  const token = cookieValue(request, COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id,u.name,u.email,u.role
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?
  `).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
  return row || null;
}

async function requireUser(request, env) {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, "Please sign in to continue.");
  return user;
}
async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (user.role !== "admin") throw new HttpError(403, "Administrator access required.");
  return user;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function bodyJson(request) {
  try { return await request.json(); }
  catch { throw new HttpError(400, "Please send valid JSON."); }
}
function validEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function cleanText(value, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function money(amount) {
  return Number.isInteger(amount) && amount >= 0;
}

async function createSession(userId, env) {
  const token = `${uid()}${uid().replaceAll("-", "")}`;
  const tokenHash = await sha256(token);
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  await env.DB.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
    .bind(tokenHash, userId, expires).run();
  return token;
}

async function paystackInitialize(env, email, amountPesewas, reference, callbackUrl) {
  if (!env.PAYSTACK_SECRET_KEY) throw new HttpError(503, "Online payments are not configured yet.");
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email, amount: amountPesewas, currency: "GHS", reference,
      callback_url: callbackUrl,
      channels: ["card", "mobile_money", "bank", "ussd"]
    })
  });
  const result = await response.json();
  if (!response.ok || !result.status || !result.data?.authorization_url) {
    throw new HttpError(502, result.message || "Could not start payment. Please try again.");
  }
  return result.data;
}

async function verifyPaystack(env, reference) {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` }
  });
  const result = await response.json();
  if (!response.ok || !result.status) throw new HttpError(502, "Payment verification failed.");
  return result.data;
}

async function handleApi(request, env, url) {
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, service: "SCANTY SOCIAL BOOST API", currency: "GHS" });
  }

  if (path === "/api/services" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id,name,category,description,price_ghs,delivery_note FROM services WHERE active=1 ORDER BY category,name"
    ).all();
    return json({ services: results || [] });
  }

  if (path === "/api/auth/register" && method === "POST") {
    const data = await bodyJson(request);
    const name = cleanText(data.name, 80);
    const email = cleanText(data.email, 160).toLowerCase();
    const password = typeof data.password === "string" ? data.password : "";
    if (name.length < 2 || !validEmail(email) || password.length < 10) {
      throw new HttpError(400, "Enter your name, a valid email and a password of at least 10 characters.");
    }
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (exists) throw new HttpError(409, "An account with this email already exists.");
    const salt = uid();
    const hash = await passwordHash(password, salt);
    const id = uid();
    await env.DB.prepare("INSERT INTO users(id,name,email,password_hash,password_salt) VALUES(?,?,?,?,?)")
      .bind(id, name, email, hash, salt).run();
    const token = await createSession(id, env);
    return json({ user: { id, name, email, role: "customer" } }, 201, { "Set-Cookie": setCookie(token) });
  }

  if (path === "/api/auth/login" && method === "POST") {
    const data = await bodyJson(request);
    const email = cleanText(data.email, 160).toLowerCase();
    const password = typeof data.password === "string" ? data.password : "";
    const user = await env.DB.prepare("SELECT * FROM users WHERE email=?").bind(email).first();
    if (!user || (await passwordHash(password, user.password_salt)) !== user.password_hash) {
      throw new HttpError(401, "Email or password is incorrect.");
    }
    const token = await createSession(user.id, env);
    return json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } }, 200, {
      "Set-Cookie": setCookie(token)
    });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = cookieValue(request, COOKIE);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
  }

  if (path === "/api/auth/me" && method === "GET") {
    return json({ user: await currentUser(request, env) });
  }

  if (path === "/api/orders" && method === "POST") {
    const user = await requireUser(request, env);
    const data = await bodyJson(request);
    const serviceId = cleanText(data.service_id, 80);
    const brief = cleanText(data.brief, 1500);
    const target = cleanText(data.target_url, 500);
    if (!serviceId || brief.length < 10) throw new HttpError(400, "Choose a service and describe what you need (at least 10 characters).");
    if (target && !/^https:\/\/\S+/i.test(target)) throw new HttpError(400, "Please use a complete https:// link.");
    const service = await env.DB.prepare(
      "SELECT id,name,price_ghs FROM services WHERE id=? AND active=1"
    ).bind(serviceId).first();
    if (!service) throw new HttpError(404, "That service is no longer available.");
    const orderId = uid();
    const reference = `SSB_${orderId.replaceAll("-", "").slice(0, 20)}`;
    await env.DB.prepare(`
      INSERT INTO orders(id,user_id,service_id,service_name,amount_ghs,brief,target_url,paystack_reference)
      VALUES(?,?,?,?,?,?,?,?)
    `).bind(orderId, user.id, service.id, service.name, service.price_ghs, brief, target, reference).run();
    try {
      const payment = await paystackInitialize(env, user.email, service.price_ghs * 100, reference, `${url.origin}/?payment=verify&reference=${encodeURIComponent(reference)}`);
      await env.DB.prepare("INSERT INTO payments(id,order_id,reference,amount_pesewas,status) VALUES(?,?,?,?,?)")
        .bind(uid(), orderId, reference, service.price_ghs * 100, "initialized").run();
      return json({ order_id: orderId, authorization_url: payment.authorization_url, reference });
    } catch (error) {
      await env.DB.prepare("UPDATE orders SET status='awaiting_payment' WHERE id=?").bind(orderId).run();
      throw error;
    }
  }

  if (path === "/api/orders" && method === "GET") {
    const user = await requireUser(request, env);
    const rows = await env.DB.prepare(`
      SELECT id,service_name,amount_ghs,brief,target_url,status,created_at
      FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100
    `).bind(user.id).all();
    return json({ orders: rows.results || [] });
  }

  if (path === "/api/payments/verify" && method === "POST") {
    await requireUser(request, env);
    const data = await bodyJson(request);
    const reference = cleanText(data.reference, 100);
    if (!reference) throw new HttpError(400, "Payment reference is required.");
    const payment = await verifyPaystack(env, reference);
    if (payment.status !== "success" || payment.currency !== "GHS") {
      throw new HttpError(400, "Payment has not been confirmed.");
    }
    const order = await env.DB.prepare("SELECT id,user_id,amount_ghs FROM orders WHERE paystack_reference=?")
      .bind(reference).first();
    if (!order || order.user_id !== (await currentUser(request, env)).id || Number(payment.amount) !== order.amount_ghs * 100) {
      throw new HttpError(400, "Payment details do not match this order.");
    }
    await env.DB.batch([
      env.DB.prepare("UPDATE orders SET status='paid',updated_at=datetime('now') WHERE id=?").bind(order.id),
      env.DB.prepare("UPDATE payments SET status='success',paid_at=datetime('now') WHERE reference=?").bind(reference)
    ]);
    return json({ ok: true, order_id: order.id });
  }

  if (path === "/api/payments/webhook" && method === "POST") {
    if (!env.PAYSTACK_SECRET_KEY) throw new HttpError(503, "Payments are not configured.");
    const raw = await request.text();
    const signature = request.headers.get("x-paystack-signature") || "";
    const key = await crypto.subtle.importKey("raw", encoder.encode(env.PAYSTACK_SECRET_KEY), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
    const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(raw));
    const expected = [...new Uint8Array(signed)].map(b => b.toString(16).padStart(2, "0")).join("");
    if (!signature || signature.length !== expected.length) {
      throw new HttpError(401, "Invalid webhook signature.");
    }
    let signatureDiff = 0;
    for (let i = 0; i < signature.length; i++) {
      signatureDiff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (signatureDiff !== 0) throw new HttpError(401, "Invalid webhook signature.");
    const event = JSON.parse(raw);
    if (event.event === "charge.success" && event.data?.reference && event.data?.currency === "GHS") {
      const reference = event.data.reference;
      const order = await env.DB.prepare("SELECT id,amount_ghs FROM orders WHERE paystack_reference=?").bind(reference).first();
      if (order && Number(event.data.amount) === order.amount_ghs * 100) {
        await env.DB.batch([
          env.DB.prepare("UPDATE orders SET status='paid',updated_at=datetime('now') WHERE id=?").bind(order.id),
          env.DB.prepare("UPDATE payments SET status='success',paid_at=datetime('now') WHERE reference=?").bind(reference)
        ]);
      }
    }
    return json({ received: true });
  }

  if (path === "/api/admin/setup" && method === "POST") {
    if (!env.ADMIN_SETUP_KEY || request.headers.get("x-setup-key") !== env.ADMIN_SETUP_KEY) {
      throw new HttpError(403, "Invalid setup key.");
    }
    const data = await bodyJson(request);
    const name = cleanText(data.name, 80);
    const email = cleanText(data.email, 160).toLowerCase();
    const password = typeof data.password === "string" ? data.password : "";
    if (!name || !validEmail(email) || password.length < 14) {
      throw new HttpError(400, "Provide a name, valid email and admin password of at least 14 characters.");
    }
    const adminExists = await env.DB.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").first();
if (adminExists) throw new HttpError(409, "Administrator setup has already been completed.");

const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
if (exists) throw new HttpError(409, "That email already has an account.");
    const salt = uid(), hash = await passwordHash(password, salt), id = uid();
    await env.DB.prepare("INSERT INTO users(id,name,email,password_hash,password_salt,role) VALUES(?,?,?,?,?,'admin')")
      .bind(id, name, email, hash, salt).run();
    return json({ ok: true, message: "Admin account created. Sign in using the normal login form." }, 201);
  }

  if (path === "/api/admin/overview" && method === "GET") {
    await requireAdmin(request, env);
    const [orders, users, services] = await Promise.all([
      env.DB.prepare("SELECT id,service_name,amount_ghs,brief,target_url,status,created_at FROM orders ORDER BY created_at DESC LIMIT 200").all(),
      env.DB.prepare("SELECT id,name,email,created_at FROM users WHERE role='customer' ORDER BY created_at DESC LIMIT 200").all(),
      env.DB.prepare("SELECT * FROM services ORDER BY created_at DESC").all()
    ]);
    const totals = await env.DB.prepare("SELECT COUNT(*) AS order_count, COALESCE(SUM(CASE WHEN status IN ('paid','in_progress','completed') THEN amount_ghs ELSE 0 END),0) AS revenue_ghs FROM orders").first();
    return json({ orders: orders.results || [], users: users.results || [], services: services.results || [], totals });
  }

  if (path === "/api/admin/orders/status" && method === "PATCH") {
    await requireAdmin(request, env);
    const data = await bodyJson(request);
    const allowed = ["paid","in_progress","completed","cancelled","refunded"];
    if (!allowed.includes(data.status) || typeof data.id !== "string") throw new HttpError(400, "Invalid order update.");
    const result = await env.DB.prepare("UPDATE orders SET status=?,updated_at=datetime('now') WHERE id=?")
      .bind(data.status, data.id).run();
    if (!result.meta.changes) throw new HttpError(404, "Order not found.");
    return json({ ok: true });
  }

  if (path === "/api/admin/services" && method === "POST") {
    await requireAdmin(request, env);
    const data = await bodyJson(request);
    const name = cleanText(data.name, 100), category = cleanText(data.category, 60);
    const description = cleanText(data.description, 500), delivery = cleanText(data.delivery_note, 300);
    const price = Number(data.price_ghs);
    if (!name || !category || !description || !money(price)) throw new HttpError(400, "Complete all service fields and enter a valid GHS price.");
    await env.DB.prepare("INSERT INTO services(id,name,category,description,price_ghs,delivery_note) VALUES(?,?,?,?,?,?)")
      .bind(uid(), name, category, description, price, delivery || "We'll contact you to confirm the project brief.").run();
    return json({ ok: true }, 201);
  }

  if (path === "/api/admin/services/toggle" && method === "PATCH") {
    await requireAdmin(request, env);
    const data = await bodyJson(request);
    if (typeof data.id !== "string" || ![0,1].includes(Number(data.active))) throw new HttpError(400, "Invalid service update.");
    await env.DB.prepare("UPDATE services SET active=? WHERE id=?").bind(Number(data.active), data.id).run();
    return json({ ok: true });
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    
} catch (error) {
  console.error("API error:", error?.stack || error?.message || error);

  const message = error instanceof HttpError
    ? error.message
    : url.pathname === "/api/admin/setup"
      ? (error?.message || "Unknown administrator setup error")
      : "Something went wrong. Please try again.";

  return json(
    { error: message },
    error instanceof HttpError ? error.status : 500
  );
}
  },
};
