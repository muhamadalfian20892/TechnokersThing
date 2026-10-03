# Technokers AI Bot Pro (TechnokersThing)

[Indonesian Version (README_ID.md)](README_ID.md)

Hey, I'm Alfian ([@alfian04121](https://t.me/alfian04121) on Telegram, [GitHub](https://github.com/muhamadalfian20892)).

I built this project because I run an Indonesian tech community channel called AI Community News Indonesia (@aicomindo). Every evening at around 18:00 WIB, I wanted our community to get a solid, curated recap of the day's artificial intelligence and tech news without having to pay for a 24/7 VPS that sits idle most of the day. Cloudflare Workers was the natural fit: it runs on the edge, cold-starts in milliseconds, and has built-in access to Workers AI with models like Llama 3.3 and Whisper.

Over time, the bot evolved quite a bit. People wanted to chat with it directly, ask coding questions, and send voice messages from their phones on the go. I also got tired of AI bots that sound like stiff customer service reps reciting canned disclaimers, so I gave this bot two distinct personalities: a conversational chat mode that talks like a real person, and a news mode that explains complex tech simply and highlights why it matters.

Since this project is open source, none of my personal details or admin IDs are hardcoded anymore. Everything lives in `bot.config.json`, so you can fork this repository, adjust the config for your own community or personal assistant, and deploy it to Cloudflare in a few minutes.

---

## Update Log

New on 10/04/2026:
	Though it took quite a bit of tracking down, the annoying bug where the bot kept saying "Halo Muhamad" at the beginning of literally every single reply has been completely resolved. The bot now understands conversational flow and talks like a normal human being rather than greeting you repeatedly on every message.
	Added the context-aware persona engine. The bot now inspects who is sending the message: if it recognizes the developer/admin, it acts like a knowledgeable, personal dev assistant ready to debug or run tasks. If it is talking to a regular user, it stays helpful and approachable while keeping internal tokens and admin functions strictly protected.
	Extracted all admin identities, usernames, bot names, and channel targets out of the codebase and into bot.config.json. You can also override any of them through Cloudflare environment variables, so nothing is hardcoded anymore.
	Fixed a crash where callBackupOpenAi threw a TypeError trying to call .replace() on an undefined backup URL if credentials were not set. It now validates credentials cleanly and fails gracefully.
	Added validation for Telegram's X-Telegram-Bot-Api-Secret-Token header on the webhook endpoint. Unauthorized requests pretending to be Telegram now get a 403 Forbidden right away.
	Protected /addnews against SSRF attacks. Attempting to pass internal or loopback addresses like 127.0.0.1, localhost, or 169.254.169.254 is now rejected.
	Moved /api/trigger-news, /api/preview-news, and /telegram/set-webhook behind the dashboard session authentication so unauthenticated visitors cannot trigger posts or drain your AI tokens.
	Added secret leak sanitization to scrub TELEGRAM_TOKEN, BACKUP_AI_KEY, or webhook secrets from outgoing AI responses in case of prompt injection attempts.

New on 10/03/2026:
	Group chats are no longer chaotic. If the bot is added to a group with privacy mode turned off, it used to try to answer every random message between members. It now stays quiet unless someone mentions its username, replies directly to it, or runs a command.
	Bot username mentions are now stripped from commands and conversational queries, so the underlying model receives clean prompts without trailing bot tags.
	Added voice note support. Audio messages sent in Telegram are downloaded and transcribed using Cloudflare Workers AI Whisper with a dual-engine fallback.
	Audio files larger than 20 MB are now caught early and rejected with a helpful message instead of timing out during download.
	Voice message replies quote the recognized transcript text first so users and screen readers can verify what the model heard before reading the response.

New on 10/02/2026:
	Added universal connectors to syndicate daily news digests to Google Blogger blogs and custom external webhooks.
	Added natural language intent detection for connectors, so admins can simply type "sambungin ke blogger" in chat to configure things.
	Implemented 6-digit OTP login for the web dashboard. Admins can generate a code in Telegram using /dashboard_code that expires in 5 minutes and works once.
	Added brute-force lockout: three failed OTP attempts lock out the client IP for 15 minutes and immediately burn the code.

New on 10/01/2026:
	Overhauled the web dashboard to meet WCAG 2.1 Level AAA accessibility guidelines.
	Adjusted the color palette so text contrast sits at 17.9:1, well above the 7:1 AAA requirement.
	Added thick 3px visible focus rings for keyboard users, semantic landmark roles, skip links, and ensured all clickable controls meet the 44x44px minimum touch target size.

New on 09/28/2026:
	Added an autonomous reminder and cron scheduler. You can say things like "ingetin aku 15 menit lagi angkat jemuran" or "ingetin meeting besok jam 9 pagi", and the bot figures out the timestamp and saves it to KV.
	Supported recurring cron jobs via /cron 0 9 * * * Minum air or conversational prompts like "tiap hari jam 8 pagi cek server".
	Supported routing reminders to private chats, the official channel, or dashboard notifications.

New on 09/25/2026:
	Initial release of the daily news synthesizer running on Cloudflare Workers edge.
	Set up cron triggers at 11:00 UTC (18:00 WIB) with KV locks to prevent duplicate postings.
	Configured Workers AI with Llama 3.3 as the primary model and an OpenAI-compatible endpoint as an automatic fallback if daily limits are reached.

---

## Features

- Voice Messages and Audio Transcription: Accepts voice notes (.ogg, .opus, .mp3) on Telegram or recorded in the dashboard. Audio is transcribed via Whisper, and the text transcript is quoted in the reply for transparency.
- Context-Aware Persona Detection: Automatically recognizes whether it is chatting with the admin or a community member. Responds informally and technically to the admin, and warmly to regular members while protecting system secrets.
- Natural Chat and News Modes: Chat mode uses normal, conversational Indonesian without robotic greetings or stiff corporate phrases. News mode structures summaries cleanly with an explanation of why the development matters and relevant hashtags.
- Group Chat Filtering: Ignores passive chatter between group members. Only responds when explicitly tagged, replied to, or given a slash command.
- Security Hardening: Validates Telegram webhook secret tokens, blocks SSRF attempts on internal IP ranges, sanitizes AI responses against token leaks, and enforces OTP brute-force lockouts.
- Reminders and Cron Jobs: Understands natural Indonesian time expressions to schedule reminders, supports standard 5-field cron patterns, and delivers notifications on time.
- WCAG 2.1 AAA Accessible Dashboard: Management dashboard built with a high-contrast dark palette (17.9:1 ratio), visible focus outlines, skip links, and full keyboard accessibility.
- Universal Connectors: Automatically syndicates daily digests to Google Blogger blogs or external webhooks.
- Clean Open-Source Configuration: All identities, channel handles, and limits are managed in `bot.config.json` or worker environment variables.

---

## Configuration (bot.config.json)

All bot identities and limits are stored in `bot.config.json` at the root of the project:

```json
{
  "admin": {
    "userId": "1023972475",
    "username": "alfian04121",
    "name": "Muhamad Alfian",
    "roleTitle": "Lead Developer & System Architect"
  },
  "bot": {
    "name": "Technokers AI Bot Pro",
    "username": "tckn_bot",
    "channelId": "@aicomindo",
    "channelName": "AI Community News Indonesia"
  },
  "limits": {
    "defaultDailyUserChatLimit": 40,
    "rateLimitPerMinute": 25,
    "maxAudioSizeBytes": 20971520,
    "otpExpirationSeconds": 300,
    "otpMaxFailedAttempts": 3
  },
  "features": {
    "enableVoiceTranscriptions": true,
    "enableSchedulerTools": true,
    "enableConnectors": true
  }
}
```

### Environment Variable Overrides

If you prefer to configure the bot via Cloudflare Worker environment variables in `wrangler.jsonc` or `.dev.vars`, you can set:

- ADMIN_USER_ID: Your numeric Telegram user ID.
- ADMIN_USERNAME: Your Telegram username (without @).
- ADMIN_NAME: Your display name.
- BOT_NAME: The name of your bot.
- BOT_USERNAME: Your bot's Telegram handle.
- CHANNEL_ID: The target Telegram channel (e.g. @yourchannel).
- DEFAULT_DAILY_LIMIT: Daily chat quota per non-admin user (set to 0 for unlimited).
- TELEGRAM_WEBHOOK_SECRET: Secret token for webhook verification.

---

## Commands

### Public Commands

- /start: Welcome message with channel links and active quota information.
- /help: Instructions on asking questions, reading news, and setting reminders.
- /news: Generates and returns a fresh digest of the latest tech news.
- /reset or /clearchat: Clears your conversation history for a fresh topic.
- /remind <time> <message>: Sets a one-time reminder (e.g. /remind 15m Minum air).
- /myreminders: Lists your active scheduled reminders.
- /delremind <id>: Cancels a reminder.

### Admin Commands

- /dashboard_code: Generates a single-use 6-digit OTP to log into the web dashboard (valid for 5 minutes).
- /connectors: Checks the status of Blogger and webhook syndication.
- /models: Lists available Cloudflare and backup AI models.
- /setmodel <id>: Changes the active model on the fly.
- /usage: Displays token statistics, request counts, and estimated Cloudflare Neurons usage.
- /setlimit <n>: Updates the daily chat limit for non-admin users (0 to disable).
- /getlimit: Checks the current daily chat limit setting.
- /preview: Generates a draft of today's digest without posting it to the channel.
- /post_now: Immediately generates and posts today's digest to the channel.
- /stop_posting and /resume_posting: Pauses or resumes the daily 18:00 WIB cron publisher.
- /unlock_today: Unlocks the daily one-post restriction if you need to re-post.
- /search <query>: Searches previously posted news in KV storage.
- /addnews <title> | <url> | <snippet>: Manually injects a news item into the next digest.
- /logs: Shows recent audit logs.

---

## Setup and Deployment

### 1. Requirements

- Node.js (version 18 or newer).
- A Cloudflare account with Workers and KV enabled.
- A Telegram Bot token from @BotFather.

### 2. Installation

```bash
git clone https://github.com/muhamadalfian20892/TechnokersThing.git
cd TechnokersThing
npm install
```

### 3. Local Environment

Create a `.dev.vars` file in the project root:

```env
TELEGRAM_TOKEN=your_telegram_bot_token
CHANNEL_ID=@your_channel_username
BACKUP_AI_URL=https://api.openai.com/v1
BACKUP_AI_KEY=your_backup_api_key
TELEGRAM_WEBHOOK_SECRET=your_webhook_secret
```

### 4. Running Locally

```bash
npm run dev
# or
npx wrangler dev
```

### 5. Typecheck and Tests

```bash
# Check TypeScript types
npx tsc --noEmit

# Run the 6-suite simulation test
npx tsx scratch/simulate_all_personas.mjs
```

### 6. Deploying to Cloudflare

```bash
npm run deploy
# or
npx wrangler deploy
```

Once deployed, set up your webhook by opening:

```
https://<your-worker-subdomain>.workers.dev/telegram/set-webhook
```

---

## Accessibility (WCAG 2.1 AAA)

Accessibility was considered from the start:

- Enhanced Contrast: Text is pure white (#ffffff) on dark navy (#080d1a), giving a 17.9:1 contrast ratio that exceeds the AAA requirement of 7:1.
- Visible Focus: Keyboard focus outlines use a bold 3px solid #60a5fa outline with a 3px offset.
- Skip Links: Includes skip navigation links so keyboard users can jump past headers straight to main content.
- Screen Reader Transcripts: Voice notes automatically include the transcribed text in the Telegram message and dashboard log, ensuring all audio content is accessible as text.

---

## License

This project is released under the MIT License. You are free to use, modify, and distribute it as you like.