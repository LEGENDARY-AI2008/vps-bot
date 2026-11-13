const API = `https://api.telegram.org/bot${process.env.BOT_TOKEN}`;

export const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);

export const isAdmin = (id) => ADMIN_IDS.includes(Number(id));

export async function tg(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export const send = (chat_id, text, extra = {}) =>
  tg("sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });

export const sendToAdmins = (text, extra = {}) =>
  Promise.all(ADMIN_IDS.map((id) => send(id, text, extra)));
