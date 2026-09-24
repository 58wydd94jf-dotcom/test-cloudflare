const BOT_TOKEN = (env) => env.TELEGRAM_BOT_TOK;

async function telegram(method, body, env) {
  const token = BOT_TOKEN(env);

  if (!token) {
    throw new Error("TELEGRAM_BOT_TOK is not configured");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`Telegram API error: ${response.status}`);
  }

  return response.json();
}

async function sendMessage(chatId, text, env) {
  return telegram(
    "sendMessage",
    {
      chat_id: chatId,
      text,
    },
    env
  );
}

function parseNumber(value) {
  const text = String(value)
    .trim()
    .replace(/\s/g, "");

  if (text.includes(",") && text.includes(".")) {
    return Number(text.replace(/\./g, "").replace(",", "."));
  }

  if (text.includes(",")) {
    return Number(text.replace(",", "."));
  }

  return Number(text);
}

async function getUser(env, telegramUser) {
  await env.DB.prepare(`
    INSERT INTO users
      (telegram_id, username, first_name, last_name)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET
      username = excluded.username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      updated_at = CURRENT_TIMESTAMP
  `)
    .bind(
      telegramUser.id,
      telegramUser.username || null,
      telegramUser.first_name || null,
      telegramUser.last_name || null
    )
    .run();

  return env.DB.prepare(
    "SELECT * FROM users WHERE telegram_id = ?"
  )
    .bind(telegramUser.id)
    .first();
}

async function getSession(env, userId) {
  return env.DB.prepare(
    "SELECT * FROM user_sessions WHERE user_id = ?"
  )
    .bind(userId)
    .first();
}

async function setSession(env, userId, state, data = {}) {
  await env.DB.prepare(`
    INSERT INTO user_sessions
      (user_id, state, data, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      state = excluded.state,
      data = excluded.data,
      updated_at = CURRENT_TIMESTAMP
  `)
    .bind(userId, state, JSON.stringify(data))
    .run();
}

async function clearSession(env, userId) {
  await env.DB.prepare(
    "DELETE FROM user_sessions WHERE user_id = ?"
  )
    .bind(userId)
    .run();
}

async function showStart(chatId, env) {
  await sendMessage(
    chatId,
    `سلام و خوش آمدید به ربات رسمی دوسلدورف خانه.

از طریق این ربات می‌توانید:
• آگهی مسکن ثبت کنید
• آگهی‌های خود را پیگیری کنید
• اطلاعات پروفایل خود را ببینید

برای شروع ثبت آگهی:
 /submit

راهنما:
 /help`,
    env
  );
}

async function showHelp(chatId, env) {
  await sendMessage(
    chatId,
    `راهنمای دوسلدورف خانه

/submit
ثبت آگهی جدید مسکن

/status
پیگیری آگهی‌های شما

/profile
مشاهده پروفایل

/cancel
لغو عملیات جاری

/start
شروع کار با ربات`,
    env
  );
}

async function showProfile(chatId, user, env) {
  const result = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS published
    FROM listings
    WHERE user_id = ?
  `)
    .bind(user.id)
    .first();

  const name =
    [user.first_name, user.last_name]
      .filter(Boolean)
      .join(" ") || "کاربر";

  await sendMessage(
    chatId,
    `پروفایل شما

نام: ${name}
نام کاربری: ${user.username ? "@" + user.username : "ثبت نشده"}

تعداد کل آگهی‌ها: ${result?.total || 0}
در انتظار بررسی: ${result?.pending || 0}
منتشرشده: ${result?.published || 0}`,
    env
  );
}

async function showStatus(chatId, user, env) {
  const rows = await env.DB.prepare(`
    SELECT
      id,
      listing_type,
      title,
      status,
      created_at
    FROM listings
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 10
  `)
    .bind(user.id)
    .all();

  if (!rows.results || rows.results.length === 0) {
    await sendMessage(
      chatId,
      "شما هنوز هیچ آگهی‌ای ثبت نکرده‌اید.\n\nبرای ثبت آگهی از /submit استفاده کنید.",
      env
    );
    return;
  }

  const statusNames = {
    draft: "پیش‌نویس",
    pending: "در انتظار بررسی",
    approved: "تأیید شده",
    published: "منتشر شده",
    rejected: "رد شده",
    archived: "بایگانی شده",
  };

  const typeNames = {
    rent: "اجاره",
    sale: "فروش",
    room: "اتاق",
  };

  const text = rows.results
    .map((item) => {
      return `آگهی شماره ${item.id}
نوع: ${typeNames[item.listing_type] || item.listing_type}
عنوان: ${item.title || "بدون عنوان"}
وضعیت: ${statusNames[item.status] || item.status}`;
    })
    .join("\n\n");

  await sendMessage(chatId, text, env);
}

async function startSubmit(chatId, user, env) {
  await setSession(env, user.id, "listing_type", {});

  await sendMessage(
    chatId,
    `ثبت آگهی جدید

نوع آگهی را انتخاب کنید:

1 - اجاره
2 - فروش
3 - اتاق

فقط عدد 1، 2 یا 3 را ارسال کنید.

برای لغو:
 /cancel`,
    env
  );
}

async function processSubmit(chatId, user, session, message, env) {
  let data = {};

  try {
    data = session.data ? JSON.parse(session.data) : {};
  } catch {
    data = {};
  }

  const text = (message.text || "").trim();

  switch (session.state) {
    case "listing_type": {
      const types = {
        "1": "rent",
        "2": "sale",
        "3": "room",
      };

      if (!types[text]) {
        await sendMessage(
          chatId,
          "لطفاً فقط عدد 1، 2 یا 3 را ارسال کنید.",
          env
        );
        return;
      }

      data.listing_type = types[text];

      await setSession(env, user.id, "title", data);

      await sendMessage(
        chatId,
        "عنوان آگهی را وارد کنید.\n\nمثال:\nآپارتمان دو اتاقه در دوسلدورف",
        env
      );
      return;
    }

    case "title": {
      if (text.length < 3) {
        await sendMessage(
          chatId,
          "عنوان خیلی کوتاه است. لطفاً یک عنوان کامل‌تر وارد کنید.",
          env
        );
        return;
      }

      data.title = text;

      await setSession(env, user.id, "description", data);

      await sendMessage(
        chatId,
        "توضیحات آگهی را وارد کنید.\n\nمثلاً محله، امکانات، شرایط و زمان تحویل.",
        env
      );
      return;
    }

    case "description": {
      if (text.length < 5) {
        await sendMessage(
          chatId,
          "لطفاً توضیحات کامل‌تری وارد کنید.",
          env
        );
        return;
      }

      data.description = text;

      await setSession(env, user.id, "price", data);

      await sendMessage(
        chatId,
        "مبلغ اجاره یا قیمت فروش را به یورو وارد کنید.\n\nمثال:\n1200\nیا\n1.200,50",
        env
      );
      return;
    }

    case "price": {
      const price = parseNumber(text);

      if (!Number.isFinite(price) || price < 0) {
        await sendMessage(
          chatId,
          "مبلغ واردشده صحیح نیست. لطفاً فقط مبلغ را به یورو وارد کنید.",
          env
        );
        return;
      }

      data.price = price;

      await setSession(env, user.id, "area", data);

      await sendMessage(
        chatId,
        "متراژ خانه یا اتاق را به مترمربع وارد کنید.\n\nمثال:\n55",
        env
      );
      return;
    }

    case "area": {
      const area = parseNumber(text);

      if (!Number.isFinite(area) || area <= 0) {
        await sendMessage(
          chatId,
          "متراژ واردشده صحیح نیست. لطفاً مثلاً 55 وارد کنید.",
          env
        );
        return;
      }

      data.area_sqm = area;

      const priceField =
        data.listing_type === "sale"
          ? "price"
          : "cold_rent";

      await env.DB.prepare(`
        INSERT INTO listings
          (
            user_id,
            listing_type,
            property_type,
            title,
            description,
            city,
            area_sqm,
            ${priceField},
            status
          )
        VALUES (?, ?, ?, ?, ?, 'Düsseldorf', ?, ?, 'pending')
      `)
        .bind(
          user.id,
          data.listing_type,
          data.listing_type === "room" ? "room" : "apartment",
          data.title,
          data.description,
          data.area_sqm,
          data.price
        )
        .run();

      const listing = await env.DB.prepare(`
        SELECT id
        FROM listings
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 1
      `)
        .bind(user.id)
        .first();

      await clearSession(env, user.id);

      await sendMessage(
        chatId,
        `آگهی شما با موفقیت ثبت شد.

شماره آگهی: ${listing.id}

وضعیت فعلی:
در انتظار بررسی

برای پیگیری وضعیت آگهی:
 /status`,
        env
      );

      return;
    }

    default:
      await clearSession(env);
      await sendMessage(
        chatId,
        "عملیات قبلی پیدا نشد. برای ثبت آگهی جدید از /submit استفاده کنید.",
        env
      );
  }
}

async function handleMessage(message, env) {
  if (!message || !message.chat || !message.from) {
    return;
  }

  const chatId = message.chat.id;
  const user = await getUser(env, message.from);
  const text = (message.text || "").trim();

  if (text === "/start") {
    await clearSession(env, user.id);
    await showStart(chatId, env);
    return;
  }

  if (text === "/help") {
    await showHelp(chatId, env);
    return;
  }

  if (text === "/cancel") {
    await clearSession(env, user.id);
    await sendMessage(
      chatId,
      "عملیات لغو شد.",
      env
    );
    return;
  }

  if (text === "/profile") {
    await showProfile(chatId, user, env);
    return;
  }

  if (text === "/status") {
    await showStatus(chatId, user, env);
    return;
  }

  if (text === "/submit") {
    await startSubmit(chatId, user, env);
    return;
  }

  const session = await getSession(env, user.id);

  if (session) {
    await processSubmit(chatId, user, session, message, env);
    return;
  }

  await sendMessage(
    chatId,
    "دستور شما شناخته نشد.

برای مشاهده راهنما:
 /help

برای ثبت آگهی:
 /submit",
    env
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET") {
      return new Response("duessAdminBot is running");
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
      });
    }

    if (url.pathname !== "/telegram/webhook") {
      return new Response("Not Found", {
        status: 404,
      });
    }

    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const receivedSecret = request.headers.get(
        "X-Telegram-Bot-Api-Secret-Token"
      );

      if (receivedSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("Unauthorized", {
          status: 401,
        });
      }
    }

    try {
      const update = await request.json();

      if (update.message) {
        await handleMessage(update.message, env);
      }

      return new Response("OK");
    } catch (error) {
      console.error(error);

      return new Response("Internal Server Error", {
        status: 500,
      });
    }
  },
};
