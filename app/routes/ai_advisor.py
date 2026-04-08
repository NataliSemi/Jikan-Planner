from fastapi import APIRouter, HTTPException
import httpx
import os
import json
import asyncio
import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from app import store
from app.models import MoodCheckIn

router = APIRouter()
logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MAX_OUTPUT_TOKENS = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "1024"))
TEMPERATURE = float(os.getenv("GEMINI_TEMPERATURE", "0.7"))


def _extract_gemini_error(resp: httpx.Response) -> str:
    try:
        data = resp.json()
        return data.get("error", {}).get("message", "")
    except (ValueError, AttributeError):
        return ""


async def call_gemini(system_prompt: str, user_message: str) -> str:
    if not GEMINI_API_KEY:
        return (
            "APIキーが設定されていません。\n"
            "GEMINI_API_KEY 環境変数を設定してください。\n\n"
            "Get a free key at: https://aistudio.google.com/apikey"
        )

    payload = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": user_message}]}],
        "generationConfig": {
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
            "temperature": TEMPERATURE,
        },
    }

    max_retries = 3
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{GEMINI_URL.format(model=GEMINI_MODEL)}?key={GEMINI_API_KEY}",
                    json=payload,
                )

                # Handle rate limit with retry
                if resp.status_code == 429:
                    wait = int(resp.headers.get("Retry-After", 2 ** attempt))
                    if attempt < max_retries - 1:
                        await asyncio.sleep(wait)
                        continue
                    error_msg = _extract_gemini_error(resp)
                    logger.warning("Gemini 429 rate-limited: %s", error_msg or "no details")
                    return (
                        "先生は少々お待ちください... Sensei is briefly unavailable.\n\n"
                        "Gemini API rate limit reached (too many requests). "
                        f"Current model: {GEMINI_MODEL}.\n"
                        "Please wait a moment and try again.\n\n"
                        "一息ついて、また話しかけてください。"
                    )

                # Other HTTP errors
                if resp.status_code == 400:
                    return "リクエストエラー · Bad request — please try a shorter message."
                if resp.status_code == 403:
                    return (
                        "APIキーが無効です · Invalid API key.\n"
                        "Check your GEMINI_API_KEY in the .env file."
                    )
                if resp.status_code == 404:
                    return (
                        "モデルが見つかりません · Model not found.\n"
                        f"Check GEMINI_MODEL (current: {GEMINI_MODEL})."
                    )
                if resp.status_code >= 500:
                    if attempt < max_retries - 1:
                        await asyncio.sleep(2 ** attempt)
                        continue
                    return "Gemini サーバーエラー · Gemini server error. Please try again shortly."

                resp.raise_for_status()
                data = resp.json()

                # Safely extract text
                try:
                    return data["candidates"][0]["content"]["parts"][0]["text"]
                except (KeyError, IndexError):
                    logger.warning("Gemini response missing text payload: %s", data)
                    return "先生の言葉が届きませんでした · No response received. Please try again."

        except httpx.TimeoutException:
            if attempt < max_retries - 1:
                await asyncio.sleep(1)
                continue
            return "タイムアウト · Request timed out. Gemini took too long to respond. Please try again."
        except httpx.RequestError as e:
            logger.exception("Gemini network request failed")
            return f"ネットワークエラー · Network error: {str(e)}"

    return "エラー · Something went wrong. Please try again."


SENSEI_SYSTEM = """You are 時間先生 (Jikan Sensei), a wise and calm Japanese time-management advisor.
You speak with gentle authority, using occasional Japanese phrases and references to Japanese wisdom,
wabi-sabi philosophy, and the concept of ikigai. Keep responses concise, warm, and practical.
Always respond in English but sprinkle Japanese words naturally.
Format your response in plain text, no markdown."""

TASK_CREATOR_SYSTEM = """You convert natural language requests into planner tasks.
Return JSON only with this shape:
{"tasks":[{"title":"...", "activity_type":"learning|reading|playing|exercise|rest|creative|social", "duration_minutes":30, "scheduled_date":"YYYY-MM-DD or null", "scheduled_time":"HH:MM or null", "notes":"optional", "checklist":["item 1","item 2"], "recurrence_weekdays":["monday","tuesday"]}]}
Rules:
- Use at most 5 tasks.
- If user asks for recurring weekly habits, fill recurrence_weekdays.
- checklist is optional, but include it when user requests components/steps.
- If a field is unknown, use null for date/time and [] for arrays.
- Resolve relative date phrases (e.g. today, tomorrow, next Monday) against the provided local datetime context.
- Never invent old/past years unless the user explicitly asks for a historical date.
- Output valid JSON only.
"""


def _resolve_context(body: dict | None = None) -> dict:
    body = body or {}
    tz_name = (body.get("timezone") or "UTC").strip()
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")
        tz_name = "UTC"

    now_iso = body.get("local_datetime")
    now = None
    if isinstance(now_iso, str) and now_iso.strip():
        try:
            now = datetime.fromisoformat(now_iso.replace("Z", "+00:00"))
            if now.tzinfo is None:
                now = now.replace(tzinfo=tz)
            else:
                now = now.astimezone(tz)
        except ValueError:
            now = None

    if now is None:
        now = datetime.now(tz)

    return {
        "timezone": tz_name,
        "now": now,
        "today": now.date().isoformat(),
        "hour": now.hour,
    }


def _looks_future_intent(message: str) -> bool:
    msg = (message or "").lower()
    tokens = [
        "tomorrow", "day after tomorrow", "next week", "next month", "next ",
        "tonight", "this evening", "later today", "later",
    ]
    return any(t in msg for t in tokens)


def _normalize_task_dates(tasks: list[dict], message: str, ctx: dict) -> list[dict]:
    if not _looks_future_intent(message):
        return tasks

    today_date = date.fromisoformat(ctx["today"])
    tomorrow = (today_date + timedelta(days=1)).isoformat()
    msg = message.lower()

    for task in tasks:
        scheduled_date = task.get("scheduled_date")
        if not isinstance(scheduled_date, str) or not scheduled_date:
            continue
        try:
            parsed = date.fromisoformat(scheduled_date)
        except ValueError:
            continue

        if parsed >= today_date:
            continue

        if "tomorrow" in msg:
            task["scheduled_date"] = tomorrow
        elif "today" in msg:
            task["scheduled_date"] = today_date.isoformat()
        else:
            task["scheduled_date"] = today_date.isoformat()

    return tasks


def _extract_json_block(raw_text: str) -> dict:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if "\n" in text:
            text = text.split("\n", 1)[1]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise


def _parse_checklist_text(raw_value) -> tuple[str, bool]:
    text = str(raw_value).strip()
    if not text:
        return "", False
    if text.startswith("{") and text.endswith("}"):
        try:
            obj = json.loads(text.replace("'", '"').replace(" True", " true").replace(" False", " false"))
            if isinstance(obj, dict):
                parsed_text = str(obj.get("text", "")).strip()
                parsed_completed = bool(obj.get("completed", False))
                return parsed_text, parsed_completed
        except json.JSONDecodeError:
            pass
    return text, False


@router.post("/mood")
async def save_mood(mood: MoodCheckIn):
    return store.save_mood(mood.model_dump())


@router.get("/mood/today")
async def get_today_mood():
    mood = store.get_today_mood()
    if not mood:
        return {"message": "まだチェックインしていません", "mood": None}
    return mood


@router.post("/schedule")
async def get_schedule_recommendation(body: dict | None = None):
    ctx = _resolve_context(body)
    tasks = store.get_tasks(date_filter=ctx["today"])
    mood = store.get_today_mood()
    stats = store.get_stats()
    context = f"""
Today's tasks: {json.dumps(tasks, ensure_ascii=False)}
Today's mood/energy: {json.dumps(mood, ensure_ascii=False) if mood else 'Not checked in yet'}
Overall stats: {json.dumps(stats, ensure_ascii=False)}
Local timezone: {ctx["timezone"]}
Local datetime: {ctx["now"].isoformat()}
"""
    message = f"""Based on this context, please provide a gentle daily schedule recommendation.
Suggest an ideal order and timing for the tasks, and if no tasks exist, suggest a balanced day structure
covering learning, reading, exercise and rest. Keep it to 5-7 suggestions.
IMPORTANT: Your timing suggestions must fit the local time window. If local time is late evening/night,
avoid suggesting morning activities as if they can happen now.\n\nContext:\n{context}"""
    advice = await call_gemini(SENSEI_SYSTEM, message)
    return {"advice": advice, "type": "schedule"}


@router.post("/suggest")
async def get_activity_suggestion(body: dict | None = None):
    ctx = _resolve_context(body)
    mood = store.get_today_mood()
    stats = store.get_stats()
    mood_desc = json.dumps(mood, ensure_ascii=False) if mood else "unknown mood"
    message = f"""My current mood/energy state: {mood_desc}
My activity history stats: {json.dumps(stats, ensure_ascii=False)}
My local timezone: {ctx["timezone"]}
My local datetime: {ctx["now"].isoformat()}

Please suggest 3 specific activities that would be most beneficial right now.
For each suggestion, briefly explain why it suits my current state.
Consider balance between learning, reading, exercise, creative work and rest.
Only suggest activities that make sense at this local time (for example, no morning walk suggestion at midnight)."""
    advice = await call_gemini(SENSEI_SYSTEM, message)
    return {"advice": advice, "type": "suggestion"}


@router.post("/remind")
async def get_smart_reminder():
    tasks = store.get_tasks(date_filter=date.today().isoformat())
    pending = [t for t in tasks if not t.get("completed")]
    stats = store.get_stats()
    message = f"""Pending tasks for today: {json.dumps(pending, ensure_ascii=False)}
Overall completion rate: {stats.get('completion_rate', 0)}%
Minutes spent by activity type: {json.dumps(stats.get('minutes_by_type', {}), ensure_ascii=False)}

Please give me a gentle, encouraging reminder message. Reference any imbalances you notice.
Keep it to 3-4 sentences. Be like a wise Japanese mentor — firm but kind."""
    advice = await call_gemini(SENSEI_SYSTEM, message)
    return {"advice": advice, "type": "reminder"}


@router.post("/chat")
async def chat_with_sensei(body: dict):
    message = body.get("message", "")
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    advice = await call_gemini(SENSEI_SYSTEM, message)
    return {"advice": advice, "type": "chat"}


@router.post("/create-task")
async def create_task_from_ai(body: dict):
    ctx = _resolve_context(body)
    dry_run = bool(body.get("dry_run", False))
    proposed_tasks = body.get("proposed_tasks")
    if proposed_tasks is None:
        message = body.get("message", "").strip()
        if not message:
            raise HTTPException(status_code=400, detail="Message is required")
        contextual_message = (
            f"Local timezone: {ctx['timezone']}\n"
            f"Local datetime: {ctx['now'].isoformat()}\n"
            f"User request: {message}"
        )
        ai_response = await call_gemini(TASK_CREATOR_SYSTEM, contextual_message)
        try:
            parsed = _extract_json_block(ai_response)
        except json.JSONDecodeError:
            raise HTTPException(status_code=422, detail="Could not parse AI task response")
        source_tasks = _normalize_task_dates(parsed.get("tasks", []), message, ctx)
    else:
        source_tasks = proposed_tasks

    normalized_tasks = []
    for item in source_tasks:
        title = (item.get("title") or "").strip()
        activity_type = item.get("activity_type")
        duration = item.get("duration_minutes")
        if not title or not activity_type or not isinstance(duration, int):
            continue

        checklist = []
        for entry in item.get("checklist", []):
            if isinstance(entry, dict):
                text, fallback_completed = _parse_checklist_text(entry.get("text", ""))
                completed = bool(entry.get("completed", False))
                if not completed and fallback_completed:
                    completed = fallback_completed
            else:
                text, completed = _parse_checklist_text(entry)
            if text:
                checklist.append({"text": text, "completed": completed})
        weekdays = [str(day).lower() for day in item.get("recurrence_weekdays", []) if str(day).strip()]
        recurrence = {"frequency": "weekly", "weekdays": weekdays} if weekdays else None

        normalized_tasks.append({
            "title": title,
            "activity_type": activity_type,
            "duration_minutes": duration,
            "scheduled_date": item.get("scheduled_date"),
            "scheduled_time": item.get("scheduled_time"),
            "notes": item.get("notes"),
            "checklist": checklist,
            "recurrence": recurrence,
            "completion_log": [],
        })

    if dry_run:
        return {"proposal": normalized_tasks, "count": len(normalized_tasks), "type": "task-proposal"}

    created = [store.create_task(task) for task in normalized_tasks]
    return {"created": created, "count": len(created), "type": "create-task"}
