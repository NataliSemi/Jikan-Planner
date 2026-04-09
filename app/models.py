from pydantic import BaseModel, Field, model_validator
from typing import Optional, List
from enum import Enum
from datetime import datetime


class ActivityType(str, Enum):
    learning = "learning"
    reading = "reading"
    playing = "playing"
    work = "work"
    exercise = "exercise"
    rest = "rest"
    creative = "creative"
    social = "social"


class MoodLevel(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class ChecklistItem(BaseModel):
    text: str
    completed: bool = False


class RecurrenceRule(BaseModel):
    frequency: str = "weekly"
    weekdays: List[str] = Field(default_factory=list)


def _duration_from_times(start: Optional[str], end: Optional[str]) -> Optional[int]:
    if not start or not end:
        return None
    try:
        start_dt = datetime.strptime(start, "%H:%M")
        end_dt = datetime.strptime(end, "%H:%M")
    except ValueError:
        return None
    return int((end_dt - start_dt).total_seconds() // 60)


class Task(BaseModel):
    id: Optional[str] = None
    title: str
    activity_type: ActivityType
    duration_minutes: Optional[int] = None
    scheduled_time: Optional[str] = None  # HH:MM format
    end_time: Optional[str] = None  # HH:MM format
    scheduled_date: Optional[str] = None  # YYYY-MM-DD
    completed: bool = False
    notes: Optional[str] = None
    checklist: List[ChecklistItem] = Field(default_factory=list)
    recurrence: Optional[RecurrenceRule] = None
    completion_log: List[str] = Field(default_factory=list)
    created_at: Optional[str] = None

    @model_validator(mode="after")
    def validate_and_fill_duration(self):
        computed = _duration_from_times(self.scheduled_time, self.end_time)
        if self.duration_minutes is None and computed is not None:
            self.duration_minutes = computed

        if self.duration_minutes is None:
            raise ValueError("duration_minutes is required unless both scheduled_time and end_time are set")
        if self.duration_minutes <= 0:
            raise ValueError("duration_minutes must be a positive number")
        return self


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    activity_type: Optional[ActivityType] = None
    duration_minutes: Optional[int] = None
    scheduled_time: Optional[str] = None
    end_time: Optional[str] = None
    scheduled_date: Optional[str] = None
    completed: Optional[bool] = None
    notes: Optional[str] = None
    checklist: Optional[List[ChecklistItem]] = None
    completion_log: Optional[List[str]] = None
    instance_date: Optional[str] = None

    @model_validator(mode="after")
    def fill_duration_when_times_present(self):
        if self.duration_minutes is None:
            computed = _duration_from_times(self.scheduled_time, self.end_time)
            if computed is not None:
                self.duration_minutes = computed
        if self.duration_minutes is not None and self.duration_minutes <= 0:
            raise ValueError("duration_minutes must be a positive number")
        return self


class MoodCheckIn(BaseModel):
    energy: MoodLevel
    focus: MoodLevel
    mood: MoodLevel
    date: Optional[str] = None


class AIRequest(BaseModel):
    request_type: str  # "schedule", "suggestion", "reminder"
    context: Optional[dict] = None
    message: Optional[str] = None
