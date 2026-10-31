import json

import httpx
import pytest

from app.config import Settings
from app.llm.budget import ClaudeBudget, price_for
from app.llm.gemini import GeminiClient
from app.main import build_services
from app.models import FetchExtraction

FOUND = FetchExtraction(found=True, result_json='{"a": 1}', missing=[], interaction_hint="")


def _client(payload, status=200, model="gemini-3.8-flash", budget=None):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(status, json=payload)

    client = GeminiClient("k", model, budget=budget, transport=httpx.MockTransport(handler))
    return client, calls


def _answer(text, finish="STOP"):
    return {
        "candidates": [{"content": {"parts": [{"text": text}]}, "finishReason": finish}],
        "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 20},
    }


async def test_parses_structured_output_and_sends_schema():
    client, calls = _client(_answer(FOUND.model_dump_json()))
    out = await client.parse(system="sys", user="hi", output_model=FetchExtraction)
    assert out.parsed == FOUND and out.error is None and out.stop_reason == "end_turn"

    request = calls[0]
    assert request.url.path.endswith("/models/gemini-3.8-flash:generateContent")
    assert request.headers["x-goog-api-key"] == "k"
    body = json.loads(request.content)
    config = body["generationConfig"]
    assert config["responseMimeType"] == "application/json"
    assert config["responseJsonSchema"] == FetchExtraction.model_json_schema()
    assert config["thinkingConfig"] == {"thinkingLevel": "low"}
    assert body["systemInstruction"]["parts"][0]["text"] == "sys"


async def test_older_models_get_no_thinking_level():
    client, calls = _client(_answer(FOUND.model_dump_json()), model="gemini-2.5-flash")
    await client.parse(system="s", user="u", output_model=FetchExtraction)
    assert "thinkingConfig" not in json.loads(calls[0].content)["generationConfig"]


@pytest.mark.parametrize(
    ("payload", "status", "error"),
    [
        ({"error": {"message": "quota"}}, 429, "RateLimitError"),
        ({"error": {"message": "bad"}}, 400, "GeminiError 400"),
        (_answer("not json"), 200, "ValidationError"),
        ({"candidates": []}, 200, "no parsed output"),
        (_answer("", finish="SAFETY"), 200, "refusal"),
        ({"promptFeedback": {"blockReason": "OTHER"}}, 200, "refusal"),
    ],
)
async def test_failures_never_raise(payload, status, error):
    client, _ = _client(payload, status=status)
    out = await client.parse(system="s", user="u", output_model=FetchExtraction)
    assert out.parsed is None and out.error.startswith(error)


async def test_usage_is_recorded_at_zero_cost(temp_db):
    budget = ClaudeBudget(4.0)
    client, _ = _client(_answer(FOUND.model_dump_json()), budget=budget)
    await client.parse(system="s", user="u", output_model=FetchExtraction, purpose="extract")
    assert budget.calls == 1 and budget.spent_usd == 0.0
    assert price_for("gemini-3.8-flash") == (0.0, 0.0)


def test_provider_selection():
    gemini_only = Settings(_env_file=None, gemini_api_key="g")
    assert gemini_only.active_llm_provider == "gemini"
    assert gemini_only.active_llm_model == "gemini-3.8-flash"
    assert isinstance(build_services(gemini_only, tinyfish=None).claude, GeminiClient)

    both = Settings(_env_file=None, anthropic_api_key="a", gemini_api_key="g")
    assert both.active_llm_provider == "anthropic"
    forced = Settings(
        _env_file=None, anthropic_api_key="a", gemini_api_key="g", llm_provider="gemini"
    )
    assert forced.active_llm_provider == "gemini"

    assert Settings(_env_file=None).active_llm_provider is None
    assert build_services(Settings(_env_file=None), tinyfish=None).claude is None
