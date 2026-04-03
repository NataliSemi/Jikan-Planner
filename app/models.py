from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from enum import Enum


class ActivityType(str, Enum):
    learning = "learning"
    reading = "reading"
    playing = "playing"
    exercise = "exercise"
    rest = "rest"
    creative = "creative"
    social = "social"


class MoodLevel(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class Task(BaseModel):
    id: Optional[str] = None
    title: str
    activity_type: ActivityType
    duration_minutes: int
    scheduled_time: Optional[str] = None  # HH:MM format
    scheduled_date: Optional[str] = None  # YYYY-MM-DD
    completed: bool = False
    notes: Optional[str] = None
    created_at: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    activity_type: Optional[ActivityType] = None
    duration_minutes: Optional[int] = None
    scheduled_time: Optional[str] = None
    scheduled_date: Optional[str] = None
    completed: Optional[bool] = None
    notes: Optional[str] = None


class MoodCheckIn(BaseModel):
    energy: MoodLevel
    focus: MoodLevel
    mood: MoodLevel
    date: Optional[str] = None


class AIRequest(BaseModel):
    request_type: str  # "schedule", "suggestion", "reminder"
    context: Optional[dict] = None
    message: Optional[str] = None
