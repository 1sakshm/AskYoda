"""Gemini (Google AI Studio) stand-in for `ClaudeClient`, for running without an Anthropic key.

Same contract as `ClaudeClient.parse()`: it never raises, and every failure comes back as
`ParseOutcome(parsed=None, ...)` so the extractor and the diagnoser fall back to the rules.
Calls the `generateContent` REST endpoint with raw httpx and a JSON Schema built from the
pydantic output model. Usage is recorded against the same budget (Gemini is priced at 0 in
`budget.py`, since the free tier is the point; Google's rate limits are the real cap).
"""

import logging
from types import SimpleNamespace
from typing import Any

import httpx
import pydantic

from app.llm.budget import ClaudeBudget, estimate_max_cost
from app.llm.claude import DEFAULT_MAX_TOKENS, ParseOutcome

log = logging.getLogger(__name__)

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"
# Gemini 3+ models accept `thinkingLevel`; older ones (2.5) use a token budget instead.
THINKING_LEVEL_MODELS = ("gemini-3", "gemini-4")
# Finish reasons that mean the model declined, mapped to the same "refusal" Claude reports.
REFUSAL_REASONS = {"SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"}


def supports_thinking_level(model: str) -> bool:
    return model.startswith(THINKING_LEVEL_MODELS)


class GeminiClient:
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        budget: ClaudeBudget | None = None,
        base_url: str = GEMINI_BASE,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.model = model
        self.budget = budget
        self._http = httpx.AsyncClient(
            base_url=base_url, headers={"x-goog-api-key": api_key}, transport=transport
        )

    def request_body(
        self, *, system: str, user: str, output_model: type, max_tokens: int, effort: str
    ) -> dict[str, Any]:
        config: dict[str, Any] = {
            "responseMimeType": "application/json",
            "responseJsonSchema": output_model.model_json_schema(),
            "maxOutputTokens": max_tokens,
        }
        if supports_thinking_level(self.model):
            config["thinkingConfig"] = {"thinkingLevel": effort}
        return {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": config,
        }

    async def parse[T: pydantic.BaseModel](
        self,
        *,
        system: str,
        user: str,
        output_model: type[T],
        purpose: str = "",
        max_tokens: int = DEFAULT_MAX_TOKENS,
        effort: str = "low",
        timeout_s: float = 45.0,
    ) -> ParseOutcome[T]:
        if self.budget is not None:
            estimate = estimate_max_cost(self.model, len(system) + len(user), max_tokens)
            if not await self.budget.can_afford(estimate):
                spent, cap = self.budget.spent_usd, self.budget.cap_usd
                return ParseOutcome(None, f"LLM budget reached (${spent:.2f} of ${cap:.2f})")

        body = self.request_body(
            system=system,
            user=user,
            output_model=output_model,
            max_tokens=max_tokens,
            effort=effort,
        )
        try:
            response = await self._http.post(
                f"/models/{self.model}:generateContent", json=body, timeout=timeout_s
            )
        except httpx.HTTPError as e:
            return ParseOutcome(None, f"{type(e).__name__}: {e}")
        if response.status_code == 429:
            return ParseOutcome(None, f"RateLimitError: {response.text[:300]}")
        if response.status_code >= 400:
            return ParseOutcome(None, f"GeminiError {response.status_code}: {response.text[:300]}")
        try:
            data = response.json()
        except ValueError:
            return ParseOutcome(None, "Gemini returned non-JSON")

        if self.budget is not None:
            meta = data.get("usageMetadata") or {}
            usage = SimpleNamespace(
                input_tokens=meta.get("promptTokenCount", 0),
                output_tokens=meta.get("candidatesTokenCount", 0)
                + meta.get("thoughtsTokenCount", 0),
            )
            cost = await self.budget.record(model=self.model, purpose=purpose, usage=usage)
            log.info(
                "gemini %s call cost $%.4f (total $%.4f)", purpose, cost, self.budget.spent_usd
            )

        if (data.get("promptFeedback") or {}).get("blockReason"):
            return ParseOutcome(None, "refusal", "refusal")
        candidates = data.get("candidates") or []
        if not candidates:
            return ParseOutcome(None, "no parsed output")
        finish = candidates[0].get("finishReason")
        if finish in REFUSAL_REASONS:
            return ParseOutcome(None, "refusal", "refusal")
        stop_reason = "max_tokens" if finish == "MAX_TOKENS" else "end_turn"
        parts = (candidates[0].get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        if not text:
            return ParseOutcome(None, "no parsed output", stop_reason)
        try:
            parsed = output_model.model_validate_json(text)
        except pydantic.ValidationError as e:
            return ParseOutcome(None, f"ValidationError: {e.error_count()} issue(s)", stop_reason)
        return ParseOutcome(parsed, None, stop_reason)

    async def aclose(self) -> None:
        await self._http.aclose()
