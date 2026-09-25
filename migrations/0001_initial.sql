PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_sessions (
  user_id INTEGER NOT NULL PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'idle',
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id INTEGER NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  listing_type TEXT NOT NULL CHECK (listing_type IN ('rent', 'sale', 'room')),
  property_type TEXT CHECK (property_type IN ('apartment', 'house', 'room')),
  title TEXT,
  description TEXT,
  city TEXT NOT NULL DEFAULT 'Düsseldorf',
  district TEXT,
  address TEXT,
  rooms REAL,
  area_sqm REAL,
  cold_rent REAL,
  warm_rent REAL,
  additional_costs REAL,
  deposit REAL,
  available_from TEXT,
  furnished INTEGER NOT NULL DEFAULT 0 CHECK (furnished IN (0, 1)),
  balcony INTEGER NOT NULL DEFAULT 0 CHECK (balcony IN (0, 1)),
  elevator INTEGER NOT NULL DEFAULT 0 CHECK (elevator IN (0, 1)),
  floor TEXT,
  sale_price REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft', 'pending', 'approved', 'published', 'rejected', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS listing_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL,
  telegram_file_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE,
  UNIQUE (listing_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_listings_user_id ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_telegram_updates_created_at ON telegram_updates(created_at);
CREATE INDEX IF NOT EXISTS idx_listing_images_listing_id ON listing_images(listing_id);
