"""Keep Starlette TestClient reliable on Windows' default asyncio policy."""

import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
