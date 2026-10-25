"""WhatsApp <-> Claude bridge.

Kapso POSTs each inbound WhatsApp message to ``/webhook``. The bridge checks the
signature, answers 200 right away (Kapso gives up after 10 seconds), then asks
Claude for a reply in the background and sends it back through Kapso's
send-text endpoint.

Run with:  uvicorn whatsapp_bridge.app:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
from collections import OrderedDict, defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

import anthropic
import httpx
from fastapi import BackgroundTasks, FastAPI, Request, Response

logger = logging.getLogger("whatsapp_bridge")

KAPSO_BASE_URL = "https://api.kapso.ai/meta/whatsapp/v24.0"
# WhatsApp rejects text bodies over 4096 characters.
WHATSAPP_MAX_CHARS = 4096
RESET_COMMAND = "/reset"
REFUSAL_REPLY = "Sorry, I can't help with that one."
ERROR_REPLY = "Something went wrong on my side. Please try again in a moment."

DEFAULT_SYSTEM_PROMPT = (
    "You are Claude, chatting with the user over WhatsApp. Keep replies short and "
    "conversational, the way you would text a friend. WhatsApp only renders "
    "*bold*, _italic_, ~strike~ and ```code```, so avoid Markdown headings, "
    "tables and links in [text](url) form."
)


@dataclass
class Settings:
    kapso_api_key: str
    kapso_webhook_secret: str
    phone_number_id: str | None = None
    # Digits-only phone numbers allowed to talk to the bot. Empty means anyone,
    # which lets strangers spend your API credits, so set it.
    allowed_numbers: frozenset[str] = frozenset()
    model: str = "claude-opus-5-5"
    effort: str = "medium"
    max_tokens: int = 16000
    history_turns: int = 20
    system_prompt: str = DEFAULT_SYSTEM_PROMPT
    kapso_base_url: str = KAPSO_BASE_URL

    @classmethod
    def from_env(cls) -> Settings:
        def required(name: str) -> str:
            value = os.environ.get(name, "").strip()
            if not value:
                raise RuntimeError(f"{name} is not set (see whatsapp_bridge/.env.example)")
            return value

        allowed = os.environ.get("ALLOWED_NUMBERS", "")
        return cls(
            kapso_api_key=required("KAPSO_API_KEY"),
            kapso_webhook_secret=required("KAPSO_WEBHOOK_SECRET"),
            phone_number_id=os.environ.get("KAPSO_PHONE_NUMBER_ID") or None,
            allowed_numbers=frozenset(
                _digits(n) for n in allowed.split(",") if _digits(n)
            ),
            model=os.environ.get("CLAUDE_MODEL", cls.model),
            effort=os.environ.get("CLAUDE_EFFORT", cls.effort),
            max_tokens=int(os.environ.get("CLAUDE_MAX_TOKENS", cls.max_tokens)),
            history_turns=int(os.environ.get("HISTORY_TURNS", cls.history_turns)),
            system_prompt=os.environ.get("SYSTEM_PROMPT", DEFAULT_SYSTEM_PROMPT),
        )


@dataclass
class InboundMessage:
    sender: str
    text: str
    phone_number_id: str | None


@dataclass
class Bridge:
    settings: Settings
    claude: anthropic.AsyncAnthropic
    http: httpx.AsyncClient
    # Per-sender chat history as plain text turns. Only the text of Claude's
    # replies is kept, never thinking blocks: thinking blocks are bound to the
    # exact history before them, so dropping old turns from the front would
    # invalidate them. Text-only history can be trimmed freely.
    history: dict[str, deque[dict[str, str]]] = field(default_factory=dict)
    locks: defaultdict[str, asyncio.Lock] = field(
        default_factory=lambda: defaultdict(asyncio.Lock)
    )
    seen_deliveries: OrderedDict[str, None] = field(default_factory=OrderedDict)

    def is_duplicate(self, delivery_key: str | None) -> bool:
        """Remember Kapso's idempotency keys so retried deliveries are answered once."""
        if not delivery_key:
            return False
        if delivery_key in self.seen_deliveries:
            return True
        self.seen_deliveries[delivery_key] = None
        while len(self.seen_deliveries) > 1000:
            self.seen_deliveries.popitem(last=False)
        return False

    def is_allowed(self, sender: str) -> bool:
        allowed = self.settings.allowed_numbers
        return not allowed or _digits(sender) in allowed

    async def handle(self, message: InboundMessage) -> None:
        # One reply at a time per sender, so turns stay in order.
        async with self.locks[message.sender]:
            try:
                reply = await self._reply_for(message)
                await self.send_text(message, reply)
            except Exception:
                logger.exception("Failed to answer %s", message.sender)
                try:
                    await self.send_text(message, ERROR_REPLY)
                except Exception:
                    logger.exception("Failed to send error reply to %s", message.sender)

    async def _reply_for(self, message: InboundMessage) -> str:
        if message.text.strip().lower() == RESET_COMMAND:
            self.history.pop(message.sender, None)
            return "Okay, starting a fresh conversation."

        turns = self.history.setdefault(
            message.sender, deque(maxlen=self.settings.history_turns * 2)
        )
        messages = [*turns, {"role": "user", "content": message.text}]

        response = await self.claude.beta.messages.create(
            model=self.settings.model,
            max_tokens=self.settings.max_tokens,
            system=self.settings.system_prompt,
            messages=messages,
            output_config={"effort": self.settings.effort},
            # If a safety classifier declines, the API retries on a fallback
            # model inside the same call instead of returning nothing.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )

        if response.stop_reason == "refusal":
            # Keep the refused turn out of history so it doesn't poison later turns.
            return REFUSAL_REPLY

        reply = "".join(b.text for b in response.content if b.type == "text").strip()
        if not reply:
            reply = "(no reply)"
        turns.append({"role": "user", "content": message.text})
        turns.append({"role": "assistant", "content": reply})
        # The deque drops the oldest turn on overflow; keep history starting
        # with a user turn as the API requires.
        while turns and turns[0]["role"] != "user":
            turns.popleft()
        return reply

    async def send_text(self, message: InboundMessage, body: str) -> None:
        phone_number_id = message.phone_number_id or self.settings.phone_number_id
        if not phone_number_id:
            raise RuntimeError("No phone_number_id in the webhook or KAPSO_PHONE_NUMBER_ID")
        url = f"{self.settings.kapso_base_url}/{phone_number_id}/messages"
        for chunk in split_message(body):
            resp = await self.http.post(
                url,
                headers={"X-API-Key": self.settings.kapso_api_key},
                json={
                    "messaging_product": "whatsapp",
                    "to": message.sender,
                    "type": "text",
                    "text": {"body": chunk},
                },
            )
            resp.raise_for_status()


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def verify_signature(raw_body: bytes, signature: str | None, secret: str) -> bool:
    """Kapso signs the raw body with HMAC-SHA256 and sends the hex digest."""
    if not signature:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


def parse_inbound(payload: dict[str, Any]) -> list[InboundMessage]:
    """Pull text messages out of a single or batched whatsapp.message.received payload."""
    items = payload.get("data") if payload.get("batch") else [payload]
    messages = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        msg = item.get("message") or {}
        conversation = item.get("conversation") or {}
        if msg.get("type") != "text":
            continue
        text = (msg.get("text") or {}).get("body")
        sender = msg.get("from") or conversation.get("phone_number")
        if not text or not sender:
            continue
        messages.append(
            InboundMessage(
                sender=str(sender),
                text=text,
                phone_number_id=item.get("phone_number_id")
                or conversation.get("phone_number_id"),
            )
        )
    return messages


def split_message(text: str, limit: int = WHATSAPP_MAX_CHARS) -> list[str]:
    """Split a long reply into WhatsApp-sized chunks, preferring paragraph breaks."""
    chunks = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        if cut <= 0:
            cut = text.rfind(" ", 0, limit)
        if cut <= 0:
            cut = limit
        chunks.append(text[:cut].rstrip())
        text = text[cut:].lstrip()
    if text:
        chunks.append(text)
    return chunks


def create_app(bridge: Bridge | None = None) -> FastAPI:
    app = FastAPI(title="WhatsApp Claude bridge")

    def get_bridge() -> Bridge:
        nonlocal bridge
        if bridge is None:
            bridge = Bridge(
                settings=Settings.from_env(),
                claude=anthropic.AsyncAnthropic(),
                http=httpx.AsyncClient(timeout=30.0),
            )
        return bridge

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/webhook")
    async def webhook(request: Request, background: BackgroundTasks) -> Response:
        b = get_bridge()
        raw = await request.body()
        if not verify_signature(
            raw, request.headers.get("X-Webhook-Signature"), b.settings.kapso_webhook_secret
        ):
            return Response(status_code=401)
        if b.is_duplicate(request.headers.get("X-Idempotency-Key")):
            return Response(status_code=200)
        if request.headers.get("X-Webhook-Event", "whatsapp.message.received") != (
            "whatsapp.message.received"
        ):
            return Response(status_code=200)

        try:
            payload = json.loads(raw)
        except ValueError:
            return Response(status_code=400)

        for message in parse_inbound(payload):
            if b.is_allowed(message.sender):
                background.add_task(b.handle, message)
            else:
                logger.info("Ignoring message from non-allowed number %s", message.sender)
        return Response(status_code=200)

    return app


app = create_app()
