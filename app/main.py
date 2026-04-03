from fastapi import FastAPI, Request, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import json
import os
from datetime import datetime, date
from pathlib import Path

from app.routes import tasks, ai_advisor

app = FastAPI(title="時間 Jikan Planner", description="Japanese-inspired time planner with AI guidance")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

app.include_router(tasks.router, prefix="/api/tasks", tags=["tasks"])
app.include_router(ai_advisor.router, prefix="/api/ai", tags=["ai"])


@app.get("/")
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/health")
async def health():
    return {"status": "生きている", "message": "alive"}
