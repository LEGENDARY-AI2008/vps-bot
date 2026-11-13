import { q } from "../lib/db.js";
import { send, sendToAdmins } from "../lib/telegram.js";
import { fetchIp, stopVps } from "../lib/aws.js";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  // 1. Fill in IPs for VPS that were just created
  const creating = await q(
    "SELECT * FROM vps WHERE status = 'creating' AND aws_instance_id IS NOT NULL"
  );
  for (const v of creating.rows) {
    const ip = await fetchIp(v.aws_instance_id);
    if (!ip) continue;
    await q("UPDATE vps SET ip = $2, status = 'running' WHERE id = $1", [v.id, ip]);
    await send(v.user_id, `🟢 VPS #${v.id} is ready.\nIP: <code>${ip}</code>\nUser: root\nPassword: <code>${v.password}</code>`);
  }

  // 2. Reminder 3 days before expiry
  const soon = await q(
    `SELECT * FROM vps WHERE status = 'running' AND reminded = false
       AND expires_at <= now() + interval '3 days' AND expires_at > now()`
  );
  for (const v of soon.rows) {
    await q("UPDATE vps SET reminded = true, status = 'expiring' WHERE id = $1", [v.id]);
    await send(v.user_id, `⏰ VPS #${v.id} expires on ${v.expires_at.toDateString()}. Renew it with /buy ${v.plan_code} before then.`);
  }

  // 3. Expired: stop the instance and tell the user
  const expired = await q(
    "SELECT * FROM vps WHERE status IN ('running','expiring') AND expires_at <= now()"
  );
  for (const v of expired.rows) {
    if (v.aws_instance_id) await stopVps(v.aws_instance_id);
    await q("UPDATE vps SET status = 'expired' WHERE id = $1", [v.id]);
    await send(v.user_id, `VPS #${v.id} has expired and was stopped. Renew with /buy ${v.plan_code}.`);
    await sendToAdmins(`VPS #${v.id} (user ${v.user_id}) expired and was stopped.`);
  }

  res.status(200).json({ creating: creating.rowCount, reminded: soon.rowCount, expired: expired.rowCount });
}
