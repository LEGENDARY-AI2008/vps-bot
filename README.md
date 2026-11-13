# Legendary VPS Bot



Telegram bot for selling 10-day VPS with credits, manual top-up approval, backups to admins, and SOS support.

## Environment variables (set in Vercel → Settings → Environment Variables)

| Name | Value |
|---|---|
| BOT_TOKEN | Token from BotFather (after you revoke the old one) |
| BOT_USERNAME | Bot username without @ |
| WEBHOOK_SECRET | Any long random string |
| ADMIN_IDS | `8088239068,6006082096` |
| CRON_SECRET | Any long random string |
| DATABASE_URL | From Neon (Vercel Marketplace → Neon) |
| BANK_NAME | `MoMo` |
| BANK_ACCOUNT | Your MoMo number |
| BANK_HOLDER | `Akosua Serwaa` |
| AWS_ACCESS_KEY_ID | IAM user key (EC2 only) |
| AWS_SECRET_ACCESS_KEY | IAM user secret |
| AWS_REGION | e.g. `eu-west-1` |
| AWS_AMI_ID | Ubuntu 22.04 AMI id for that region |

## Deploy with Termux

```bash
pkg update && pkg install nodejs git
npm i -g vercel
cd legendary-vps-bot
npm install
vercel login          # opens a link, approve it
vercel link           # pick or create the project
vercel --prod
```

Then set the env vars above in Vercel and redeploy with `vercel --prod`.

## Set the Telegram webhook (run once, after deploy)

Replace the three values and run it in Termux or a browser:

```
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<your-project>.vercel.app/api/webhook&secret_token=<WEBHOOK_SECRET>
```

## Notes before going live
- VPS passwords are stored in plain text in the database. Encrypt them before real customers use it.
- Renewal currently creates a new VPS row. It's fine for testing; we can make it extend the existing VPS later.
- The daily cron runs once a day on Hobby, so IP and reminders can take up to 24 hours. That's a Hobby limit.
- Test first with the 500MB plan and your own card or top-up of 1 credit.
