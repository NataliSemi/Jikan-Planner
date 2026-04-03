from fastapi import APIRouter, HTTPException
import httpx
import os
import json
import asyncio
import logging
from datetime import date
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
async def get_schedule_recommendation():
    tasks = store.get_tasks(date_filter=date.today().isoformat())
    mood = store.get_today_mood()
    stats = store.get_stats()
    context = f"""
Today's tasks: {json.dumps(tasks, ensure_ascii=False)}
Today's mood/energy: {json.dumps(mood, ensure_ascii=False) if mood else 'Not checked in yet'}
Overall stats: {json.dumps(stats, ensure_ascii=False)}
Current date: {date.today().isoformat()}
"""
    message = f"""Based on this context, please provide a gentle daily schedule recommendation.
Suggest an ideal order and timing for the tasks, and if no tasks exist, suggest a balanced day structure
covering learning, reading, exercise and rest. Keep it to 5-7 suggestions.\n\nContext:\n{context}"""
    advice = await call_gemini(SENSEI_SYSTEM, message)
    return {"advice": advice, "type": "schedule"}


@router.post("/suggest")
async def get_activity_suggestion():
    mood = store.get_today_mood()
    stats = store.get_stats()
    mood_desc = json.dumps(mood, ensure_ascii=False) if mood else "unknown mood"
    message = f"""My current mood/energy state: {mood_desc}
My activity history stats: {json.dumps(stats, ensure_ascii=False)}

Please suggest 3 specific activities that would be most beneficial right now.
For each suggestion, briefly explain why it suits my current state.
Consider balance between learning, reading, exercise, creative work and rest."""
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
