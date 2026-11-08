import json
import os
from urllib.request import Request, urlopen


def ai_provider() -> str | None:
    configured_provider = os.getenv("FINN_LLM_PROVIDER", "").strip().lower()
    if configured_provider in {"openrouter", "openai", "ollama"}:
        return configured_provider
    if os.getenv("OPENROUTER_API_KEY"):
        return "openrouter"
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
    if provider == "ollama":
        return f"Ollama · {os.getenv('FINN_OLLAMA_MODEL', 'model not set')}"
    return "Local retrieval"


def generate_text(instructions: str, input_text: str, max_output_tokens: int = 220) -> str:
    provider = ai_provider()
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
        return answer

    if provider == "openrouter":
        from openai import OpenAI

        client = OpenAI(
            api_key=os.getenv("OPENROUTER_API_KEY"),
            base_url=os.getenv("FINN_OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
            timeout=120,
        )
        response = client.chat.completions.create(
            model=os.getenv("FINN_OPENROUTER_MODEL", "openrouter/auto"),
            messages=[{"role": "system", "content": instructions}, {"role": "user", "content": input_text}],
            max_tokens=max_output_tokens,
            extra_headers={
                "HTTP-Referer": os.getenv("FINN_SITE_URL", "http://localhost:5173"),
                "X-Title": os.getenv("FINN_SITE_NAME", "FINN Investor Intelligence"),
            },
        )
        answer = response.choices[0].message.content
        if not answer or not answer.strip():
            raise RuntimeError("OpenRouter returned an empty response.")
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
        return response.output_text.strip()
    raise RuntimeError("No language model is configured.")
