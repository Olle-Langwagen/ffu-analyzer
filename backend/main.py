import os
import json
import logging
import sqlite3
import asyncio
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

import pymupdf4llm
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai import OpenAI
from dotenv import load_dotenv
from pydantic import BaseModel, Field, ValidationError

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
db = sqlite3.connect(Path(__file__).with_name("ffu.db"), check_same_thread=False)
client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
data_dir = Path("data")
extract = lambda path: pymupdf4llm.to_markdown(str(path), ignore_images=True, ignore_graphics=True)
MODEL_NAME = os.getenv("OPENAI_MODEL", "gpt-5.4")
CONTRACT_VERSION = "1.0"
MAX_TOOL_TURNS = 10
MAX_TOOL_CONTENT_CHARS = 18000


@asynccontextmanager
async def lifespan(app):
    db.execute("CREATE TABLE IF NOT EXISTS documents(id INTEGER PRIMARY KEY, filename TEXT, content TEXT)")
    db.commit()
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class StructuredAnswer(BaseModel):
    answer: str
    important_dates: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)


class ResponseEnvelope(BaseModel):
    contract_version: str
    request_id: str
    sequence: int
    timestamp: str
    event_type: str
    is_final: bool
    payload: dict


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_sse_event(request_id: str, sequence: int, event_type: str, payload: dict, is_final: bool = False) -> str:
    envelope = ResponseEnvelope(
        contract_version=CONTRACT_VERSION,
        request_id=request_id,
        sequence=sequence,
        timestamp=now_iso(),
        event_type=event_type,
        is_final=is_final,
        payload=payload,
    )
    return f"event: {event_type}\ndata: {envelope.model_dump_json()}\n\n"


def get_system_message() -> dict:
    docs = db.execute("SELECT id, filename FROM documents ORDER BY id").fetchall()
    return {
        "role": "system",
        "content": (
            "You are an FFU document analyst for Swedish construction tender documents. "
            "Available documents:\n"
            + "\n".join(f"{doc_id}: {name}" for doc_id, name in docs)
            + "\nUse read_document when you need full document content. "
            "Respond strictly as JSON matching this schema: "
            "{\"answer\": string, \"important_dates\": string[], \"risks\": string[]}."
        ),
    }


def get_tools() -> list:
    return [{
        "type": "function",
        "function": {
            "name": "read_document",
            "description": "Read one FFU document by database id.",
            "parameters": {
                "type": "object",
                "properties": {"document_id": {"type": "integer"}},
                "required": ["document_id"],
            },
        },
    }]


def read_document_content(document_id: int) -> str:
    row = db.execute("SELECT content FROM documents WHERE id = ?", (document_id,)).fetchone()
    if not row:
        return "Document not found."
    content = row[0]
    if len(content) <= MAX_TOOL_CONTENT_CHARS:
        return content
    return content[:MAX_TOOL_CONTENT_CHARS] + "\n\n[Truncated: document too long for one tool response.]"


def run_tool_phase(messages: list, tools: list) -> tuple[list, int]:
    tool_calls_count = 0
    for _ in range(MAX_TOOL_TURNS):
        resp = client.chat.completions.create(
            model=MODEL_NAME,
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )
        msg = resp.choices[0].message
        if not msg.tool_calls:
            return messages, tool_calls_count
        messages.append(msg.model_dump(exclude_none=True))
        for call in msg.tool_calls:
            tool_calls_count += 1
            try:
                args = json.loads(call.function.arguments or "{}")
                document_id = int(args.get("document_id"))
                content = read_document_content(document_id)
            except Exception as exc:
                content = f"Tool error: {exc}"
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": content,
            })
    raise RuntimeError("Stopped after maximum tool iterations.")


def parse_or_fallback_structured_answer(raw: str) -> StructuredAnswer:
    try:
        return StructuredAnswer.model_validate(json.loads(raw))
    except (json.JSONDecodeError, ValidationError):
        return StructuredAnswer(answer=raw, important_dates=[], risks=[])

@app.post("/process")
def process():
    logger.info("Processing documents...")
    db.execute("DELETE FROM documents"); db.commit()
    paths = sorted(data_dir.rglob("*.pdf"))
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {pool.submit(extract, path): path for path in paths}
        for future in as_completed(futures):
            path = futures[future]
            db.execute("INSERT INTO documents(filename, content) VALUES(?, ?)", (path.name, future.result())); db.commit()
            logger.info(f"Processed {path.name}")
    return {"status": "ok", "count": len(paths)}


@app.post("/chat")
async def chat(body: dict, request: Request):
    async def event_stream():
        request_id = str(uuid4())
        sequence = 0

        def emit(event_type: str, payload: dict, is_final: bool = False):
            nonlocal sequence
            sequence += 1
            return make_sse_event(request_id, sequence, event_type, payload, is_final=is_final)

        try:
            history = body.get("history", [])
            message = body.get("message", "")
            messages = [get_system_message(), *history, {"role": "user", "content": message}]
            tools = get_tools()

            yield emit("lifecycle", {"phase": "accepted"})
            yield emit("lifecycle", {"phase": "tool_resolution_started"})

            tool_start = datetime.now(timezone.utc)
            resolved_messages, tool_calls_count = await asyncio.to_thread(run_tool_phase, messages, tools)
            tool_ms = int((datetime.now(timezone.utc) - tool_start).total_seconds() * 1000)

            yield emit(
                "lifecycle",
                {
                    "phase": "tool_resolution_done",
                    "tool_calls": tool_calls_count,
                    "duration_ms": tool_ms,
                },
            )
            yield emit("lifecycle", {"phase": "generation_started"})

            generation_start = datetime.now(timezone.utc)
            stream = client.chat.completions.create(
                model=MODEL_NAME,
                messages=resolved_messages,
                stream=True,
            )

            raw_text = ""
            for chunk in stream:
                if await request.is_disconnected():
                    return
                token = chunk.choices[0].delta.content or ""
                if token:
                    raw_text += token
                    yield emit("token", {"delta": token})

            generation_ms = int((datetime.now(timezone.utc) - generation_start).total_seconds() * 1000)
            structured = parse_or_fallback_structured_answer(raw_text)
            yield emit("lifecycle", {"phase": "generation_done", "duration_ms": generation_ms})
            yield emit(
                "done",
                {
                    "result": structured.model_dump(),
                    "usage": {
                        "tool_calls": tool_calls_count,
                    },
                    "timings": {
                        "tool_ms": tool_ms,
                        "generation_ms": generation_ms,
                        "total_ms": tool_ms + generation_ms,
                    },
                },
                is_final=True,
            )
        except Exception as exc:
            yield emit(
                "error",
                {
                    "code": "chat_stream_error",
                    "message": str(exc),
                },
                is_final=True,
            )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
