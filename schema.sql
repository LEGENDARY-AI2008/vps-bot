CREATE TABLE IF NOT EXISTS users (
  id          BIGINT PRIMARY KEY,           -- Telegram user id
  username    TEXT,
  referrer_id BIGINT REFERENCES users(id),
  credits     INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  code          TEXT PRIMARY KEY,           -- e.g. '500mb'
  name          TEXT NOT NULL,
  credits       INTEGER NOT NULL,           -- credits per 10-day period
  instance_type TEXT NOT NULL               -- AWS instance type
);

INSERT INTO plans (code, name, credits, instance_type)
VALUES ('500mb', '500MB VPS', 10, 't3.micro')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS orders (
  id                 SERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL REFERENCES users(id),
  kind               TEXT NOT NULL CHECK (kind IN ('topup')),
  credits            INTEGER NOT NULL,      -- credits requested
  naira              INTEGER NOT NULL,      -- 1 credit = 100 naira
  status             TEXT NOT NULL DEFAULT 'awaiting_proof'
                     CHECK (status IN ('awaiting_proof','pending','approved','rejected')),
  screenshot_file_id TEXT UNIQUE,           -- stops the same screenshot being approved twice
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vps (
  id              SERIAL PRIMARY KEY,
  user_id         BIGINT NOT NULL REFERENCES users(id),
  plan_code       TEXT NOT NULL REFERENCES plans(code),
  aws_instance_id TEXT,
  ip              TEXT,
  username        TEXT,
  password        TEXT,                     -- consider encrypting before real launch
  status          TEXT NOT NULL DEFAULT 'creating'
                  CHECK (status IN ('creating','running','expiring','expired','deleted')),
  expires_at      TIMESTAMPTZ NOT NULL,
  reminded        BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id         SERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id),
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
