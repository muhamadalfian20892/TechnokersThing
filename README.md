# Technokers AI Bot Pro (`TechnokersThing`)

> 🌐 **Language / Bahasa:**  
> **English** | 🇮🇩 [Baca Dokumentasi Bahasa Indonesia di sini (README_ID.md)](README_ID.md)

An open-source, enterprise-grade multimodal Telegram AI Assistant and automated Tech News Publisher built completely on **Cloudflare Workers**, **Workers AI**, **Cloudflare KV**, and **Telegram Bot API**, with a **WCAG 2.1 AAA** accessible administration dashboard.

Created and maintained with ❤️ by **[Muhamad Alfian](https://github.com/muhamadalfian20892)** ([@alfian04121](https://t.me/alfian04121)).

---

## 👨‍💻 Meet the Creator & Project Story

Hi there! I'm **Muhamad Alfian** ([@alfian04121](https://t.me/alfian04121) on Telegram, [`muhamadalfian20892`](https://github.com/muhamadalfian20892) on GitHub).

This project started with a simple, personal itch: I run the Indonesian tech community channel **[@aicomindo](https://t.me/aicomindo)** (*AI Community News Indonesia*). Every evening at 18:00 WIB, I wanted our community to receive a thoughtfully curated, deeply engaging summary of the biggest breakthroughs in artificial intelligence, semiconductor tech, and open-source models—without requiring a heavy 24/7 server running on AWS or a VPS.

Cloudflare Workers was the natural answer: zero idle server costs, sub-millisecond cold starts across 330+ edge locations worldwide, and direct access to Cloudflare Workers AI with Llama 3.3 and DeepSeek R1 models right inside the worker pipeline.

Over time, this bot grew far beyond a simple daily broadcaster:
1. **Interactive Multimodal Assistant**: Community members wanted to chat with it, ask coding questions, brainstorm tech concepts, and even send **voice notes** from Telegram on their commute.
2. **True Persona Intelligence**: I noticed early AI bots felt like stiff, corporate customer service reps. I redesigned this bot with two crisp personalities—a friendly, conversational **CHAT MODE** that talks like a real person, and a structured, jargon-free **NEWS MODE** that tells fascinating stories about technology.
3. **Open-Source For Everyone**: I didn't want any developer or admin identities hardcoded in the codebase. Now anyone can clone this repository, drop their own Telegram ID and channel into [`bot.config.json`](bot.config.json), and deploy their own customized AI bot in minutes.

---

## 📜 Developer Changelog & Update Log

Here are the latest developer logs and improvements made to the project:

### New on 10/04/2026:
* Though it took quite a bit of tracking down, the annoying bug where the bot kept saying *"Halo Muhamad"* at the beginning of literally every single reply—even five turns deep into a conversation—has been completely eradicated. The bot now understands conversational continuity and greets you like a real friend rather than a robotic receptionist resetting on every query.
* Implemented the **Context-Aware Persona Engine** (`buildContextAwareSystemPersona`). The bot now inspects who is sending the message: if it recognizes the creator/admin (matching `ADMIN_USER_ID` or `ADMIN_USERNAME`), it acts as a trusted, savvy developer partner ready to debug or execute operations. If talking to community members, it stays warm and informative while strictly protecting internal system secrets.
* Decoupled all admin and identity variables into [`bot.config.json`](bot.config.json) and exported [`getAppConfig`](src/config.ts). No more hardcoded user IDs, admin usernames, or channel names across the codebase—you can fork this project and easily customize your own bot.
* Discovered a subtle crash in `callBackupOpenAi` where calling `.replace()` on an undefined backup URL would throw a `TypeError`. We added defensive checks so missing backup credentials fail gracefully with descriptive error logs instead of terminating the worker.
* Added verification for Telegram's `X-Telegram-Bot-Api-Secret-Token` header on `/telegram/webhook`. If anyone tries to spoof webhook updates or probe your endpoints without the configured secret, they are immediately stopped with a `403 Forbidden`.
* Hardened `/addnews` against SSRF (Server-Side Request Forgery). Attempting to submit loopback, private RFC-1918 IPs, or AWS metadata endpoints (`127.0.0.1`, `localhost`, `169.254.169.254`) is now strictly rejected.
* Moved `/api/trigger-news`, `/api/preview-news`, and `/telegram/set-webhook` behind the authenticated dashboard session guard. Unauthenticated visitors now receive `401 Unauthorized` instead of being able to drain your AI quotas.
* Added `sanitizeSecretLeaks` to inspect outgoing LLM responses and redact any accidental leaks of `TELEGRAM_TOKEN`, `BACKUP_AI_KEY`, or webhook secrets into `[REDACTED_SECRET]`.

### New on 10/03/2026:
* Group chats are no longer a chaotic mess! Previously, if the bot was added to a group with privacy mode disabled, it would try to answer every random message between members. It now politely ignores passive banter and only responds when explicitly mentioned (`@bot_username`), replied to, or sent a command.
* Mention tokens like `@bot_username` are now automatically stripped from commands (e.g. `/news@my_bot` -> `/news`) and conversational queries, so the underlying LLM receives clean, human prompts.
* Voice notes and audio messages (`.ogg`, `.opus`, `.mp3`) sent in Telegram are now automatically transcribed using Cloudflare Workers AI Whisper (`@cf/openai/whisper` & `@cf/openai/whisper-large-v3-turbo`) with a dual-engine fallback system.
* Audio files exceeding 20 MB (Telegram Bot API download limit) are now cleanly rejected with a helpful message instead of failing halfway through download.
* Transcriptions are displayed in the Telegram reply as an accessible quote block (`"..."`) so screen readers and users can verify what the model heard before reading the AI's reply.

### New on 10/02/2026:
* Built the **Universal Connectors** engine. The bot can now syndicate daily tech digests directly to Google Blogger blogs or dispatch webhooks to custom external APIs.
* Added natural language intent extraction for connectors—admins can literally say *"sambungin ke blogger"* in chat to be guided through the setup.
* Implemented single-use **6-digit OTP authentication** for the Web Dashboard. Admins can generate a code in Telegram using `/dashboard_code`, valid for 5 minutes.
* Added brute-force lockout: after 3 failed OTP attempts, the client IP is banned from login attempts for 15 minutes and the code is immediately invalidated.

### New on 10/01/2026:
* Re-engineered the Web Dashboard to comply strictly with **WCAG 2.1 Level AAA** accessibility standards.
* Raised text contrast ratios up to **17.9:1** (`#ffffff` on `#080d1a`), far exceeding the AAA 7:1 minimum requirement.
* Added prominent `3px` visible focus outlines for full keyboard navigability, explicit ARIA landmark roles (`role="main"`, `aria-live="polite"`), and `<a class="skip-link">` buttons.
* Ensured every clickable button and interactive input meets the minimum touch target size of 44x44px.

### New on 09/28/2026:
* Integrated the **Autonomous Scheduler & Reminder System**. Users can say natural phrases like *"ingetin aku 15 menit lagi angkat jemuran"* or *"ingetin meeting besok jam 09:00"*, and the AI will extract the time, calculate WIB offsets, and schedule a reminder.
* Supported recurring cron jobs via `/cron 0 9 * * * Minum air pagi` as well as conversational crons (*"tiap hari jam 8 pagi cek server"*).
* Added target routing: reminders can be delivered right back to the Telegram chat, sent to the official channel (admin only), or pushed as web notifications on the dashboard.

### New on 09/25/2026:
* Initial launch of the serverless daily news synthesizer on Cloudflare Workers edge.
* Integrated Cron Triggers (`0 11 * * *` UTC / 18:00 WIB) with deduplication locks in Cloudflare KV to ensure only one comprehensive digest is posted per day.
* Set up dual AI providers: primary on Cloudflare Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) with seamless failover to an OpenAI-compatible backup provider if daily neuron limits are reached.

---

## 🌟 Key Features

| Feature | Description |
|---|---|
| 🎙️ **Voice Notes & Audio STT** | Send voice messages in Telegram or record directly in the web dashboard. Automatically transcribed by Whisper with accessible confirmation quotes. |
| 🧠 **Context-Aware Persona** | Detects creator/developer vs community member. Responds casually and technically to the admin, and helpfully to users while protecting system tokens. |
| 💬 **Natural CHAT vs NEWS Modes** | CHAT MODE speaks naturally like a human without customer-service cliches. NEWS MODE crafts catchy, jargon-free stories with *"Mengapa ini menarik?"* context. |
| 🛡️ **Enterprise Security** | Webhook secret token validation, SSRF URL filters, prompt-injection token sanitization, and 3-attempt OTP lockout. |
| 👥 **Smart Group Chat Filtering** | Ignores passive chatter between group members. Only responds when mentioned (`@bot`), replied to, or given commands. |
| ⏰ **Autonomous Reminders & Crons** | Natural language reminder scheduling (*"ingetin aku 20 menit lagi"*), cron job parsing, and multi-platform delivery (Telegram, Channel, Web). |
| ♿ **WCAG 2.1 AAA Web Dashboard** | Complete management console with 17.9:1 contrast ratio, keyboard navigation, skip links, and touch-friendly controls. |
| 🔌 **Universal Connectors** | Syndicates daily digests to Google Blogger blogs and external webhook endpoints. |
| ⚙️ **Open Source & Configurable** | All admin credentials, limits, and bot names live in [`bot.config.json`](bot.config.json) or worker environment variables. |

---

## ⚙️ Configuration & Customization (`bot.config.json`)

The bot is designed to be completely open-source and customizable. All parameters are centralized in [`bot.config.json`](bot.config.json):

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
You can override any setting using Cloudflare Worker variables in `wrangler.jsonc` or `.dev.vars`:
- `ADMIN_USER_ID`: Numeric Telegram user ID of the admin.
- `ADMIN_USERNAME`: Telegram username (with or without `@`).
- `ADMIN_NAME`: Display name of the admin.
- `BOT_NAME`: Name of your bot.
- `BOT_USERNAME`: Username of the bot.
- `CHANNEL_ID`: Channel ID (e.g., `@mychannel`).
- `DEFAULT_DAILY_LIMIT`: Maximum chats per non-admin user per day (`0` for unlimited).
- `TELEGRAM_WEBHOOK_SECRET`: Secret token for `X-Telegram-Bot-Api-Secret-Token` validation.

---

## 📱 Bot Commands Reference

### Public Commands (All Users)
- `/start`: Welcome message with community links and active quota information.
- `/help`: Guide on how to ask questions, read news, and set reminders.
- `/news`: Instantly generates and delivers the latest AI news digest.
- `/reset` or `/clearchat`: Clears your isolated chat memory for a fresh conversation.
- `/remind <time> <message>`: Creates a one-time reminder (e.g. `/remind 15m Minum air`).
- `/myreminders`: Displays your active scheduled reminders.
- `/delremind <id>`: Cancels an active reminder.

### Admin-Only Commands
- `/dashboard_code`: Generates a single-use 6-digit OTP to log into the Web Dashboard (valid 5 min).
- `/connectors`: Checks status of Blogger, Gmail, and Webhook syndication.
- `/models`: Lists available Cloudflare Workers AI and backup OpenAI models.
- `/setmodel <id>`: Changes the active model on the fly.
- `/usage`: Displays token metrics, HTTP requests, and daily Cloudflare Neurons quota.
- `/setlimit <n>`: Updates daily chat limits for regular users (`0` = unlimited).
- `/getlimit`: Inspects the current daily user limit.
- `/preview`: Generates a live draft of today's news digest without publishing.
- `/post_now`: Manually broadcasts the daily digest to the channel immediately.
- `/stop_posting` & `/resume_posting`: Pauses or resumes the automatic 18:00 WIB cron publisher.
- `/unlock_today`: Unlocks the one-post-per-day restriction.
- `/search <query>`: Searches KV archives for previously posted news.
- `/addnews <title> | <url> | <snippet>`: Manually injects breaking news into the next digest.
- `/logs`: Displays system audit logs.

---

## 🚀 Quickstart & Deployment

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or newer).
- [Cloudflare Account](https://dash.cloudflare.com/) with Workers & KV enabled.
- Telegram Bot Token from [@BotFather](https://t.me/BotFather).

### 2. Clone & Install
```bash
git clone https://github.com/muhamadalfian20892/TechnokersThing.git
cd TechnokersThing
npm install
```

### 3. Configure Secrets
Create a `.dev.vars` file for local development:
```env
TELEGRAM_TOKEN=your_telegram_bot_token
CHANNEL_ID=@your_channel_username
BACKUP_AI_URL=https://api.openai.com/v1
BACKUP_AI_KEY=your_backup_api_key
TELEGRAM_WEBHOOK_SECRET=your_optional_webhook_secret
```

### 4. Local Development
```bash
npm run dev
# or
npx wrangler dev
```

### 5. Typecheck & Automated Simulations
```bash
# Verify TypeScript types
npx tsc --noEmit

# Run comprehensive 6-suite simulation test
npx tsx scratch/simulate_all_personas.mjs
```

### 6. Deploy to Cloudflare Workers
```bash
npm run deploy
# or
npx wrangler deploy
```

Once deployed, set your Telegram webhook by visiting:
```
https://<your-worker>.workers.dev/telegram/set-webhook
```
*(Requires being logged into the dashboard or using your admin credentials).*

---

## ♿ Accessibility (WCAG 2.1 AAA)

Technokers AI Bot Pro was built with accessibility as a first-class citizen:
- **Enhanced Contrast**: Background `#080d1a`, text `#ffffff` yields a contrast ratio of **17.9:1** (far above the AAA requirement of 7:1).
- **Visible Focus**: Keyboard focus rings use high-contrast blue (`3px solid #60a5fa`) with `3px` offset.
- **Skip Links**: Accessible keyboard users can jump straight to main content with the skip link banner.
- **Screen Reader Support**: Audio messages automatically transcribe and print text transcripts directly in Telegram and dashboard logs so speech content is always readable.

---

## 📄 License

This project is licensed under the **MIT License**. Feel free to use, modify, and distribute it for personal or community projects.

If you enjoy this project or use it in your community, give it a ⭐️ on [GitHub](https://github.com/muhamadalfian20892/TechnokersThing) and join our community at **[@aicomindo](https://t.me/aicomindo)**!