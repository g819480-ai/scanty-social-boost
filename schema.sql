PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  price_ghs INTEGER NOT NULL CHECK(price_ghs >= 0),
  delivery_note TEXT NOT NULL DEFAULT 'We will contact you to confirm the project brief.',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  service_name TEXT NOT NULL,
  amount_ghs INTEGER NOT NULL,
  brief TEXT NOT NULL,
  target_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'awaiting_payment'
    CHECK(status IN ('awaiting_payment','paid','in_progress','completed','cancelled','refunded')),
  paystack_reference TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL DEFAULT 'paystack',
  reference TEXT NOT NULL UNIQUE,
  amount_pesewas INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'initialized',
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

INSERT OR IGNORE INTO services (id,name,category,description,price_ghs,delivery_note) VALUES
('profile-audit','Social Profile Audit','Strategy','A practical review of your profile, positioning, bio, content and improvement opportunities.',150,'A written audit is delivered after we receive your social profile links.'),
('content-plan','30-Day Content Plan','Content','A tailored monthly content calendar with post ideas, hooks and calls to action.',250,'We will contact you to collect your niche, goals and preferred platforms.'),
('creative-pack','Social Creative Pack','Creative','A starter pack of branded social post designs for your campaign.',350,'Design direction and brand assets will be confirmed before work begins.'),
('campaign-setup','Paid Ads Campaign Setup','Advertising','Campaign planning and setup support for eligible Meta or TikTok advertising campaigns. Ad spend is separate.',500,'You retain ownership of your ad account and approve all campaign spend.'),
('monthly-management','Social Media Management','Management','Monthly content scheduling and account management support with an agreed scope.',1200,'A team member will contact you to agree deliverables and the monthly schedule.');
