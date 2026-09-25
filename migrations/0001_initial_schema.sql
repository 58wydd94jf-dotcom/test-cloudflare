CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'idle',
  data TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE telegram_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  listing_type TEXT NOT NULL,
  property_type TEXT,
  title TEXT,
  description TEXT,
  city TEXT DEFAULT 'Düsseldorf',
  district TEXT,
  address TEXT,
  rooms REAL,
  area_sqm REAL,
  cold_rent REAL,
  warm_rent REAL,
  additional_costs REAL,
  deposit REAL,
  available_from TEXT,
  furnished INTEGER NOT NULL DEFAULT 0,
  balcony INTEGER NOT NULL DEFAULT 0,
  elevator INTEGER NOT NULL DEFAULT 0,
  floor TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sale_price REAL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE listing_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  telegram_file_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  UNIQUE (listing_id, sort_order)
);

CREATE INDEX idx_listing_images_listing_id
ON listing_images(listing_id);

CREATE INDEX idx_listings_status
ON listings(status);

CREATE INDEX idx_listings_user_id
ON listings(user_id);

CREATE INDEX idx_users_telegram_id
ON users(telegram_id);
