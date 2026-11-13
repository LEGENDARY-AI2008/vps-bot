import { q } from "../lib/db.js";
import { send, sendToAdmins, tg, isAdmin, ADMIN_IDS } from "../lib/telegram.js";
import { createVps, fetchIp } from "../lib/aws.js";

const NAIRA_PER_CREDIT = 100;
const VPS_DAYS = 10;
const BANK = {
  name: process.env.BANK_NAME || "MoMo",
  account: process.env.BANK_ACCOUNT || "(set BANK_ACCOUNT)",
  holder: process.env.BANK_HOLDER || "(set BANK_HOLDER)",
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (req.headers["x-telegram-bot-api-secret-token"] !== process.env.WEBHOOK_SECRET) {
    return res.status(401).end();
  }
  const update = req.body;
  try {
    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (err) {
    console.error("webhook error", err);
  }
  res.status(200).json({ ok: true }); // always 200 so Telegram does not retry forever
}

async function getUser(from, referrerId = null) {
  const r = await q(
    `INSERT INTO users (id, username, referrer_id) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username
     RETURNING *, (xmax = 0) AS is_new`,
    [from.id, from.username ?? null, referrerId]
  );
  return r.rows[0];
}

async function onMessage(msg) {
  const chat = msg.chat.id;
  const text = (msg.text || "").trim();

  // /start ref_<id>: new user gets 1 credit for the referrer
  if (text.startsWith("/start")) {
    const arg = text.split(" ")[1] || "";
    const refId = arg.startsWith("ref_") ? Number(arg.slice(4)) : null;
    const existing = await q("SELECT id FROM users WHERE id = $1", [msg.from.id]);
    const user = await getUser(msg.from, existing.rowCount === 0 && refId !== msg.from.id ? refId : null);
    if (user.is_new && user.referrer_id) {
      await q("UPDATE users SET credits = credits + 1 WHERE id = $1", [user.referrer_id]);
      await send(user.referrer_id, "🎉 Someone joined with your link. You got 1 credit.");
    }
    return send(chat, menuText(), { reply_markup: menuKeyboard() });
  }

  const user = await getUser(msg.from);

  // A photo while a top-up order is waiting for proof
  if (msg.photo) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const dup = await q("SELECT id FROM orders WHERE screenshot_file_id = $1", [fileId]);
    if (dup.rowCount) return send(chat, "This screenshot was already sent. Send a new one.");
    const o = await q(
      `UPDATE orders SET status = 'pending', screenshot_file_id = $2
       WHERE id = (SELECT id FROM orders WHERE user_id = $1 AND status = 'awaiting_proof'
                   ORDER BY created_at DESC LIMIT 1)
       RETURNING *`,
      [user.id, fileId]
    );
    if (!o.rowCount) return send(chat, "No top-up is waiting for a screenshot. Tap 💳 Buy credits first.");
    const order = o.rows[0];
    await Promise.all(
      ADMIN_IDS.map((id) => tg("sendPhoto", { chat_id: id, photo: fileId }))
    );
    await sendToAdmins(
      `💳 Top-up #${order.id}\nUser: @${msg.from.username || msg.from.id} (${msg.from.id})\n` +
        `Credits: ${order.credits} (₦${order.naira})`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ Approve", callback_data: `approve:${order.id}` },
            { text: "❌ Reject", callback_data: `reject:${order.id}` },
          ]],
        },
      }
    );
    return send(chat, "Screenshot received. Admins will confirm shortly.");
  }

  if (text === "/balance" || text === "💰 Balance") {
    return send(chat, `Your credits: <b>${user.credits}</b>`);
  }

  if (text === "/topup" || text === "💳 Buy credits") {
    return send(chat, "How many credits? Send a number. 1 credit = ₦100. Example: <code>10</code>");
  }

  // Number after /topup prompt: create the order
  if (/^\d+$/.test(text)) {
    const credits = Number(text);
    if (credits < 1) return send(chat, "Minimum is 1 credit.");
    const naira = credits * NAIRA_PER_CREDIT;
    await q(
      "INSERT INTO orders (user_id, kind, credits, naira) VALUES ($1, 'topup', $2, $3)",
      [user.id, credits, naira]
    );
    return send(
      chat,
      `Pay <b>₦${naira}</b> to:\n\nBank: ${BANK.name}\nAccount: <code>${BANK.account}</code>\nName: ${BANK.holder}\n\nThen send the screenshot here.`
    );
  }

  if (text === "/plans" || text === "🖥 Buy VPS") {
    const plans = await q("SELECT * FROM plans ORDER BY credits");
    const lines = plans.rows.map((p) => `• <b>${p.name}</b>: ${p.credits} credits / ${VPS_DAYS} days`);
    return send(chat, `${lines.join("\n")}\n\nTo buy, send <code>/buy ${plans.rows[0].code}</code>`);
  }

  if (text.startsWith("/buy ")) {
    return buyVps(user, chat, text.split(" ")[1]);
  }

  if (text === "/myvps" || text === "📦 My VPS") {
    const r = await q(
      "SELECT * FROM vps WHERE user_id = $1 AND status IN ('creating','running','expiring') ORDER BY id",
      [user.id]
    );
    if (!r.rowCount) return send(chat, "You have no active VPS.");
    const lines = r.rows.map(
      (v) => `#${v.id} | ${v.status} | IP: ${v.ip || "pending"} | expires ${v.expires_at.toDateString()}`
    );
    return send(chat, lines.join("\n"));
  }

  if (text === "/referrals" || text === "👥 Referrals") {
    const link = `https://t.me/${process.env.BOT_USERNAME}?start=ref_${user.id}`;
    const n = await q("SELECT COUNT(*)::int AS n FROM users WHERE referrer_id = $1", [user.id]);
    return send(chat, `Your link:\n${link}\n\nReferred: ${n.rows[0].n}. You get 1 credit per person who joins.`);
  }

  if (text.startsWith("/sos")) {
    const msgText = text.slice(4).trim();
    if (!msgText) return send(chat, "Send: <code>/sos your problem</code>");
    const t = await q("INSERT INTO tickets (user_id, message) VALUES ($1, $2) RETURNING id", [user.id, msgText]);
    await sendToAdmins(`🆘 Ticket #${t.rows[0].id} from ${msg.from.id}:\n${msgText}\n\nReply: /reply ${t.rows[0].id} your message`);
    return send(chat, `Ticket #${t.rows[0].id} sent. We will reply here.`);
  }

  if (text.startsWith("/reply ") && isAdmin(msg.from.id)) {
    const [, id, ...rest] = text.split(" ");
    const t = await q("UPDATE tickets SET status = 'closed' WHERE id = $1 RETURNING user_id", [id]);
    if (!t.rowCount) return send(chat, "Ticket not found.");
    await send(t.rows[0].user_id, `Support reply:\n${rest.join(" ")}`);
    return send(chat, "Sent.");
  }

  if (text === "/start" || text === "/help") {
    return send(chat, menuText(), { reply_markup: menuKeyboard() });
  }
}

async function onCallback(cb) {
  const [action, id] = cb.data.split(":");
  if (!isAdmin(cb.from.id)) {
    return tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Not allowed" });
  }
  const status = action === "approve" ? "approved" : "rejected";
  const o = await q(
    "UPDATE orders SET status = $2 WHERE id = $1 AND status = 'pending' RETURNING *",
    [id, status]
  );
  await tg("answerCallbackQuery", { callback_query_id: cb.id, text: o.rowCount ? status : "Already handled" });
  if (!o.rowCount) return;
  const order = o.rows[0];
  if (status === "approved") {
    await q("UPDATE users SET credits = credits + $2 WHERE id = $1", [order.user_id, order.credits]);
    await send(order.user_id, `✅ Top-up approved. ${order.credits} credits added.`);
  } else {
    await send(order.user_id, "❌ Top-up rejected. Contact support with /sos if this is wrong.");
  }
  await tg("editMessageReplyMarkup", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
}

async function buyVps(user, chat, planCode) {
  const p = await q("SELECT * FROM plans WHERE code = $1", [planCode]);
  if (!p.rowCount) return send(chat, "Unknown plan.");
  const plan = p.rows[0];

  // Atomic: deduct only if enough credits, so two taps can't double spend
  const d = await q(
    "UPDATE users SET credits = credits - $2 WHERE id = $1 AND credits >= $2 RETURNING credits",
    [user.id, plan.credits]
  );
  if (!d.rowCount) return send(chat, `Not enough credits. You need ${plan.credits}. Buy more with /topup.`);

  const v = await q(
    `INSERT INTO vps (user_id, plan_code, expires_at)
     VALUES ($1, $2, now() + ($3 || ' days')::interval) RETURNING *`,
    [user.id, plan.code, String(VPS_DAYS)]
  );
  const vps = v.rows[0];

  try {
    const created = await createVps(plan.instance_type, `vps-${vps.id}`);
    await q(
      "UPDATE vps SET aws_instance_id = $2, username = $3, password = $4 WHERE id = $1",
      [vps.id, created.instanceId, created.username, created.password]
    );
    await send(chat, `✅ VPS #${vps.id} is being created. You will get the IP and login shortly.`);
    await sendToAdmins(
      `📋 Backup VPS #${vps.id}\nUser: ${user.id}\nPlan: ${plan.name}\nInstance: ${created.instanceId}\n` +
        `User: ${created.username}\nPassword: <code>${created.password}</code>\nExpires: ${vps.expires_at.toDateString()}`
    );
  } catch (err) {
    console.error("createVps failed", err);
    // Refund the credits so the user is not charged for a failed VPS
    await q("UPDATE users SET credits = credits + $2 WHERE id = $1", [user.id, plan.credits]);
    await q("UPDATE vps SET status = 'deleted' WHERE id = $1", [vps.id]);
    await send(chat, "Something went wrong creating your VPS. Your credits were refunded.");
  }
}

function menuText() {
  return "Welcome to Legendary VPS.\n\n💰 Balance · 💳 Buy credits · 🖥 Buy VPS · 📦 My VPS · 👥 Referrals · 🆘 Support (/sos)";
}

function menuKeyboard() {
  return {
    keyboard: [
      [{ text: "💰 Balance" }, { text: "💳 Buy credits" }],
      [{ text: "🖥 Buy VPS" }, { text: "📦 My VPS" }],
      [{ text: "👥 Referrals" }],
    ],
    resize_keyboard: true,
  };
}
