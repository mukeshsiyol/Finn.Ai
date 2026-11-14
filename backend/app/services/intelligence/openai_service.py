import json
import logging
import os
import time
from urllib.request import Request, urlopen

logger = logging.getLogger("finn.models")


def ai_provider() -> str | None:
    configured_provider = os.getenv("FINN_LLM_PROVIDER", "").strip().lower()
    if configured_provider in {"openrouter", "openai", "ollama", "gemini"}:
        return configured_provider
    if os.getenv("OPENROUTER_API_KEY"):
        return "openrouter"
    if os.getenv("GEMINI_API_KEY"):
        return "gemini"
    if os.getenv("OPENAI_API_KEY"):
        return "openai"
    if os.getenv("FINN_LLM_PROVIDER", "").strip().lower() == "ollama":
        return "ollama"
    return None


def ai_is_enabled() -> bool:
    provider = ai_provider()
    if provider == "openrouter":
        return bool(os.getenv("OPENROUTER_API_KEY"))
    if provider == "openai":
        return True
    if provider == "gemini":
        return bool(os.getenv("GEMINI_API_KEY"))
    if provider != "ollama":
        return False
    base_url = os.getenv("FINN_OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    model = os.getenv("FINN_OLLAMA_MODEL", "").strip()
    if not model:
        return False
    try:
        with urlopen(f"{base_url}/api/tags", timeout=0.8) as response:
            available = json.loads(response.read().decode("utf-8")).get("models", [])
        return any(item.get("name") == model for item in available)
    except Exception:
        return False


def ai_provider_name() -> str:
    provider = ai_provider()
    if provider == "openrouter":
        return f"OpenRouter · {os.getenv('FINN_OPENROUTER_MODEL', 'openrouter/auto')}"
    if provider == "openai":
        return "OpenAI"
    if provider == "gemini":
        return f"Gemini · {os.getenv('FINN_GEMINI_MODEL', 'gemini-3.8-flash')}"
    if provider == "ollama":
        return f"Ollama · {os.getenv('FINN_OLLAMA_MODEL', 'model not set')}"
    return "Local retrieval"


def generate_text(instructions: str, input_text: str, max_output_tokens: int = 220) -> str:
    provider = ai_provider()
    started = time.perf_counter()
    if provider == "ollama":
        base_url = os.getenv("FINN_OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
        payload = {
            "model": os.getenv("FINN_OLLAMA_MODEL", "").strip(),
            "messages": [{"role": "system", "content": instructions}, {"role": "user", "content": input_text}],
            "stream": False,
            "options": {"num_predict": max_output_tokens},
        }
        request = Request(f"{base_url}/api/chat", data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=120) as response:
            result = json.loads(response.read().decode("utf-8"))
        answer = result.get("message", {}).get("content", "").strip()
        if not answer:
            raise RuntimeError("Ollama returned an empty response.")
        logger.info(
            "model_request provider=ollama model=%s latency_ms=%d prompt_tokens=%s completion_tokens=%s",
            payload["model"],
            int((time.perf_counter() - started) * 1000),
            result.get("prompt_eval_count"),
            result.get("eval_count"),
        )
        return answer

    if provider in {"openrouter", "gemini"}:
        from openai import OpenAI

        if provider == "gemini":
            model = os.getenv("FINN_GEMINI_MODEL", "gemini-3.8-flash")
            client = OpenAI(api_key=os.getenv("GEMINI_API_KEY"), base_url=os.getenv("FINN_GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/"), timeout=120)
        else:
            model = os.getenv("FINN_OPENROUTER_MODEL", "openrouter/auto")
            client = OpenAI(api_key=os.getenv("OPENROUTER_API_KEY"), base_url=os.getenv("FINN_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"), timeout=120)
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": instructions}, {"role": "user", "content": input_text}],
            max_tokens=max_output_tokens,
            extra_headers={
                "HTTP-Referer": os.getenv("FINN_SITE_URL", "http://localhost:5173"),
                "X-Title": os.getenv("FINN_SITE_NAME", "FINN Investor Intelligence"),
            } if provider == "openrouter" else None,
        )
        answer = response.choices[0].message.content
        if not answer or not answer.strip():
            raise RuntimeError(f"{provider} returned an empty response.")
        usage = response.usage
        logger.info("model_request provider=%s model=%s latency_ms=%d prompt_tokens=%s completion_tokens=%s", provider, model, int((time.perf_counter() - started) * 1000), getattr(usage, "prompt_tokens", None), getattr(usage, "completion_tokens", None))
        return answer.strip()

    if provider == "openai":
        from openai import OpenAI

        response = OpenAI().responses.create(
            model=os.getenv("FINN_OPENAI_MODEL", "gpt-6-astra"),
            instructions=instructions,
            input=input_text,
            max_output_tokens=max_output_tokens,
            store=False,
        )
        usage = getattr(response, "usage", None)
        logger.info(
            "model_request provider=openai model=%s latency_ms=%d prompt_tokens=%s completion_tokens=%s",
            os.getenv("FINN_OPENAI_MODEL", "gpt-6-astra"),
            int((time.perf_counter() - started) * 1000),
            getattr(usage, "input_tokens", None),
            getattr(usage, "output_tokens", None),
        )
        return response.output_text.strip()
    raise RuntimeError("No language model is configured.")
