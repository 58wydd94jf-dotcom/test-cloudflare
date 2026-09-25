const COMMANDS = [
  { command: "start", description: "شروع کار با ربات" },
  { command: "submit", description: "ثبت آگهی مسکن" },
  { command: "help", description: "راهنمای استفاده" },
  { command: "status", description: "پیگیری وضعیت آگهی‌ها" },
  { command: "profile", description: "مشاهده پروفایل" },
  { command: "cancel", description: "لغو عملیات جاری" },
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
const DEFAULT_CITY = "Düsseldorf";
const TELEGRAM_SECRET_HEADER =
  "X-Telegram-Bot-Api-Secret-Token";

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
  return value ? String(value) : "—";
}

function safeJsonParse(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTelegramToken(env) {
  return (
    normalizeText(env.TELEGRAM_BOT_TOKEN) ||
    normalizeText(env.TELEGRAM_BOT_TOK) ||
    null
  );
}

function redactToken(value, token) {
  if (!token) {
    return String(value ?? "");
  }

  return String(value ?? "").split(token).join("[redacted]");
}

function safeErrorMessage(error, token) {
  return redactToken(error?.message || "unknown_error", token);
}

function validListingType(type) {
  return Object.hasOwn(TYPE_NAMES, type);
}

function validPropertyType(type) {
  return Object.hasOwn(PROPERTY_NAMES, type);
}

function cleanListingText(value, maxLength) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  return text.slice(0, maxLength);
}

function uniquePhotos(photos = []) {
  const values = [];
  const seen = new Set();

  for (const photo of photos) {
    const value = normalizeText(photo);

    if (!value || seen.has(value)) {
      continue;
    }

    seen.add(value);
    values.push(value);

    if (values.length >= MAX_PHOTOS) {
      break;
    }
  }

  return values;
}

function cloneListing(listing = {}) {
  return {
    ...listing,
    photos: uniquePhotos(listing.photos),
  };
}

function normalizePhoneNumber(value) {
  const phone = normalizeText(value);
  return phone ? phone.slice(0, 50) : null;
}

function normalizeListingForSave(listing = {}) {
  return {
    listing_type: listing.listing_type,
    property_type: listing.property_type ?? null,
    title: cleanListingText(listing.title, 120),
    description: cleanListingText(listing.description, 4000),
    city: cleanListingText(listing.city, 120) || DEFAULT_CITY,
    district: cleanListingText(listing.district, 120),
    address: cleanListingText(listing.address, 255),
    rooms:
      listing.rooms === null || listing.rooms === undefined
        ? null
        : Number(listing.rooms),
    area_sqm:
      listing.area_sqm === null ||
      listing.area_sqm === undefined
        ? null
        : Number(listing.area_sqm),
    cold_rent:
      listing.cold_rent === null ||
      listing.cold_rent === undefined
        ? null
        : Number(listing.cold_rent),
    warm_rent:
      listing.warm_rent === null ||
      listing.warm_rent === undefined
        ? null
        : Number(listing.warm_rent),
    additional_costs:
      listing.additional_costs === null ||
      listing.additional_costs === undefined
        ? null
        : Number(listing.additional_costs),
    deposit:
      listing.deposit === null ||
      listing.deposit === undefined
        ? null
        : Number(listing.deposit),
    available_from:
      cleanListingText(listing.available_from, 50),
    furnished: Number(listing.furnished) ? 1 : 0,
    balcony: Number(listing.balcony) ? 1 : 0,
    elevator: Number(listing.elevator) ? 1 : 0,
    floor: cleanListingText(listing.floor, 50),
    sale_price:
      listing.sale_price === null ||
      listing.sale_price === undefined
        ? null
        : Number(listing.sale_price),
    phone: normalizePhoneNumber(listing.phone),
    photos: uniquePhotos(listing.photos),
  };
}

function validateListing(listing = {}) {
  const normalized = normalizeListingForSave(listing);
  const errors = [];

  if (!validListingType(normalized.listing_type)) {
    errors.push("نوع آگهی نامعتبر است.");
  }

  if (!validPropertyType(normalized.property_type)) {
    errors.push("نوع ملک نامعتبر است.");
  }

  if (!normalized.title) {
    errors.push("عنوان آگهی الزامی است.");
  }

  if (!normalized.description) {
    errors.push("توضیحات آگهی الزامی است.");
  }

  if (!normalized.city) {
    errors.push("شهر آگهی الزامی است.");
  }

  if (!normalized.district) {
    errors.push("منطقه یا محله آگهی الزامی است.");
  }

  if (!normalized.address) {
    errors.push("نشانی آگهی الزامی است.");
  }

  if (
    normalized.rooms === null ||
    !Number.isFinite(normalized.rooms) ||
    normalized.rooms < 0
  ) {
    errors.push("تعداد اتاق باید یک عدد معتبر باشد.");
  }

  if (
    normalized.area_sqm === null ||
    !Number.isFinite(normalized.area_sqm) ||
    normalized.area_sqm <= 0
  ) {
    errors.push("متراژ باید یک عدد معتبر و بزرگ‌تر از صفر باشد.");
  }

  if (!normalized.available_from) {
    errors.push("تاریخ آماده بودن آگهی الزامی است.");
  }

  if (!normalized.floor) {
    errors.push("طبقه آگهی الزامی است.");
  }

  if (!normalized.phone) {
    errors.push("شماره تلفن تماس الزامی است.");
  }

  if (normalized.photos.length > MAX_PHOTOS) {
    errors.push(
      `حداکثر ${MAX_PHOTOS} عکس برای هر آگهی مجاز است.`
    );
  }

  if (normalized.listing_type === "sale") {
    if (
      normalized.sale_price === null ||
      !Number.isFinite(normalized.sale_price) ||
      normalized.sale_price < 0
    ) {
      errors.push("قیمت فروش باید یک عدد معتبر باشد.");
    }
  } else {
    for (const [field, label] of [
      ["cold_rent", "اجاره سرد"],
      ["warm_rent", "اجاره گرم"],
      ["additional_costs", "هزینه‌های جانبی"],
      ["deposit", "ودیعه"],
    ]) {
      const value = normalized[field];

      if (
        value === null ||
        !Number.isFinite(value) ||
        value < 0
      ) {
        errors.push(`${label} باید یک عدد معتبر باشد.`);
      }
    }
  }

  return errors;
}

function nextState(state, listing) {
  switch (state) {
    case "listing_type":
      return "property_type";
    case "property_type":
      return "title";
    case "title":
      return "description";
    case "description":
      return "city";
    case "city":
      return "district";
    case "district":
      return "address";
    case "address":
      return "rooms";
    case "rooms":
      return "area_sqm";
    case "area_sqm":
      return listing.listing_type === "sale"
        ? "sale_price"
        : "cold_rent";
    case "cold_rent":
      return "warm_rent";
    case "warm_rent":
      return "additional_costs";
    case "additional_costs":
      return "deposit";
    case "deposit":
    case "sale_price":
      return "available_from";
    case "available_from":
      return "floor";
    case "floor":
      return "phone";
    case "phone":
      return "features";
    case "features":
      return "balcony";
    case "balcony":
      return "elevator";
    case "elevator":
      return "photos";
    case "photos":
      return "confirmation";
    default:
      return "confirmation";
  }
}

function makeConfirmationToken() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function ensureConfirmationToken(listing) {
  if (!listing.confirmation_token) {
    listing.confirmation_token = makeConfirmationToken();
  }

  return listing.confirmation_token;
}

function listingSummary(listing) {
  const normalized = normalizeListingForSave(listing);
  const price =
    normalized.listing_type === "sale"
      ? `قیمت فروش: ${formatEuro(normalized.sale_price)}`
      : [
          `اجاره سرد: ${formatEuro(normalized.cold_rent)}`,
          `اجاره گرم: ${formatEuro(normalized.warm_rent)}`,
          `هزینه‌های جانبی: ${formatEuro(
            normalized.additional_costs
          )}`,
          `ودیعه: ${formatEuro(normalized.deposit)}`,
        ].join("\n");

  return `خلاصه آگهی

نوع آگهی: ${
    TYPE_NAMES[normalized.listing_type] || "—"
  }
نوع ملک: ${
    PROPERTY_NAMES[normalized.property_type] || "—"
  }
عنوان: ${normalized.title || "—"}
توضیحات: ${normalized.description || "—"}
شهر: ${normalized.city || "—"}
منطقه: ${normalized.district || "—"}
نشانی: ${normalized.address || "—"}
تعداد اتاق: ${formatNumber(normalized.rooms)}
متراژ: ${formatNumber(
    normalized.area_sqm
  )} مترمربع
${price}
تاریخ آماده بودن: ${formatDate(
    normalized.available_from
  )}
مبله: ${boolLabel(normalized.furnished)}
بالکن: ${boolLabel(normalized.balcony)}
آسانسور: ${boolLabel(normalized.elevator)}
طبقه: ${normalized.floor || "—"}
شماره تلفن: ${normalized.phone || "—"}
تعداد عکس: ${normalized.photos.length}

اگر همه اطلاعات درست است، دکمه «تأیید و ثبت» را بزن.`;
}

async function telegram(env, method, body) {
  const token = getTelegramToken(env);

  if (!token) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  const url =
    `https://api.telegram.org/bot${token}/${method}`;

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const raw = await response.text();
      let data;

      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        throw new Error(
          `Telegram ${method} returned malformed JSON`
        );
      }

      if (!response.ok) {
        throw new Error(
          `Telegram ${method} returned HTTP ${response.status}`
        );
      }

      if (!data || data.ok !== true) {
        throw new Error(
          `Telegram ${method} rejected the request`
        );
      }

      return data.result;
    } catch (error) {
      lastError = error;

      console.error(
        JSON.stringify({
          scope: "telegram",
          method,
          attempt,
          errorMessage: safeErrorMessage(
            error,
            token
          ),
        })
      );

      if (attempt < 3) {
        await delay(attempt * 500);
      }
    }
  }

  throw lastError;
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

async function getOrCreateUser(env, from) {
  const user = await env.DB.prepare(
    `INSERT INTO users
      (telegram_id, username, first_name, last_name)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET
       username = excluded.username,
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`
  )
    .bind(
      from.id,
      from.username ?? null,
      from.first_name ?? null,
      from.last_name ?? null
    )
    .first();

  if (!user) {
    throw new Error("user_upsert_failed");
  }

  return user;
}

async function getSession(env, userId) {
  return env.DB.prepare(
    "SELECT * FROM user_sessions WHERE user_id = ?"
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
      JSON.stringify(data ?? {})
    )
    .run();
}

async function clearSession(env, userId) {
  await env.DB.prepare(
    `INSERT INTO user_sessions
      (user_id, state, data, updated_at)
     VALUES (?, 'idle', NULL, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       state = 'idle',
       data = NULL,
       updated_at = CURRENT_TIMESTAMP`
  )
    .bind(userId)
    .run();
}

async function claimUpdate(env, updateId) {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO telegram_updates
      (update_id, processed_at)
     VALUES (?, CURRENT_TIMESTAMP)`
  )
    .bind(updateId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

async function releaseUpdateClaim(env, updateId) {
  await env.DB.prepare(
    "DELETE FROM telegram_updates WHERE update_id = ?"
  )
    .bind(updateId)
    .run();
}

function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0
    ? number
    : fallback;
}

function getRetentionDays(env) {
  return positiveInteger(
    env.TELEGRAM_UPDATE_RETENTION_DAYS,
    30
  );
}

function getCleanupBatchSize(env) {
  return positiveInteger(
    env.TELEGRAM_UPDATE_CLEANUP_BATCH_SIZE,
    500
  );
}

async function cleanupProcessedUpdates(
  env,
  options = {}
) {
  const retentionDays =
    options.retentionDays ?? getRetentionDays(env);
  const batchSize =
    options.batchSize ?? getCleanupBatchSize(env);

  if (retentionDays <= 0 || batchSize <= 0) {
    return 0;
  }

  const result = await env.DB.prepare(
    `DELETE FROM telegram_updates
     WHERE update_id IN (
       SELECT update_id
       FROM telegram_updates
       WHERE processed_at < datetime('now', ?)
       ORDER BY processed_at
       LIMIT ?
     )`
  )
    .bind(`-${retentionDays} days`, batchSize)
    .run();

  return result.meta?.changes ?? 0;
}

async function setCommands(env) {
  try {
    await telegram(env, "setMyCommands", {
      commands: COMMANDS,
    });
  } catch {
    // شکست در تنظیم منو نباید عملکرد اصلی ربات را متوقف کند.
  }
}

async function showStart(env, chatId, user) {
  const name = user.first_name || "دوست عزیز";

  await sendMessage(
    env,
    chatId,
    `سلام ${name}.

به ربات رسمی دوسلدورف خانه خوش آمدی.

از اینجا می‌توانی آگهی مسکن ثبت کنی، وضعیت آگهی‌هایت را ببینی و پروفایلت را مدیریت کنی.`,
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

/start — بازگشت به صفحه اصلی
/submit — شروع ثبت آگهی جدید
/status — مشاهده آگهی‌های ثبت‌شده
/profile — مشاهده پروفایل
/cancel — لغو فرایند جاری
/help — نمایش همین راهنما`
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
       AND status IN ('pending', 'approved', 'published')`
  )
    .bind(user.id)
    .first();

  const username = user.username
    ? `@${user.username}`
    : "ثبت نشده";

  await sendMessage(
    env,
    chatId,
    `پروفایل شما

نام: ${user.first_name || "—"}
نام خانوادگی: ${user.last_name || "—"}
نام کاربری: ${username}
شماره تلفن: ${user.phone || "ثبت نشده"}

تعداد کل آگهی‌ها: ${count?.count ?? 0}
آگهی‌های فعال یا در انتظار بررسی: ${
      active?.count ?? 0
    }`
  );
}

async function showStatus(env, chatId, user) {
  const rows = await env.DB.prepare(
    `SELECT
       id,
       listing_type,
       property_type,
       title,
       city,
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
      "هنوز هیچ آگهی‌ای برای شما ثبت نشده است.",
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

  const lines = ["آگهی‌های شما:\n"];

  for (const row of rows.results) {
    const price =
      row.listing_type === "sale"
        ? formatEuro(row.sale_price)
        : formatEuro(
            row.warm_rent ?? row.cold_rent
          );

    lines.push(
      `#${row.id} — ${
        TYPE_NAMES[row.listing_type] || row.listing_type
      }\n` +
        `${row.title ||
          PROPERTY_NAMES[row.property_type] ||
          "آگهی مسکن"}\n` +
        `شهر: ${row.city || DEFAULT_CITY}\n` +
        `متراژ: ${formatNumber(
          row.area_sqm
        )} مترمربع\n` +
        `قیمت: ${price}\n` +
        `وضعیت: ${
          STATUS_NAMES[row.status] || row.status
        }\n`
    );
  }

  await sendMessage(env, chatId, lines.join("\n"));
}

async function startSubmit(env, chatId, userId) {
  await setSession(env, userId, "listing_type", {
    listing: {
      city: DEFAULT_CITY,
    },
  });

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
  const errors = validateListing(listing);

  if (errors.length) {
    throw new Error(errors[0]);
  }

  const normalized = normalizeListingForSave(listing);
  let listingId = null;

  try {
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
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        'pending'
      )`
    )
      .bind(
        user.id,
        normalized.listing_type,
        normalized.property_type,
        normalized.title,
        normalized.description,
        normalized.city,
        normalized.district,
        normalized.address,
        normalized.rooms,
        normalized.area_sqm,
        normalized.cold_rent,
        normalized.warm_rent,
        normalized.additional_costs,
        normalized.deposit,
        normalized.available_from,
        normalized.furnished,
        normalized.balcony,
        normalized.elevator,
        normalized.floor,
        normalized.sale_price
      )
      .run();

    listingId = result.meta?.last_row_id ?? null;

    for (const [index, fileId] of normalized.photos.entries()) {
      await env.DB.prepare(
        `INSERT INTO listing_images
          (listing_id, telegram_file_id, sort_order)
         VALUES (?, ?, ?)`
      )
        .bind(listingId, fileId, index)
        .run();
    }

    return listingId;
  } catch (error) {
    if (listingId !== null) {
      await env.DB.prepare(
        "DELETE FROM listings WHERE id = ?"
      )
        .bind(listingId)
        .run();
    }

    throw error;
  }
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
    city:
      "شهر آگهی را بنویس. اگر آگهی مربوط به دوسلدورف است، «Düsseldorf» را وارد کن.",
    district:
      "نام منطقه یا محله را بنویس.",
    address:
      "نشانی یا محدوده تقریبی آگهی را بنویس.",
    rooms:
      "تعداد اتاق را وارد کن؛ مثلاً 2 یا 2,5",
    area_sqm:
      "متراژ را به مترمربع وارد کن؛ مثلاً 55",
    cold_rent:
      "اجاره سرد را به یورو وارد کن.",
    warm_rent:
      "اجاره گرم را به یورو وارد کن.",
    additional_costs:
      "هزینه‌های جانبی را به یورو وارد کن. اگر ندارد، 0 بنویس.",
    deposit:
      "ودیعه را به یورو وارد کن. اگر ندارد، 0 بنویس.",
    sale_price:
      "قیمت فروش را به یورو وارد کن.",
    available_from:
      "تاریخ آماده بودن را وارد کن؛ مثلاً 01.10.2026",
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
عکس‌ها را یکی‌یکی ارسال کن.
وقتی کار تمام شد، دکمه «پایان عکس‌ها» را بزن.`,
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
            callback_data: "feature:furnished:1",
          },
          {
            text: "خیر",
            callback_data: "feature:furnished:0",
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
      "آیا ملک بالکن دارد؟",
      keyboard([
        [
          {
            text: "بله",
            callback_data: "feature:balcony:1",
          },
          {
            text: "خیر",
            callback_data: "feature:balcony:0",
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
      "آیا ملک آسانسور دارد؟",
      keyboard([
        [
          {
            text: "بله",
            callback_data: "feature:elevator:1",
          },
          {
            text: "خیر",
            callback_data: "feature:elevator:0",
          },
        ],
      ])
    );
    return;
  }

  if (state === "confirmation") {
    const token = ensureConfirmationToken(listing);

    await setSession(env, userId, "confirmation", {
      listing,
    });

    await sendMessage(
      env,
      chatId,
      listingSummary(listing),
      keyboard([
        [
          {
            text: "تأیید و ثبت",
            callback_data: `listing:confirm:${token}`,
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
            callback_data: "property:apartment",
          },
        ],
        [
          {
            text: "خانه",
            callback_data: "property:house",
          },
        ],
        [
          {
            text: "اتاق",
            callback_data: "property:room",
          },
        ],
      ])
    );
    return;
  }

  if (questions[state]) {
    const markup =
      state === "phone"
        ? replyKeyboard([
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
          ])
        : replyKeyboard([
            [
              {
                text: "لغو",
              },
            ],
          ]);

    await sendMessage(
      env,
      chatId,
      questions[state],
      markup
    );
  }
}

async function rejectInvalidState(
  env,
  chatId,
  callbackId,
  text
) {
  if (callbackId) {
    await answerCallbackQuery(env, callbackId, text);
  }

  if (chatId) {
    await sendMessage(env, chatId, text);
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
  const payload = safeJsonParse(session.data, {});
  const listing = cloneListing(payload.listing);
  const state = session.state;

  if (text === "لغو" || text === "/cancel") {
    await clearSession(env, user.id);
    await sendMessage(
      env,
      chatId,
      "عملیات لغو شد.",
      removeKeyboard()
    );
    return;
  }

  if (
    [
      "listing_type",
      "property_type",
      "features",
      "balcony",
      "elevator",
      "confirmation",
    ].includes(state)
  ) {
    await sendMessage(
      env,
      chatId,
      "در این مرحله از دکمه‌های نمایش‌داده‌شده استفاده کن."
    );
    return;
  }

  if (state === "photos") {
    await sendMessage(
      env,
      chatId,
      "لطفاً عکس بفرست یا دکمه «پایان عکس‌ها» را بزن."
    );
    return;
  }

  if (state === "title") {
    const value = cleanListingText(text, 120);

    if (!value) {
      await sendMessage(
        env,
        chatId,
        "عنوان آگهی نمی‌تواند خالی باشد."
      );
      return;
    }

    listing.title = value;
  } else if (state === "description") {
    const value = cleanListingText(text, 4000);

    if (!value) {
      await sendMessage(
        env,
        chatId,
        "توضیحات آگهی نمی‌تواند خالی باشد."
      );
      return;
    }

    listing.description = value;
  } else if (state === "city") {
    const value = cleanListingText(text, 120);

    if (!value) {
      await sendMessage(
        env,
        chatId,
        "شهر آگهی را وارد کن."
      );
      return;
    }

    listing.city = value;
  } else if (state === "district") {
    const value = cleanListingText(text, 120);

    if (!value) {
      await sendMessage(
        env,
        chatId,
        "نام منطقه یا محله را وارد کن."
      );
      return;
    }

    listing.district = value;
  } else if (state === "address") {
    const value = cleanListingText(text, 255);

    if (!value) {
      await sendMessage(
        env,
        chatId,
        "نشانی یا محدوده آگهی را وارد کن."
      );
      return;
    }

    listing.address = value;
  } else if (state === "rooms") {
    const value = parseGermanNumber(text);

    if (value === null || value < 0) {
      await sendMessage(
        env,
        chatId,
        "تعداد اتاق باید یک عدد معتبر باشد."
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
        "متراژ باید بزرگ‌تر از صفر باشد."
      );
      return;
    }

    listing.area_sqm = value;
  } else if (
    [
      "cold_rent",
      "warm_rent",
      "additional_costs",
      "deposit",
      "sale_price",
    ].includes(state)
  ) {
    const value = parseGermanNumber(text);

    if (value === null || value < 0) {
      await sendMessage(
        env,
        chatId,
        "مبلغ واردشده معتبر نیست."
      );
      return;
    }

    listing[state] = value;
  } else if (state === "available_from") {
    const value = cleanListingText(text, 50);

    if (!value) {
      await sendMessage(
        env,
        chatId,
        "تاریخ آماده بودن را وارد کن."
      );
      return;
    }

    listing.available_from = value;
  } else if (state === "floor") {
    const value = cleanListingText(text, 50);

    if (!value) {
      await sendMessage(
        env,
        chatId,
        "طبقه را وارد کن."
      );
      return;
    }

    listing.floor = value;
  } else if (state === "phone") {
    const phone = normalizePhoneNumber(
      contact?.phone_number || text
    );

    if (!phone) {
      await sendMessage(
        env,
        chatId,
        "شماره تلفن معتبر وارد کن یا آن را با دکمه ارسال شماره بفرست."
      );
      return;
    }

    listing.phone = phone;

    await env.DB.prepare(
      `UPDATE users
       SET phone = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(phone, user.id)
      .run();
  } else {
    await sendMessage(
      env,
      chatId,
      "وضعیت فعلی نامعتبر است. لطفاً دوباره /start را بزن."
    );
    return;
  }

  const next = nextState(state, listing);

  if (next === "confirmation") {
    ensureConfirmationToken(listing);
  }

  await setSession(env, user.id, next, { listing });
  await nextQuestion(
    env,
    chatId,
    user.id,
    next,
    listing
  );
}

function featureStateForField(field) {
  if (field === "furnished") {
    return "features";
  }

  if (field === "balcony") {
    return "balcony";
  }

  if (field === "elevator") {
    return "elevator";
  }

  return null;
}

async function handleCallback(env, query, user) {
  const chatId = query.message?.chat?.id;
  const data = normalizeText(query.data);

  if (!chatId) {
    await answerCallbackQuery(
      env,
      query.id,
      "درخواست نامعتبر است."
    );
    return;
  }

  if (data === "cancel") {
    await clearSession(env, user.id);
    await answerCallbackQuery(env, query.id, "لغو شد");
    await sendMessage(
      env,
      chatId,
      "عملیات لغو شد.",
      removeKeyboard()
    );
    return;
  }

  if (data === "submit") {
    await answerCallbackQuery(env, query.id);
    await startSubmit(env, chatId, user.id);
    return;
  }

  if (data === "status") {
    await answerCallbackQuery(env, query.id);
    await showStatus(env, chatId, user);
    return;
  }

  if (data === "profile") {
    await answerCallbackQuery(env, query.id);
    await showProfile(env, chatId, user);
    return;
  }

  if (data === "help") {
    await answerCallbackQuery(env, query.id);
    await showHelp(env, chatId);
    return;
  }

  const session = await getSession(env, user.id);
  const payload = safeJsonParse(session?.data, {});
  const listing = cloneListing(payload.listing);

  if (data.startsWith("type:")) {
    const type = data.split(":")[1];

    if (session?.state !== "listing_type") {
      await rejectInvalidState(
        env,
        chatId,
        query.id,
        "این انتخاب دیگر معتبر نیست."
      );
      return;
    }

    if (!validListingType(type)) {
      await rejectInvalidState(
        env,
        chatId,
        query.id,
        "نوع آگهی نامعتبر است."
      );
      return;
    }

    listing.listing_type = type;

    await setSession(env, user.id, "property_type", {
      listing,
    });

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
    const property = data.split(":")[1];

    if (session?.state !== "property_type") {
      await rejectInvalidState(
        env,
        chatId,
        query.id,
        "این انتخاب دیگر معتبر نیست."
      );
      return;
    }

    if (!validPropertyType(property)) {
      await rejectInvalidState(
        env,
        chatId,
        query.id,
        "نوع ملک نامعتبر است."
      );
      return;
    }

    listing.property_type = property;

    await setSession(env, user.id, "title", {
      listing,
    });

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
    const [, field, value] = data.split(":");
    const expectedState = featureStateForField(field);

    if (!expectedState || session?.state !== expectedState) {
      await rejectInvalidState(
        env,
        chatId,
        query.id,
        "این انتخاب دیگر معتبر نیست."
      );
      return;
    }

    if (!["0", "1"].includes(value)) {
      await rejectInvalidState(
        env,
        chatId,
        query.id,
        "مقدار انتخاب‌شده نامعتبر است."
      );
      return;
    }

    listing[field] = Number(value);

    const next = nextState(session.state, listing);

    if (next === "confirmation") {
      ensureConfirmationToken(listing);
    }

    await setSession(env, user.id, next, { listing });

    await answerCallbackQuery(
      env,
      query.id,
      Number(value) ? "بله" : "خیر"
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

  if (data.startsWith("listing:confirm:")) {
    const token = data.split(":")[2];

    if (session?.state !== "confirmation") {
      await answerCallbackQuery(
        env,
        query.id,
        "این درخواست قبلاً پردازش شده یا دیگر معتبر نیست."
      );
      return;
    }

    if (!token || listing.confirmation_token !== token) {
      await rejectInvalidState(
        env,
        chatId,
        query.id,
        "این دکمه دیگر معتبر نیست."
      );
      return;
    }

    const validationErrors = validateListing(listing);

    if (validationErrors.length) {
      await answerCallbackQuery(
        env,
        query.id,
        "اطلاعات آگهی ناقص یا نامعتبر است."
      );
      await sendMessage(
        env,
        chatId,
        `آگهی هنوز کامل نیست:

- ${validationErrors.join("\n- ")}`
      );
      return;
    }

    const transition = await env.DB.prepare(
      `UPDATE user_sessions
       SET state = 'saving',
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?
         AND state = 'confirmation'`
    )
      .bind(user.id)
      .run();

    if ((transition.meta?.changes ?? 0) === 0) {
      await answerCallbackQuery(
        env,
        query.id,
        "این درخواست قبلاً پردازش شده یا دیگر معتبر نیست."
      );
      return;
    }

    try {
      const id = await saveListing(env, user, listing);

      await clearSession(env, user.id);

      await answerCallbackQuery(
        env,
        query.id,
        "آگهی ثبت شد."
      );

      await sendMessage(
        env,
        chatId,
        `آگهی شما با شماره #${id} ثبت شد.

وضعیت فعلی: در انتظار بررسی

پس از بررسی، وضعیت آگهی در بخش «آگهی‌های من» قابل مشاهده است.`,
        removeKeyboard()
      );
    } catch (error) {
      await setSession(env, user.id, "confirmation", {
        listing,
      });
      throw error;
    }

    return;
  }

  await answerCallbackQuery(
    env,
    query.id,
    "درخواست نامعتبر است."
  );
}

async function handleMessage(env, message) {
  if (!message?.chat || !message.from) {
    return;
  }

  const user = await getOrCreateUser(env, message.from);
  const chatId = message.chat.id;

  if (message.contact?.user_id === message.from.id) {
    const session = await getSession(env, user.id);

    if (session?.state === "phone") {
      await processListingText(
        env,
        chatId,
        user,
        session,
        "",
        message.contact
      );
    } else {
      await sendMessage(
        env,
        chatId,
        "در حال حاضر نیازی به دریافت شماره تلفن نیست."
      );
    }

    return;
  }

  if (message.photo?.length) {
    const session = await getSession(env, user.id);

    if (session?.state !== "photos") {
      await sendMessage(
        env,
        chatId,
        "در این مرحله امکان ثبت عکس وجود ندارد."
      );
      return;
    }

    const payload = safeJsonParse(session.data, {});
    const listing = cloneListing(payload.listing);
    const photo =
      message.photo[message.photo.length - 1];

    if (
      photo?.file_id &&
      listing.photos.length < MAX_PHOTOS &&
      !listing.photos.includes(photo.file_id)
    ) {
      listing.photos.push(photo.file_id);
    }

    await setSession(env, user.id, "photos", {
      listing,
    });

    const remaining = Math.max(
      0,
      MAX_PHOTOS - listing.photos.length
    );

    await sendMessage(
      env,
      chatId,
      remaining > 0
        ? `عکس دریافت شد. ${remaining} عکس دیگر هم می‌توانی بفرستی یا دکمه «پایان عکس‌ها» را بزنی.`
        : "به سقف تعداد عکس‌ها رسیدی. حالا دکمه «پایان عکس‌ها» را بزن.",
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

  const text = normalizeText(message.text);

  if (!text) {
    return;
  }

  const command = commandName(text);

  if (command === "start") {
    await clearSession(env, user.id);
    await setCommands(env);
    await showStart(env, chatId, user);
    return;
  }

  if (command === "help") {
    await showHelp(env, chatId);
    return;
  }

  if (command === "submit") {
    await startSubmit(env, chatId, user.id);
    return;
  }

  if (command === "status") {
    await showStatus(env, chatId, user);
    return;
  }

  if (command === "profile") {
    await showProfile(env, chatId, user);
    return;
  }

  if (command === "cancel") {
    await clearSession(env, user.id);
    await sendMessage(
      env,
      chatId,
      "عملیات لغو شد.",
      removeKeyboard()
    );
    return;
  }

  const session = await getSession(env, user.id);

  if (
    session?.state === "photos" &&
    text === "پایان عکس‌ها"
  ) {
    const payload = safeJsonParse(session.data, {});
    const listing = cloneListing(payload.listing);

    ensureConfirmationToken(listing);

    await setSession(env, user.id, "confirmation", {
      listing,
    });

    await nextQuestion(
      env,
      chatId,
      user.id,
      "confirmation",
      listing
    );
    return;
  }

  if (session?.state && session.state !== "idle") {
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

async function handleUpdate(env, update) {
  const updateId =
    Number.isInteger(update?.update_id)
      ? update.update_id
      : null;

  if (updateId !== null) {
    const claimed = await claimUpdate(env, updateId);

    if (!claimed) {
      return;
    }
  }

  try {
    if (update?.callback_query) {
      if (!update.callback_query.from) {
        return;
      }

      const user = await getOrCreateUser(
        env,
        update.callback_query.from
      );

      await handleCallback(
        env,
        update.callback_query,
        user
      );
      return;
    }

    if (update?.message) {
      await handleMessage(env, update.message);
    }
  } catch (error) {
    if (updateId !== null) {
      await releaseUpdateClaim(env, updateId);
    }

    throw error;
  }
}

function checkWebhookSecret(request, env) {
  const configured = normalizeText(
    env.TELEGRAM_WEBHOOK_SECRET
  );
  const appEnv = normalizeText(env.APP_ENV).toLowerCase();

  if (appEnv === "production" && !configured) {
    return {
      ok: false,
      status: 500,
      message:
        "Production webhook secret is not configured.",
    };
  }

  if (!configured) {
    return {
      ok: true,
    };
  }

  if (
    request.headers.get(TELEGRAM_SECRET_HEADER) !==
    configured
  ) {
    return {
      ok: false,
      status: 401,
      message: "Unauthorized.",
    };
  }

  return {
    ok: true,
  };
}

const internals = {
  COMMANDS,
  TYPE_NAMES,
  PROPERTY_NAMES,
  STATUS_NAMES,
  MAX_PHOTOS,
  DEFAULT_CITY,
  textResponse,
  jsonResponse,
  telegram,
  sendMessage,
  answerCallbackQuery,
  keyboard,
  replyKeyboard,
  removeKeyboard,
  normalizeText,
  parseGermanNumber,
  formatEuro,
  formatNumber,
  formatDate,
  safeJsonParse,
  boolLabel,
  commandName,
  getOrCreateUser,
  getSession,
  setSession,
  clearSession,
  claimUpdate,
  releaseUpdateClaim,
  cleanupProcessedUpdates,
  getRetentionDays,
  getCleanupBatchSize,
  showStart,
  showHelp,
  showProfile,
  showStatus,
  startSubmit,
  saveListing,
  listingSummary,
  validateListing,
  normalizeListingForSave,
  nextQuestion,
  processListingText,
  nextState,
  handleCallback,
  handleMessage,
  handleUpdate,
  checkWebhookSecret,
};

export { internals };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return textResponse("ربات آماده دریافت درخواست است.");
    }

    if (url.pathname !== "/telegram/webhook") {
      return textResponse("یافت نشد.", 404);
    }

    if (request.method !== "POST") {
      return textResponse("متد مجاز نیست.", 405);
    }

    const secretCheck = checkWebhookSecret(request, env);

    if (!secretCheck.ok) {
      return textResponse(
        secretCheck.message,
        secretCheck.status
      );
    }

    let update;

    try {
      update = await request.json();
    } catch {
      return textResponse("درخواست نامعتبر است.", 400);
    }

    try {
      await handleUpdate(env, update);
      return textResponse("OK");
    } catch (error) {
      console.error(
        JSON.stringify({
          scope: "worker",
          errorMessage: safeErrorMessage(
            error,
            getTelegramToken(env)
          ),
        })
      );

      return textResponse("خطای داخلی.", 500);
    }
  },

  async scheduled(_controller, env) {
    await cleanupProcessedUpdates(env);
  },
};
