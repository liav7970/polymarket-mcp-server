# WhatsApp ↔ Claude bridge

Text a WhatsApp number and get Claude's replies back. It's a small FastAPI
service in front of the Claude API, with [Kapso](https://kapso.ai) providing
the WhatsApp number.

```
You (WhatsApp) ──> Kapso ──webhook──> this service ──> Claude API
       ^                                    │
       └──────── Kapso send-text <──────────┘
```

- Remembers the last 20 exchanges for each sender (in memory, so a restart
  clears them). Send `/reset` to start over.
- Answers Kapso within its 10-second limit and works on the reply in the
  background, so slow answers don't trigger Kapso's retries. Retried
  deliveries are skipped by checking their `X-Idempotency-Key`.
- Rejects any request whose `X-Webhook-Signature` doesn't check out.
- Uses `claude-opus-5-5`. If a safety filter declines a message, the server
  retries on a fallback model (`fallbacks: "default"`).
- Splits long replies to fit WhatsApp's 4096-character limit.

This is a separate Claude from the one in the Claude app. It doesn't share
your chats or memory there.

## Setup

### 1. Get a WhatsApp number on Kapso

Create a Kapso project, then connect a number under **WhatsApp → Phone
numbers**. The [Kapso Sandbox](https://docs.kapso.ai/docs/how-to/whatsapp/use-sandbox-for-testing.md)
works for testing. Create a project API key under **Integrations → API keys**.

### 2. Run the service somewhere public

```bash
pip install -r whatsapp_bridge/requirements.txt
cp whatsapp_bridge/.env.example whatsapp_bridge/.env   # fill it in
set -a; . whatsapp_bridge/.env; set +a
uvicorn whatsapp_bridge.app:app --host 0.0.0.0 --port 8000
```

Run it from the repository root. Kapso has to be able to reach it over HTTPS.
For a quick test, a tunnel like `cloudflared tunnel --url http://localhost:8000`
or `ngrok http 8000` works. For something always on, use any host that runs
Python (Fly.io, Railway, Render, a small VM).

Set `ALLOWED_NUMBERS` to your own number. Otherwise anyone who messages the
bot spends your Anthropic credits.

### 3. Point Kapso's webhook at it

Pick a long random secret (`openssl rand -hex 32`) and put the same value in
`KAPSO_WEBHOOK_SECRET`. Then:

```bash
curl -X POST "https://api.kapso.ai/platform/v1/whatsapp/phone_numbers/$KAPSO_PHONE_NUMBER_ID/webhooks" \
  -H "X-API-Key: $KAPSO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "whatsapp_webhook": {
      "url": "https://YOUR-HOST/webhook",
      "events": ["whatsapp.message.received"],
      "secret_key": "'"$KAPSO_WEBHOOK_SECRET"'"
    }
  }'
```

### 4. Say hi

Message the Kapso number from WhatsApp. `GET /health` returns `{"status": "ok"}`
if the service is up.

## Things to know

- **The 24-hour window doesn't get in the way.** WhatsApp only allows free-form
  replies within 24 hours of the user's last message. Because you always text
  first, every reply falls inside that window.
- **Costs.** Each message is a Claude API call billed to your Anthropic
  account, separately from any Claude subscription. Kapso bills separately too.
  To make replies cheaper and faster, set `CLAUDE_EFFORT=low`.
- **Only text messages are handled.** Images, voice notes and other message
  types are ignored for now.
- **History is plain text.** Only the text of Claude's replies is stored, so
  older turns can be dropped without the API rejecting the conversation.

## Tests

```bash
pytest whatsapp_bridge/tests
```

The tests run offline. They use a fake Claude client and a mocked Kapso.
