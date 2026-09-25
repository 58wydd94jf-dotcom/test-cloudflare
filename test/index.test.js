import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import worker, { internals } from "../src/index.js";

const migrationSql = await readFile(
  new URL("../migrations/0001_initial_schema.sql", import.meta.url),
  "utf8"
);

class D1PreparedStatementMock {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  async first() {
    const row = this.db.prepare(this.sql).get(...this.params);
    return row ?? null;
  }

  async all() {
    const results = this.db.prepare(this.sql).all(...this.params);
    return { results };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);

    return {
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(
          result.lastInsertRowid ?? result.lastInsertRowid ?? 0
        ),
      },
    };
  }
}

class D1DatabaseMock {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec(migrationSql);
  }

  prepare(sql) {
    return new D1PreparedStatementMock(this.sqlite, sql);
  }
}

function createEnv(overrides = {}) {
  return {
    DB: new D1DatabaseMock(),
    APP_ENV: "development",
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "secret-token",
    TELEGRAM_UPDATE_RETENTION_DAYS: "30",
    TELEGRAM_UPDATE_CLEANUP_BATCH_SIZE: "500",
    ...overrides,
  };
}

function createTelegramFetch(log, options = {}) {
  const attempts = new Map();

  return async (url, requestOptions = {}) => {
    const method = url.split("/").pop();
    const body = JSON.parse(requestOptions.body ?? "{}");
    const count = (attempts.get(method) ?? 0) + 1;
    attempts.set(method, count);

    log.push({
      method,
      body,
      attempt: count,
    });

    if (options.throwFor?.includes(method)) {
      throw new Error(`${method} failed`);
    }

    if (options.httpStatusFor?.[method]) {
      return new Response(
        JSON.stringify({
          ok: false,
          description: "failure",
        }),
        {
          status: options.httpStatusFor[method],
          headers: {
            "content-type": "application/json",
          },
        }
      );
    }

    if (options.invalidJsonFor?.includes(method)) {
      return new Response("not-json", {
        status: 200,
        headers: {
          "content-type": "text/plain",
        },
      });
    }

    if (options.telegramErrorFor?.includes(method)) {
      return new Response(
        JSON.stringify({
          ok: false,
          description: "telegram error",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        result:
          method === "sendMessage"
            ? {
                message_id: log.length,
                text: body.text,
              }
            : true,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      }
    );
  };
}

async function withMockedFetch(mockFetch, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function createUser(env, telegramId = 1001) {
  return internals.getOrCreateUser(env, {
    id: telegramId,
    username: `user${telegramId}`,
    first_name: "علی",
    last_name: "رضایی",
  });
}

function buildListing(overrides = {}) {
  return {
    listing_type: "rent",
    property_type: "apartment",
    title: "آپارتمان روشن",
    description: "آگهی کامل به زبان فارسی",
    city: "Düsseldorf",
    district: "مرکز شهر",
    address: "خیابان اصلی ۱",
    rooms: 2.5,
    area_sqm: 68,
    cold_rent: 900,
    warm_rent: 1100,
    additional_costs: 200,
    deposit: 1800,
    available_from: "01.10.2026",
    furnished: 1,
    balcony: 1,
    elevator: 1,
    floor: "2",
    phone: "+49123456789",
    photos: ["photo-1", "photo-2"],
    ...overrides,
  };
}

test("migration schema matches the known production contract", async () => {
  const env = createEnv();
  const columns = await env.DB.prepare(
    "PRAGMA table_info(telegram_updates)"
  ).all();
  const columnNames = columns.results.map((row) => row.name);

  assert.deepEqual(columnNames, ["update_id", "processed_at"]);

  const sessionColumns = await env.DB.prepare(
    "PRAGMA table_info(user_sessions)"
  ).all();
  assert.equal(
    sessionColumns.results.find((row) => row.name === "data").notnull,
    0
  );

  const indexes = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name"
  ).all();
  const indexNames = indexes.results.map((row) => row.name);

  assert.ok(indexNames.includes("idx_listing_images_listing_id"));
  assert.ok(indexNames.includes("idx_listings_status"));
  assert.ok(indexNames.includes("idx_listings_user_id"));
  assert.ok(indexNames.includes("idx_users_telegram_id"));
});

test("static audit patterns are corrected repository-wide", async () => {
  const source = await readFile(
    new URL("../src/index.js", import.meta.url),
    "utf8"
  );
  const wrangler = await readFile(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(source, /telegram_updates\.created_at/);
  assert.doesNotMatch(source, /Math\.random/);
  assert.doesNotMatch(
    wrangler,
    /REPLACE_WITH_PRODUCTION_D1_DATABASE_ID/
  );
  assert.match(source, /processed_at/);
  assert.match(source, /X-Telegram-Bot-Api-Secret-Token/);
});

test("getOrCreateUser is race-safe for concurrent creation", async () => {
  const env = createEnv();
  const userPayload = {
    id: 2002,
    username: "concurrent",
    first_name: "سارا",
    last_name: "احمدی",
  };

  const users = await Promise.all(
    Array.from({ length: 8 }, () =>
      internals.getOrCreateUser(env, userPayload)
    )
  );

  assert.equal(new Set(users.map((row) => row.id)).size, 1);

  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM users WHERE telegram_id = ?"
  )
    .bind(2002)
    .first();

  assert.equal(count.count, 1);
});

test("session lifecycle supports create, update, and clear", async () => {
  const env = createEnv();
  const user = await createUser(env, 3003);

  await internals.setSession(env, user.id, "title", {
    listing: {
      title: "نمونه",
    },
  });

  let session = await internals.getSession(env, user.id);
  assert.equal(session.state, "title");

  await internals.setSession(env, user.id, "description", {
    listing: {
      title: "نمونه",
      description: "توضیح",
    },
  });

  session = await internals.getSession(env, user.id);
  assert.equal(session.state, "description");

  await internals.clearSession(env, user.id);
  session = await internals.getSession(env, user.id);
  assert.equal(session.state, "idle");
  assert.equal(session.data, null);
});

test("duplicate Telegram updates are ignored sequentially and concurrently", async () => {
  const env = createEnv();
  const log = [];
  const update = {
    update_id: 4004,
    message: {
      message_id: 1,
      chat: { id: 99 },
      from: { id: 99, first_name: "رضا" },
      text: "/help",
    },
  };

  await withMockedFetch(createTelegramFetch(log), async () => {
    await internals.handleUpdate(env, update);
    await internals.handleUpdate(env, update);
  });

  assert.equal(
    log.filter((entry) => entry.method === "sendMessage").length,
    1
  );

  const concurrentEnv = createEnv();
  const concurrentLog = [];

  await withMockedFetch(
    createTelegramFetch(concurrentLog),
    async () => {
      await Promise.all([
        internals.handleUpdate(concurrentEnv, update),
        internals.handleUpdate(concurrentEnv, update),
      ]);
    }
  );

  assert.equal(
    concurrentLog.filter(
      (entry) => entry.method === "sendMessage"
    ).length,
    1
  );
});

test("failed update processing releases the claim so retry can succeed", async () => {
  const env = createEnv();
  const update = {
    update_id: 5005,
    message: {
      message_id: 1,
      chat: { id: 101 },
      from: { id: 101, first_name: "لیلا" },
      text: "/help",
    },
  };

  await assert.rejects(
    withMockedFetch(
      createTelegramFetch([], {
        throwFor: ["sendMessage"],
      }),
      async () => internals.handleUpdate(env, update)
    )
  );

  const afterFailure = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM telegram_updates WHERE update_id = ?"
  )
    .bind(5005)
    .first();

  assert.equal(afterFailure.count, 0);

  const retryLog = [];

  await withMockedFetch(createTelegramFetch(retryLog), async () => {
    await internals.handleUpdate(env, update);
  });

  const afterRetry = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM telegram_updates WHERE update_id = ?"
  )
    .bind(5005)
    .first();

  assert.equal(afterRetry.count, 1);
  assert.equal(
    retryLog.filter((entry) => entry.method === "sendMessage").length,
    1
  );
});

test("listing validation accepts rental, sale, and room flows and rejects invalid data", () => {
  assert.deepEqual(internals.validateListing(buildListing()), []);
  assert.deepEqual(
    internals.validateListing(
      buildListing({
        listing_type: "sale",
        sale_price: 420000,
        cold_rent: null,
        warm_rent: null,
        additional_costs: null,
        deposit: null,
      })
    ),
    []
  );
  assert.deepEqual(
    internals.validateListing(
      buildListing({
        listing_type: "room",
        property_type: "room",
        title: "اتاق اشتراکی",
      })
    ),
    []
  );

  const errors = internals.validateListing(
    buildListing({
      title: "",
      area_sqm: 0,
    })
  );

  assert.ok(errors.length >= 2);
});

test("saveListing preserves image order, deduplicates photos, and enforces the maximum image count", async () => {
  const env = createEnv();
  const user = await createUser(env, 6006);

  const listingId = await internals.saveListing(
    env,
    user,
    buildListing({
      photos: [
        "photo-1",
        "photo-2",
        "photo-1",
        "photo-3",
        "photo-4",
        "photo-5",
        "photo-6",
      ],
    })
  );

  const images = await env.DB.prepare(
    "SELECT telegram_file_id, sort_order FROM listing_images WHERE listing_id = ? ORDER BY sort_order"
  )
    .bind(listingId)
    .all();

  assert.deepEqual(
    images.results.map((row) => row.telegram_file_id),
    ["photo-1", "photo-2", "photo-3", "photo-4", "photo-5"]
  );
  assert.deepEqual(
    images.results.map((row) => row.sort_order),
    [0, 1, 2, 3, 4]
  );
});

test("listing confirmation is duplicate-safe and rejects stale callback tokens", async () => {
  const env = createEnv();
  const user = await createUser(env, 7007);
  const log = [];
  const listing = buildListing({
    confirmation_token: "abc123token",
  });

  await internals.setSession(env, user.id, "confirmation", {
    listing,
  });

  const callback = {
    id: "cb-1",
    data: "listing:confirm:abc123token",
    from: { id: 7007, first_name: "مینا" },
    message: { chat: { id: 7007 } },
  };

  await withMockedFetch(createTelegramFetch(log), async () => {
    await Promise.all([
      internals.handleCallback(env, callback, user),
      internals.handleCallback(env, callback, user),
    ]);
  });

  const listings = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM listings WHERE user_id = ?"
  )
    .bind(user.id)
    .first();

  assert.equal(listings.count, 1);

  const staleLog = [];
  await withMockedFetch(createTelegramFetch(staleLog), async () => {
    await internals.handleCallback(
      env,
      {
        ...callback,
        id: "cb-2",
        data: "listing:confirm:stale-token",
      },
      user
    );
  });

  assert.ok(
    staleLog.some(
      (entry) =>
        entry.method === "answerCallbackQuery" &&
        entry.body.text === "این درخواست قبلاً پردازش شده یا دیگر معتبر نیست."
    ) ||
      staleLog.some(
        (entry) =>
          entry.method === "answerCallbackQuery" &&
          entry.body.text === "این دکمه دیگر معتبر نیست."
      )
  );
});

test("cleanup removes old telegram updates by processed_at using configured retention", async () => {
  const env = createEnv({
    TELEGRAM_UPDATE_RETENTION_DAYS: "10",
    TELEGRAM_UPDATE_CLEANUP_BATCH_SIZE: "10",
  });

  await env.DB.prepare(
    "INSERT INTO telegram_updates (update_id, processed_at) VALUES (?, ?)"
  )
    .bind(1, "2026-01-01 00:00:00")
    .run();
  await env.DB.prepare(
    "INSERT INTO telegram_updates (update_id, processed_at) VALUES (?, ?)"
  )
    .bind(2, "2999-01-01T00:00:00.000Z")
    .run();

  const deleted = await internals.cleanupProcessedUpdates(env);
  assert.equal(deleted, 1);

  const remaining = await env.DB.prepare(
    "SELECT update_id FROM telegram_updates ORDER BY update_id"
  ).all();

  assert.deepEqual(
    remaining.results.map((row) => row.update_id),
    [2]
  );
});

test("webhook secret validation distinguishes development and production requirements", () => {
  const request = new Request("https://example.com/telegram/webhook", {
    method: "POST",
    headers: {
      "X-Telegram-Bot-Api-Secret-Token": "secret-token",
    },
  });

  assert.deepEqual(
    internals.checkWebhookSecret(request, createEnv()),
    { ok: true }
  );

  assert.deepEqual(
    internals.checkWebhookSecret(
      request,
      createEnv({
        APP_ENV: "production",
        TELEGRAM_WEBHOOK_SECRET: "",
      })
    ),
    {
      ok: false,
      status: 500,
      message: "Production webhook secret is not configured.",
    }
  );

  assert.deepEqual(
    internals.checkWebhookSecret(
      new Request("https://example.com/telegram/webhook", {
        method: "POST",
        headers: {
          "X-Telegram-Bot-Api-Secret-Token": "wrong",
        },
      }),
      createEnv()
    ),
    {
      ok: false,
      status: 401,
      message: "Unauthorized.",
    }
  );
});

test("telegram API failures surface safely for malformed, HTTP, and Telegram-level errors", async () => {
  const env = createEnv();

  await assert.rejects(
    withMockedFetch(
      createTelegramFetch([], {
        invalidJsonFor: ["sendMessage"],
      }),
      async () =>
        internals.sendMessage(env, 1, "سلام")
    ),
    /malformed JSON/
  );

  await assert.rejects(
    withMockedFetch(
      createTelegramFetch([], {
        httpStatusFor: { sendMessage: 429 },
      }),
      async () =>
        internals.sendMessage(env, 1, "سلام")
    ),
    /HTTP 429/
  );

  await assert.rejects(
    withMockedFetch(
      createTelegramFetch([], {
        telegramErrorFor: ["sendMessage"],
      }),
      async () =>
        internals.sendMessage(env, 1, "سلام")
    ),
    /rejected the request/
  );
});

test("complete Persian rental journey stores the listing and emits Persian prompts", async () => {
  const env = createEnv();
  const log = [];

  const sendUpdate = async (update) => {
    await withMockedFetch(createTelegramFetch(log), async () => {
      await internals.handleUpdate(env, update);
    });
  };

  let updateId = 9000;
  const nextUpdateId = () => ++updateId;
  const baseFrom = {
    id: 9090,
    first_name: "حسین",
    username: "hossein",
  };
  const chat = { id: 9090 };

  await sendUpdate({
    update_id: nextUpdateId(),
    message: {
      message_id: 1,
      chat,
      from: baseFrom,
      text: "/start",
    },
  });

  await sendUpdate({
    update_id: nextUpdateId(),
    callback_query: {
      id: "c1",
      from: baseFrom,
      data: "submit",
      message: { chat },
    },
  });

  await sendUpdate({
    update_id: nextUpdateId(),
    callback_query: {
      id: "c2",
      from: baseFrom,
      data: "type:rent",
      message: { chat },
    },
  });

  await sendUpdate({
    update_id: nextUpdateId(),
    callback_query: {
      id: "c3",
      from: baseFrom,
      data: "property:apartment",
      message: { chat },
    },
  });

  for (const text of [
    "آپارتمان دوخوابه",
    "توضیح کامل و شفاف",
    "Düsseldorf",
    "مرکز",
    "خیابان نمونه ۱۲",
    "2.5",
    "70",
    "900",
    "1100",
    "200",
    "1800",
    "01.10.2026",
    "3",
    "+49111111111",
  ]) {
    await sendUpdate({
      update_id: nextUpdateId(),
      message: {
        message_id: nextUpdateId(),
        chat,
        from: baseFrom,
        text,
      },
    });
  }

  for (const [id, data] of [
    ["c4", "feature:furnished:1"],
    ["c5", "feature:balcony:1"],
    ["c6", "feature:elevator:0"],
  ]) {
    await sendUpdate({
      update_id: nextUpdateId(),
      callback_query: {
        id,
        from: baseFrom,
        data,
        message: { chat },
      },
    });
  }

  await sendUpdate({
    update_id: nextUpdateId(),
    message: {
      message_id: nextUpdateId(),
      chat,
      from: baseFrom,
      photo: [{ file_id: "photo-final" }],
    },
  });

  await sendUpdate({
    update_id: nextUpdateId(),
    message: {
      message_id: nextUpdateId(),
      chat,
      from: baseFrom,
      text: "پایان عکس‌ها",
    },
  });

  const confirmationMessage = log
    .filter((entry) => entry.method === "sendMessage")
    .at(-1);

  assert.match(
    confirmationMessage.body.text,
    /خلاصه آگهی/
  );

  const confirmButton =
    confirmationMessage.body.reply_markup.inline_keyboard[0][0]
      .callback_data;

  await sendUpdate({
    update_id: nextUpdateId(),
    callback_query: {
      id: "c7",
      from: baseFrom,
      data: confirmButton,
      message: { chat },
    },
  });

  const listing = await env.DB.prepare(
    "SELECT listing_type, property_type, city, status FROM listings WHERE user_id = 1"
  ).first();

  assert.deepEqual({ ...listing }, {
    listing_type: "rent",
    property_type: "apartment",
    city: "Düsseldorf",
    status: "pending",
  });

  const outgoingTexts = log
    .filter((entry) => entry.method === "sendMessage")
    .map((entry) => entry.body.text);

  assert.ok(
    outgoingTexts.some((text) =>
      text.includes("نوع آگهی را انتخاب کن")
    )
  );
  assert.ok(
    outgoingTexts.some((text) =>
      text.includes("نوع ملک را انتخاب کن")
    )
  );
  assert.ok(
    outgoingTexts.some((text) =>
      text.includes("آگهی شما با شماره")
    )
  );
  assert.ok(
    outgoingTexts.every(
      (text) =>
        !text.includes("Method not allowed") &&
        !text.includes("Not found") &&
        !text.includes("Unauthorized")
    )
  );
});

test("worker fetch enforces webhook security and malformed request handling", async () => {
  const env = createEnv();

  const unauthorized = await worker.fetch(
    new Request("https://example.com/telegram/webhook", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": "wrong",
      },
      body: "{}",
    }),
    env
  );

  assert.equal(unauthorized.status, 401);

  const badJson = await worker.fetch(
    new Request("https://example.com/telegram/webhook", {
      method: "POST",
      headers: {
        "X-Telegram-Bot-Api-Secret-Token": "secret-token",
      },
      body: "{",
    }),
    env
  );

  assert.equal(badJson.status, 400);
});
