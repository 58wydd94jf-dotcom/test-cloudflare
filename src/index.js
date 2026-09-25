const COMMANDS = [
  { command: "start", description: "شروع کار با ربات" },
  { command: "submit", description: "ارسال آگهی مسکن" },
  { command: "help", description: "راهنمای استفاده" },
  { command: "status", description: "پیگیری وضعیت آگهی" },
  { command: "profile", description: "پروفایل کاربر" },
  { command: "cancel", description: "لغو عملیات" },
];

const TYPE_NAMES = {
  rent: "اجاره",
  sale: "فروش",
  room: "اتاق",
};

const PROPERTY_NAMES = {
  apartment: "آپارتمان",
  house: "خانه",
  room: "اتاق",
};

const STATUS_NAMES = {
  draft: "پیش‌نویس",
  pending: "در انتظار بررسی",
  approved: "تأیید شده",
  published: "منتشر شده",
  rejected: "رد شده",
  archived: "بایگانی شده",
};

const MAX_PHOTOS = 5;
const TELEGRAM_RETRY_ATTEMPTS = 3;
const RETRYABLE_HTTP_STATUSES = new Set([
  408, 409, 425, 429, 500, 502, 503, 504,
]);
const REQUIRED_TABLE_COLUMNS = {
  users: [
    "id",
    "telegram_id",
    "username",
    "first_name",
    "last_name",
    "phone",
  ],
  user_sessions: [
    "user_id",
    "state",
    "data",
    "updated_at",
  ],
  telegram_updates: ["update_id"],
  listings: [
    "id",
    "user_id",
    "listing_type",
    "property_type",
    "title",
    "description",
    "city",
    "district",
    "address",
    "rooms",
    "area_sqm",
    "cold_rent",
    "warm_rent",
    "additional_costs",
    "deposit",
    "available_from",
    "furnished",
    "balcony",
    "elevator",
    "floor",
    "sale_price",
    "status",
    "created_at",
  ],
  listing_images: [
    "id",
    "listing_id",
    "telegram_file_id",
    "sort_order",
  ],
};

function textResponse(text, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function telegram(env, method, body) {
  const token =
    env.TELEGRAM_BOT_TOKEN ??
    env.TELEGRAM_BOT_TOK;

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  const url =
    `https://api.telegram.org/bot${token}/${method}`;

  const requestOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };

  for (
    let attempt = 1;
    attempt <= TELEGRAM_RETRY_ATTEMPTS;
    attempt++
  ) {
    try {
      const response = await fetch(
        url,
        requestOptions
      );

      const payload = await response.text();
      const data = safeJsonParse(payload, null);
      const isOk =
        response.ok &&
        data &&
        data.ok === true;

      if (!isOk) {
        const retryAfter = Number(
          data?.parameters?.retry_after
        );
        const isRetryable =
          RETRYABLE_HTTP_STATUSES.has(
            response.status
          ) ||
          Number.isFinite(retryAfter);
        const error = new Error(
          `Telegram ${method} failed with status ${response.status}`
        );
        error.retryable = isRetryable;
        error.retryAfterMs =
          Number.isFinite(retryAfter)
            ? Math.max(0, retryAfter * 1000)
            : null;
        error.status = response.status;
        throw error;
      }

      return data.result;
    } catch (error) {
      console.error(
        JSON.stringify({
          telegramMethod: method,
          attempt,
          retryable: Boolean(error?.retryable),
          status: error?.status ?? null,
          errorName: error?.name,
          errorMessage: error?.message,
          errorStack: error?.stack,
        })
      );

      const shouldRetry =
        Boolean(error?.retryable) ||
        error?.name === "TypeError";

      if (
        attempt <
          TELEGRAM_RETRY_ATTEMPTS &&
        shouldRetry
      ) {
        const waitMs =
          Number.isFinite(error?.retryAfterMs)
            ? error.retryAfterMs
            : attempt * 500;
        await sleep(waitMs);
        continue;
      }

      throw error;
    }
  }
}

async function sendMessage(env, chatId, text, replyMarkup) {
  const body = {
    chat_id: chatId,
    text,
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  return telegram(env, "sendMessage", body);
}

async function answerCallbackQuery(
  env,
  callbackQueryId,
  text
) {
  return telegram(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

function keyboard(rows) {
  return {
    inline_keyboard: rows,
  };
}

function replyKeyboard(rows, oneTime = true) {
  return {
    keyboard: rows,
    resize_keyboard: true,
    one_time_keyboard: oneTime,
  };
}

function removeKeyboard() {
  return {
    remove_keyboard: true,
  };
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseGermanNumber(value) {
  let s = normalizeText(value).replace(/[€\s]/g, "");

  if (!s) {
    return null;
  }

  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "");
  }

  const number = Number(s);

  return Number.isFinite(number) ? number : null;
}

function formatEuro(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return `${Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} €`;
}

function formatNumber(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  return Number(value).toLocaleString("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  return String(value);
}

function sleep(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function safeJsonParse(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function getAppEnv(env) {
  return String(env.APP_ENV ?? "")
    .trim()
    .toLowerCase();
}

function validateEnvironment(env) {
  const token =
    env.TELEGRAM_BOT_TOKEN ??
    env.TELEGRAM_BOT_TOK;

  if (!token) {
    throw new Error(
      "Missing TELEGRAM_BOT_TOKEN secret."
    );
  }

  if (
    getAppEnv(env) === "production" &&
    !env.TELEGRAM_WEBHOOK_SECRET
  ) {
    throw new Error(
      "Missing TELEGRAM_WEBHOOK_SECRET in production."
    );
  }
}

async function getTableColumns(env, tableName) {
  const result = await env.DB.prepare(
    `PRAGMA table_info(${tableName})`
  ).all();
  const columns = new Set();

  for (const row of result.results || []) {
    if (row?.name) {
      columns.add(row.name);
    }
  }

  return columns.size ? columns : null;
}

async function validateSchema(env) {
  const problems = [];

  for (const [tableName, requiredColumns] of Object.entries(
    REQUIRED_TABLE_COLUMNS
  )) {
    const columns = await getTableColumns(
      env,
      tableName
    );

    if (!columns) {
      problems.push(
        `Missing table: ${tableName}`
      );
      continue;
    }

    for (const column of requiredColumns) {
      if (!columns.has(column)) {
        problems.push(
          `Missing column: ${tableName}.${column}`
        );
      }
    }
  }

  if (problems.length) {
    throw new Error(
      `D1 schema mismatch. ${problems.join(
        "; "
      )}`
    );
  }
}

async function ensureRuntimeReady(env) {
  validateEnvironment(env);
  await validateSchema(env);
}

function boolLabel(value) {
  return Number(value) ? "بله" : "خیر";
}

function commandName(text) {
  const match = normalizeText(text).match(
    /^\/([a-zA-Z0-9_]+)(?:@\w+)?(?:\s|$)/
  );

  return match ? match[1].toLowerCase() : null;
}

async function getOrCreateUser(env, from) {
  const telegramId = from.id;

  const existing = await env.DB.prepare(
    `SELECT
       id,
       telegram_id,
       username,
       first_name,
       last_name,
       phone
     FROM users
     WHERE telegram_id = ?`
  )
    .bind(telegramId)
    .first();

  if (existing) {
    await env.DB.prepare(
      `UPDATE users
       SET username = ?,
           first_name = ?,
           last_name = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE telegram_id = ?`
    )
      .bind(
        from.username ?? null,
        from.first_name ?? null,
        from.last_name ?? null,
        telegramId
      )
      .run();

    return {
      ...existing,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
    };
  }

  const result = await env.DB.prepare(
    `INSERT INTO users
     (telegram_id, username, first_name, last_name)
     VALUES (?, ?, ?, ?)`
  )
    .bind(
      telegramId,
      from.username ?? null,
      from.first_name ?? null,
      from.last_name ?? null
    )
    .run();

  return env.DB.prepare(
    `SELECT
       id,
       telegram_id,
       username,
       first_name,
       last_name,
       phone
     FROM users
     WHERE id = ?`
  )
    .bind(result.meta.last_row_id)
    .first();
}

async function getSession(env, userId) {
  return env.DB.prepare(
    `SELECT
       user_id,
       state,
       data,
       updated_at
     FROM user_sessions
     WHERE user_id = ?`
  )
    .bind(userId)
    .first();
}

async function setSession(
  env,
  userId,
  state,
  data = {}
) {
  await env.DB.prepare(
    `INSERT INTO user_sessions
     (user_id, state, data, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       state = excluded.state,
       data = excluded.data,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(
      userId,
      state,
      JSON.stringify(data)
    )
    .run();
}

async function clearSession(env, userId) {
  await env.DB.prepare(
    `INSERT INTO user_sessions
     (user_id, state, data, updated_at)
     VALUES (?, 'idle', '{}', CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       state = 'idle',
       data = '{}',
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(userId)
    .run();
}

async function claimUpdateId(env, updateId) {
  const result = await env.DB.prepare(
    "INSERT OR IGNORE INTO telegram_updates (update_id) VALUES (?)"
  )
    .bind(updateId)
    .run();

  return Number(result?.meta?.changes ?? 0) > 0;
}

async function releaseUpdateId(env, updateId) {
  await env.DB.prepare(
    "DELETE FROM telegram_updates WHERE update_id = ?"
  )
    .bind(updateId)
    .run();
}

async function setCommands(env) {
  try {
    await telegram(env, "setMyCommands", {
      commands: COMMANDS,
    });
  } catch {
    // عدم موفقیت در تنظیم منو نباید عملکرد اصلی ربات را متوقف کند.
  }
}

async function showStart(env, chatId, user) {
  const name = user.first_name || "دوست عزیز";

  await sendMessage(
    env,
    chatId,
    `سلام ${name}.

به ربات رسمی دوسلدورف خانه خوش آمدی.

از این ربات می‌توانی آگهی مسکن در دوسلدورف را ثبت و وضعیت آگهی‌های خود را پیگیری کنی.`,
    keyboard([
      [
        {
          text: "ثبت آگهی",
          callback_data: "submit",
        },
      ],
      [
        {
          text: "آگهی‌های من",
          callback_data: "status",
        },
        {
          text: "پروفایل من",
          callback_data: "profile",
        },
      ],
      [
        {
          text: "راهنما",
          callback_data: "help",
        },
      ],
    ])
  );
}

async function showHelp(env, chatId) {
  await sendMessage(
    env,
    chatId,
    `راهنمای استفاده

ثبت آگهی: /submit
پیگیری آگهی‌ها: /status
پروفایل: /profile
راهنما: /help
لغو عملیات جاری: /cancel
شروع دوباره: /start`
  );
}

async function showProfile(env, chatId, user) {
  const count = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM listings
     WHERE user_id = ?`
  )
    .bind(user.id)
    .first();

  const active = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM listings
     WHERE user_id = ?
     AND status IN ('pending','approved','published')`
  )
    .bind(user.id)
    .first();

  const username = user.username
    ? `@${user.username}`
    : "ثبت نشده";

  const phone = user.phone || "ثبت نشده";

  await sendMessage(
    env,
    chatId,
    `پروفایل شما

نام: ${user.first_name || "—"}
نام خانوادگی: ${user.last_name || "—"}
نام کاربری: ${username}
شماره تلفن: ${phone}

تعداد کل آگهی‌ها: ${count?.count ?? 0}
آگهی‌های فعال/درحال بررسی: ${active?.count ?? 0}`
  );
}

async function showStatus(env, chatId, user) {
  const rows = await env.DB.prepare(
    `SELECT
       id,
       listing_type,
       property_type,
       title,
       area_sqm,
       cold_rent,
       warm_rent,
       sale_price,
       status,
       created_at
     FROM listings
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT 20`
  )
    .bind(user.id)
    .all();

  if (!rows.results?.length) {
    await sendMessage(
      env,
      chatId,
      "هنوز آگهی‌ای برای شما ثبت نشده است.",
      keyboard([
        [
          {
            text: "ثبت آگهی",
            callback_data: "submit",
          },
        ],
      ])
    );

    return;
  }

  const lines = [
    "آگهی‌های شما:\n",
  ];

  for (const row of rows.results) {
    const price =
      row.listing_type === "sale"
        ? formatEuro(row.sale_price)
        : formatEuro(
            row.warm_rent ?? row.cold_rent
          );

    lines.push(
      `#${row.id} — ${
        TYPE_NAMES[row.listing_type] ||
        row.listing_type
      }\n` +
        `${row.title ||
          PROPERTY_NAMES[row.property_type] ||
          "آگهی مسکن"}\n` +
        `متراژ: ${formatNumber(
          row.area_sqm
        )} مترمربع\n` +
        `قیمت: ${price}\n` +
        `وضعیت: ${
          STATUS_NAMES[row.status] ||
          row.status
        }\n`
    );
  }

  await sendMessage(
    env,
    chatId,
    lines.join("\n")
  );
}

async function startSubmit(env, chatId, userId) {
  await setSession(
    env,
    userId,
    "listing_type",
    {
      listing: {},
    }
  );

  await sendMessage(
    env,
    chatId,
    "نوع آگهی را انتخاب کن:",
    keyboard([
      [
        {
          text: "اجاره",
          callback_data: "type:rent",
        },
      ],
      [
        {
          text: "فروش",
          callback_data: "type:sale",
        },
      ],
      [
        {
          text: "اتاق",
          callback_data: "type:room",
        },
      ],
      [
        {
          text: "لغو",
          callback_data: "cancel",
        },
      ],
    ])
  );
}

async function saveListing(env, user, listing) {
  const result = await env.DB.prepare(
    `INSERT INTO listings (
      user_id,
      listing_type,
      property_type,
      title,
      description,
      city,
      district,
      address,
      rooms,
      area_sqm,
      cold_rent,
      warm_rent,
      additional_costs,
      deposit,
      available_from,
      furnished,
      balcony,
      elevator,
      floor,
      sale_price,
      status
    )
    VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      'pending'
    )`
  )
    .bind(
      user.id,
      listing.listing_type,
      listing.property_type ?? null,
      listing.title ?? null,
      listing.description ?? null,
      "Düsseldorf",
      listing.district ?? null,
      listing.address ?? null,
      listing.rooms ?? null,
      listing.area_sqm ?? null,
      listing.cold_rent ?? null,
      listing.warm_rent ?? null,
      listing.additional_costs ?? null,
      listing.deposit ?? null,
      listing.available_from ?? null,
      listing.furnished ? 1 : 0,
      listing.balcony ? 1 : 0,
      listing.elevator ? 1 : 0,
      listing.floor ?? null,
      listing.sale_price ?? null
    )
    .run();

  const listingId = result.meta.last_row_id;

  for (
    let i = 0;
    i < (listing.photos || []).length;
    i++
  ) {
    await env.DB.prepare(
      `INSERT INTO listing_images
       (listing_id, telegram_file_id, sort_order)
       VALUES (?, ?, ?)`
    )
      .bind(
        listingId,
        listing.photos[i],
        i
      )
      .run();
  }

  return listingId;
}

function listingSummary(listing) {
  const price =
    listing.listing_type === "sale"
      ? `قیمت فروش: ${formatEuro(
          listing.sale_price
        )}`
      : [
          `اجاره سرد: ${formatEuro(
            listing.cold_rent
          )}`,
          `اجاره گرم: ${formatEuro(
            listing.warm_rent
          )}`,
          `هزینه‌های جانبی: ${formatEuro(
            listing.additional_costs
          )}`,
          `ودیعه: ${formatEuro(
            listing.deposit
          )}`,
        ].join("\n");

  return `خلاصه آگهی

نوع: ${
    TYPE_NAMES[listing.listing_type] || "—"
  }
نوع ملک: ${
    PROPERTY_NAMES[listing.property_type] || "—"
  }
عنوان: ${listing.title || "—"}
توضیحات: ${listing.description || "—"}
شهر: Düsseldorf
منطقه: ${listing.district || "—"}
آدرس: ${listing.address || "—"}
اتاق: ${formatNumber(listing.rooms)}
متراژ: ${formatNumber(
    listing.area_sqm
  )} مترمربع
${price}
تاریخ شروع: ${formatDate(
    listing.available_from
  )}
مبله: ${boolLabel(listing.furnished)}
بالکن: ${boolLabel(listing.balcony)}
آسانسور: ${boolLabel(listing.elevator)}
طبقه: ${listing.floor || "—"}
شماره تلفن: ${listing.phone || "—"}
تعداد عکس: ${
    (listing.photos || []).length
  }

اگر اطلاعات درست است، «تأیید و ثبت» را بزن.`;
}

async function nextQuestion(
  env,
  chatId,
  userId,
  state,
  listing
) {
  const questions = {
    title: "یک عنوان کوتاه برای آگهی بنویس.",
    description:
      "توضیحات کامل آگهی را بنویس.",
    district:
      "نام منطقه یا محله در دوسلدورف را بنویس.",
    address:
      "آدرس یا محدوده آگهی را بنویس.",
    rooms:
      "تعداد اتاق را وارد کن؛ مثلاً 2 یا 2,5",
    area_sqm:
      "متراژ را به مترمربع وارد کن؛ مثلاً 55",
    cold_rent:
      "اجاره سرد را به یورو وارد کن.",
    warm_rent:
      "اجاره گرم را به یورو وارد کن.",
    additional_costs:
      "هزینه‌های جانبی را به یورو وارد کن. اگر نداری، 0 بنویس.",
    deposit:
      "ودیعه را به یورو وارد کن. اگر ندارد، 0 بنویس.",
    sale_price:
      "قیمت فروش را به یورو وارد کن.",
    available_from:
      "تاریخ شروع را وارد کن؛ مثلاً 01.10.2026",
    floor:
      "طبقه را وارد کن؛ مثلاً EG، 1 یا 2.",
    phone:
      "شماره تلفن تماس را وارد کن یا از دکمه ارسال شماره استفاده کن.",
  };

  if (state === "photos") {
    await sendMessage(
      env,
      chatId,
      `تا ${MAX_PHOTOS} عکس می‌توانی بفرستی.
عکس‌ها را یکی‌یکی یا چندتا بفرست.
وقتی تمام شد، «پایان عکس‌ها» را بزن.`,
      replyKeyboard([
        [
          {
            text: "پایان عکس‌ها",
          },
        ],
        [
          {
            text: "لغو",
          },
        ],
      ])
    );

    return;
  }

  if (state === "features") {
    await sendMessage(
      env,
      chatId,
      "آیا ملک مبله است؟",
      keyboard([
        [
          {
            text: "بله",
            callback_data:
              "feature:furnished:1",
          },
          {
            text: "خیر",
            callback_data:
              "feature:furnished:0",
          },
        ],
      ])
    );

    return;
  }

  if (state === "balcony") {
    await sendMessage(
      env,
      chatId,
      "آیا بالکن دارد؟",
      keyboard([
        [
          {
            text: "بله",
            callback_data:
              "feature:balcony:1",
          },
          {
            text: "خیر",
            callback_data:
              "feature:balcony:0",
          },
        ],
      ])
    );

    return;
  }

  if (state === "elevator") {
    await sendMessage(
      env,
      chatId,
      "آیا آسانسور دارد؟",
      keyboard([
        [
          {
            text: "بله",
            callback_data:
              "feature:elevator:1",
          },
          {
            text: "خیر",
            callback_data:
              "feature:elevator:0",
          },
        ],
      ])
    );

    return;
  }

  if (state === "confirmation") {
    await sendMessage(
      env,
      chatId,
      listingSummary(listing),
      keyboard([
        [
          {
            text: "تأیید و ثبت",
            callback_data:
              "listing:confirm",
          },
        ],
        [
          {
            text: "لغو",
            callback_data: "cancel",
          },
        ],
      ])
    );

    return;
  }

  if (state === "property_type") {
    await sendMessage(
      env,
      chatId,
      "نوع ملک را انتخاب کن:",
      keyboard([
        [
          {
            text: "آپارتمان",
            callback_data:
              "property:apartment",
          },
        ],
        [
          {
            text: "خانه",
            callback_data:
              "property:house",
          },
        ],
        [
          {
            text: "اتاق",
            callback_data:
              "property:room",
          },
        ],
      ])
    );

    return;
  }

  if (questions[state]) {
    let markup;

    if (state === "phone") {
      markup = replyKeyboard([
        [
          {
            text: "ارسال شماره تلفن",
            request_contact: true,
          },
        ],
        [
          {
            text: "لغو",
          },
        ],
      ]);
    } else {
      markup = replyKeyboard([
        [
          {
            text: "لغو",
          },
        ],
      ]);
    }

    await sendMessage(
      env,
      chatId,
      questions[state],
      markup
    );
  }
}

async function processListingText(
  env,
  chatId,
  user,
  session,
  text,
  contact
) {
  const data = safeJsonParse(
    session.data,
    {}
  );

  const listing = data.listing || {};
  const state = session.state;

  if (
    text === "لغو" ||
    text === "/cancel"
  ) {
    await clearSession(env, user.id);

    await sendMessage(
      env,
      chatId,
      "عملیات لغو شد.",
      removeKeyboard()
    );

    return;
  }

  if (state === "title") {
    listing.title = text;
  } else if (state === "description") {
    listing.description = text;
  } else if (state === "district") {
    listing.district = text;
  } else if (state === "address") {
    listing.address = text;
  } else if (state === "rooms") {
    const value = parseGermanNumber(text);

    if (value === null || value < 0) {
      await sendMessage(
        env,
        chatId,
        "عدد معتبر وارد کن."
      );
      return;
    }

    listing.rooms = value;
  } else if (state === "area_sqm") {
    const value = parseGermanNumber(text);

    if (value === null || value <= 0) {
      await sendMessage(
        env,
        chatId,
        "متراژ معتبر وارد کن."
      );
      return;
    }

    listing.area_sqm = value;
  } else if (
    state === "cold_rent" ||
    state === "warm_rent" ||
    state === "additional_costs" ||
    state === "deposit" ||
    state === "sale_price"
  ) {
    const value = parseGermanNumber(text);

    if (value === null || value < 0) {
      await sendMessage(
        env,
        chatId,
        "مبلغ معتبر وارد کن."
      );
      return;
    }

    listing[state] = value;
  } else if (
    state === "available_from"
  ) {
    listing.available_from = text;
  } else if (state === "floor") {
    listing.floor = text;
  } else if (state === "phone") {
    listing.phone =
      contact?.phone_number || text;

    await env.DB.prepare(
      `UPDATE users
       SET phone = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(
        listing.phone,
        user.id
      )
      .run();
  } else {
    return;
  }

  const next = nextState(
    state,
    listing
  );

  await setSession(
    env,
    user.id,
    next,
    {
      listing,
    }
  );

  await nextQuestion(
    env,
    chatId,
    user.id,
    next,
    listing
  );
}

function nextState(state, listing) {
  if (state === "listing_type") {
    return "property_type";
  }

  if (state === "property_type") {
    return "title";
  }

  if (state === "title") {
    return "description";
  }

  if (state === "description") {
    return "district";
  }

  if (state === "district") {
    return "address";
  }

  if (state === "address") {
    return "rooms";
  }

  if (state === "rooms") {
    return "area_sqm";
  }

  if (state === "area_sqm") {
    return listing.listing_type === "sale"
      ? "sale_price"
      : "cold_rent";
  }

  if (state === "cold_rent") {
    return "warm_rent";
  }

  if (state === "warm_rent") {
    return "additional_costs";
  }

  if (state === "additional_costs") {
    return "deposit";
  }

  if (
    state === "deposit" ||
    state === "sale_price"
  ) {
    return "available_from";
  }

  if (state === "available_from") {
    return "floor";
  }

  if (state === "floor") {
    return "phone";
  }

  if (state === "phone") {
    return "features";
  }

  if (state === "features") {
    return "balcony";
  }

  if (state === "balcony") {
    return "elevator";
  }

  if (state === "elevator") {
    return "photos";
  }

  if (state === "photos") {
    return "confirmation";
  }

  return "confirmation";
}

async function handleCallback(
  env,
  query,
  user
) {
  const chatId =
    query.message.chat.id;

  const data = query.data || "";

  if (data === "cancel") {
    await clearSession(
      env,
      user.id
    );

    await answerCallbackQuery(
      env,
      query.id,
      "لغو شد"
    );

    await sendMessage(
      env,
      chatId,
      "عملیات لغو شد.",
      removeKeyboard()
    );

    return;
  }

  if (data === "submit") {
    await answerCallbackQuery(
      env,
      query.id
    );

    await startSubmit(
      env,
      chatId,
      user.id
    );

    return;
  }

  if (data === "status") {
    await answerCallbackQuery(
      env,
      query.id
    );

    await showStatus(
      env,
      chatId,
      user
    );

    return;
  }

  if (data === "profile") {
    await answerCallbackQuery(
      env,
      query.id
    );

    await showProfile(
      env,
      chatId,
      user
    );

    return;
  }

  if (data === "help") {
    await answerCallbackQuery(
      env,
      query.id
    );

    await showHelp(
      env,
      chatId
    );

    return;
  }

  if (data.startsWith("type:")) {
    const type =
      data.split(":")[1];

    if (!TYPE_NAMES[type]) {
      return;
    }

    const listing = {
      listing_type: type,
    };

    await setSession(
      env,
      user.id,
      "property_type",
      {
        listing,
      }
    );

    await answerCallbackQuery(
      env,
      query.id,
      TYPE_NAMES[type]
    );

    await nextQuestion(
      env,
      chatId,
      user.id,
      "property_type",
      listing
    );

    return;
  }

  if (data.startsWith("property:")) {
    const property =
      data.split(":")[1];

    const session =
      await getSession(
        env,
        user.id
      );

    const listing =
      safeJsonParse(
        session?.data,
        {}
      ).listing || {};

    listing.property_type =
      property;

    await setSession(
      env,
      user.id,
      "title",
      {
        listing,
      }
    );

    await answerCallbackQuery(
      env,
      query.id,
      PROPERTY_NAMES[property]
    );

    await nextQuestion(
      env,
      chatId,
      user.id,
      "title",
      listing
    );

    return;
  }

  if (data.startsWith("feature:")) {
    const [, field, value] =
      data.split(":");

    const session =
      await getSession(
        env,
        user.id
      );

    const listing =
      safeJsonParse(
        session?.data,
        {}
      ).listing || {};

    listing[field] =
      Number(value);

    let next;

    if (field === "furnished") {
      next = "balcony";
    } else if (field === "balcony") {
      next = "elevator";
    } else if (field === "elevator") {
      next = "photos";
    } else {
      next = "confirmation";
    }

    await setSession(
      env,
      user.id,
      next,
      {
        listing,
      }
    );

    await answerCallbackQuery(
      env,
      query.id,
      Number(value)
        ? "بله"
        : "خیر"
    );

    await nextQuestion(
      env,
      chatId,
      user.id,
      next,
      listing
    );

    return;
  }

  if (
    data === "listing:confirm"
  ) {
    const session =
      await getSession(
        env,
        user.id
      );

    if (!session) {
      return;
    }

    const listing =
      safeJsonParse(
        session.data,
        {}
      ).listing || {};

    const id =
      await saveListing(
        env,
        user,
        listing
      );

    await clearSession(
      env,
      user.id
    );

    await answerCallbackQuery(
      env,
      query.id,
      "آگهی ثبت شد"
    );

    await sendMessage(
      env,
      chatId,
      `آگهی شما با شماره #${id} ثبت شد.

وضعیت فعلی: در انتظار بررسی

پس از بررسی، وضعیت آگهی در بخش «پیگیری آگهی‌ها» قابل مشاهده است.`,
      removeKeyboard()
    );
  }
}

async function handleMessage(
  env,
  message
) {
  if (!message?.chat) {
    return;
  }

  const from =
    message.from;

  if (!from) {
    return;
  }

  const user =
    await getOrCreateUser(
      env,
      from
    );

  const chatId =
    message.chat.id;

  if (
    message.contact?.user_id ===
    from.id
  ) {
    const session =
      await getSession(
        env,
        user.id
      );

    if (
      session?.state === "phone"
    ) {
      await processListingText(
        env,
        chatId,
        user,
        session,
        "",
        message.contact
      );
    }

    return;
  }

  if (
    message.photo?.length
  ) {
    const session =
      await getSession(
        env,
        user.id
      );

    if (
      session?.state === "photos"
    ) {
      const data =
        safeJsonParse(
          session.data,
          {}
        );

      const listing =
        data.listing || {};

      listing.photos =
        listing.photos || [];

      if (
        listing.photos.length <
        MAX_PHOTOS
      ) {
        const photo =
          message.photo[
            message.photo.length - 1
          ];

        listing.photos.push(
          photo.file_id
        );
      }

      await setSession(
        env,
        user.id,
        "photos",
        {
          listing,
        }
      );

      const remaining =
        Math.max(
          0,
          MAX_PHOTOS -
            listing.photos.length
        );

      await sendMessage(
        env,
        chatId,
        remaining > 0
          ? `عکس دریافت شد. ${remaining} عکس دیگر می‌توانی بفرستی؛ یا «پایان عکس‌ها» را بزن.`
          : "حداکثر تعداد عکس دریافت شد. «پایان عکس‌ها» را بزن.",
        replyKeyboard([
          [
            {
              text: "پایان عکس‌ها",
            },
          ],
          [
            {
              text: "لغو",
            },
          ],
        ])
      );
    }

    return;
  }

  const text =
    normalizeText(
      message.text
    );

  if (!text) {
    return;
  }

  const command =
    commandName(text);

  if (command === "start") {
    await clearSession(
      env,
      user.id
    );

    await setCommands(env);

    await showStart(
      env,
      chatId,
      user
    );

    return;
  }

  if (command === "help") {
    await showHelp(
      env,
      chatId
    );

    return;
  }

  if (command === "submit") {
    await startSubmit(
      env,
      chatId,
      user.id
    );

    return;
  }

  if (command === "status") {
    await showStatus(
      env,
      chatId,
      user
    );

    return;
  }

  if (command === "profile") {
    await showProfile(
      env,
      chatId,
      user
    );

    return;
  }

  if (command === "cancel") {
    await clearSession(
      env,
      user.id
    );

    await sendMessage(
      env,
      chatId,
      "عملیات لغو شد.",
      removeKeyboard()
    );

    return;
  }

  const session =
    await getSession(
      env,
      user.id
    );

  if (
    session?.state === "photos" &&
    text === "پایان عکس‌ها"
  ) {
    const data =
      safeJsonParse(
        session.data,
        {}
      );

    const listing =
      data.listing || {};

    await setSession(
      env,
      user.id,
      "confirmation",
      {
        listing,
      }
    );

    await nextQuestion(
      env,
      chatId,
      user.id,
      "confirmation",
      listing
    );

    return;
  }

  if (
    session?.state &&
    session.state !== "idle"
  ) {
    await processListingText(
      env,
      chatId,
      user,
      session,
      text,
      null
    );

    return;
  }

  await sendMessage(
    env,
    chatId,
    "دستور شما شناخته نشد.\n\nبرای شروع /start را بزن یا برای ثبت آگهی /submit را ارسال کن."
  );
}

async function handleUpdate(
  env,
  update
) {
  const updateId = update.update_id;
  const claimedUpdateId = await claimUpdateId(
    env,
    updateId
  );

  if (!claimedUpdateId) {
    return;
  }

  try {
    if (
      update.callback_query
    ) {
      const query =
        update.callback_query;

      if (!query.from) {
        return;
      }

      const user =
        await getOrCreateUser(
          env,
          query.from
        );

      await handleCallback(
        env,
        query,
        user
      );

      return;
    }

    if (update.message) {
      await handleMessage(
        env,
        update.message
      );
    }
  } catch (error) {
    if (
      claimedUpdateId &&
      Boolean(error?.retryable)
    ) {
      await releaseUpdateId(
        env,
        updateId
      );
    }

    throw error;
  }
}

function checkWebhookSecret(
  request,
  env
) {
  const configured =
    env.TELEGRAM_WEBHOOK_SECRET;

  if (!configured) {
    return true;
  }

  return (
    request.headers.get(
      "X-Telegram-Bot-Api-Secret-Token"
    ) === configured
  );
}

export default {
  async fetch(request, env) {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return textResponse("Bad request.", 400);
    }

    if (url.pathname === "/") {
      return textResponse("duessAdminBot is running.");
    }

    if (url.pathname !== "/telegram/webhook") {
      return textResponse("Not found.", 404);
    }

    if (request.method !== "POST") {
      return textResponse(
        "Method not allowed.",
        405
      );
    }

    try {
      await ensureRuntimeReady(env);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "runtime_validation_failed",
          errorMessage: error?.message,
          errorName: error?.name,
        })
      );
      return textResponse(
        "Server misconfigured.",
        500
      );
    }

    if (!checkWebhookSecret(request, env)) {
      return textResponse("Unauthorized.", 401);
    }

    try {
      const update =
        await request.json();

      if (
        !update ||
        typeof update !== "object" ||
        Array.isArray(update) ||
        !Number.isInteger(update.update_id)
      ) {
        return textResponse(
          "Invalid telegram update.",
          400
        );
      }

      await handleUpdate(
        env,
        update
      );

      return textResponse("OK");
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "webhook_processing_error",
          errorMessage: error?.message,
          errorName: error?.name,
          retryable: Boolean(error?.retryable),
        })
      );

      return textResponse(
        "Internal error.",
        Boolean(error?.retryable)
          ? 503
          : 500
      );
    }
  },
};
