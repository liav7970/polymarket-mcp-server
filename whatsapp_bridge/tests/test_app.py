"""Offline tests for the WhatsApp bridge: no network, fake Claude, mocked Kapso."""

from __future__ import annotations

import hashlib
import hmac
import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from whatsapp_bridge.app import (
    ERROR_REPLY,
    REFUSAL_REPLY,
    Bridge,
    Settings,
    create_app,
    parse_inbound,
    split_message,
    verify_signature,
)

SECRET = "test-secret"
SENDER = "15551234567"
PHONE_ID = "647015955153740"


def inbound(text: str, sender: str = SENDER, msg_type: str = "text") -> dict:
    return {
        "phone_number_id": PHONE_ID,
        "message": {"from": sender, "type": msg_type, "text": {"body": text}},
        "conversation": {"phone_number": f"+{sender}", "phone_number_id": PHONE_ID},
    }


def sign(raw: bytes) -> str:
    return hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()


class FakeMessages:
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        if reply is None:
            return SimpleNamespace(stop_reason="refusal", content=[])
        return SimpleNamespace(
            stop_reason="end_turn",
            content=[
                SimpleNamespace(type="thinking", thinking=""),
                SimpleNamespace(type="text", text=reply),
            ],
        )


class Harness:
    def __init__(self, replies, **settings):
        self.sent = []

        def kapso(request: httpx.Request) -> httpx.Response:
            self.sent.append((request, json.loads(request.content)))
            return httpx.Response(200, json={"messages": [{"id": "wamid.x"}]})

        self.messages = FakeMessages(replies)
        self.bridge = Bridge(
            settings=Settings(kapso_api_key="kapso-key", kapso_webhook_secret=SECRET, **settings),
            claude=SimpleNamespace(beta=SimpleNamespace(messages=self.messages)),
            http=httpx.AsyncClient(transport=httpx.MockTransport(kapso)),
        )
        self.client = TestClient(create_app(self.bridge))

    def post(self, payload: dict, key: str | None = None, signature: str | None = None):
        raw = json.dumps(payload).encode()
        headers = {"X-Webhook-Signature": signature or sign(raw)}
        if key:
            headers["X-Idempotency-Key"] = key
        return self.client.post("/webhook", content=raw, headers=headers)

    @property
    def bodies(self) -> list[str]:
        return [body["text"]["body"] for _, body in self.sent]


def test_reply_is_sent_back_through_kapso():
    h = Harness(["Hi there!"])
    assert h.post(inbound("hello")).status_code == 200

    request, body = h.sent[0]
    assert str(request.url) == f"https://api.kapso.ai/meta/whatsapp/v24.0/{PHONE_ID}/messages"
    assert request.headers["X-API-Key"] == "kapso-key"
    assert body == {
        "messaging_product": "whatsapp",
        "to": SENDER,
        "type": "text",
        "text": {"body": "Hi there!"},
    }
    call = h.messages.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default"
    assert call["betas"] == ["server-side-fallback-2026-07-01"]
    assert call["messages"] == [{"role": "user", "content": "hello"}]


def test_history_is_text_only_and_carries_over():
    h = Harness(["I'm Claude.", "You said hello."])
    h.post(inbound("hello"))
    h.post(inbound("what did I say?"))

    assert h.messages.calls[1]["messages"] == [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "I'm Claude."},
        {"role": "user", "content": "what did I say?"},
    ]


def test_history_is_trimmed_from_the_front_in_whole_turns():
    h = Harness(["a1", "a2", "a3"], history_turns=1)
    for text in ("q1", "q2", "q3"):
        h.post(inbound(text))
    assert h.messages.calls[2]["messages"] == [
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "a2"},
        {"role": "user", "content": "q3"},
    ]


def test_reset_clears_history_without_calling_claude():
    h = Harness(["first", "fresh"])
    h.post(inbound("hello"))
    h.post(inbound("/reset"))
    h.post(inbound("hi again"))

    assert len(h.messages.calls) == 2
    assert h.messages.calls[1]["messages"] == [{"role": "user", "content": "hi again"}]
    assert h.bodies[1].startswith("Okay")


def test_bad_or_missing_signature_is_rejected():
    h = Harness([])
    assert h.post(inbound("hello"), signature="0" * 64).status_code == 401
    raw = json.dumps(inbound("hello")).encode()
    assert h.client.post("/webhook", content=raw).status_code == 401
    assert h.sent == []


def test_retried_delivery_is_answered_once():
    h = Harness(["once"])
    h.post(inbound("hello"), key="delivery-1")
    assert h.post(inbound("hello"), key="delivery-1").status_code == 200
    assert len(h.messages.calls) == 1


def test_numbers_outside_the_allowlist_are_ignored():
    h = Harness(["hi"], allowed_numbers=frozenset({"15559990000"}))
    assert h.post(inbound("hello")).status_code == 200
    assert h.messages.calls == [] and h.sent == []


def test_refusal_sends_a_short_note_and_skips_history():
    h = Harness([None, "ok"])
    h.post(inbound("bad request"))
    h.post(inbound("next"))
    assert h.bodies[0] == REFUSAL_REPLY
    assert h.messages.calls[1]["messages"] == [{"role": "user", "content": "next"}]


def test_claude_error_sends_an_error_reply():
    h = Harness([RuntimeError("boom")])
    assert h.post(inbound("hello")).status_code == 200
    assert h.bodies == [ERROR_REPLY]


def test_batched_payload_and_non_text_messages():
    payload = {
        "type": "whatsapp.message.received",
        "batch": True,
        "data": [inbound("one"), inbound("", msg_type="image"), inbound("two")],
    }
    messages = parse_inbound(payload)
    assert [m.text for m in messages] == ["one", "two"]
    assert messages[0].phone_number_id == PHONE_ID


def test_long_replies_are_split():
    text = ("word " * 1000).strip()
    chunks = split_message(text)
    assert all(len(c) <= 4096 for c in chunks)
    assert " ".join(chunks) == text


def test_verify_signature():
    raw = b'{"a":1}'
    assert verify_signature(raw, sign(raw), SECRET)
    assert not verify_signature(raw, None, SECRET)
    assert not verify_signature(raw, "short", SECRET)


def test_settings_require_secrets(monkeypatch):
    monkeypatch.delenv("KAPSO_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="KAPSO_API_KEY"):
        Settings.from_env()
