import json
import uuid
from pathlib import Path
from datetime import datetime, date
from typing import List, Optional, Dict, Any

DATA_DIR = Path("/app/data")
TASKS_FILE = DATA_DIR / "tasks.json"
MOODS_FILE = DATA_DIR / "moods.json"


def _ensure_files():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not TASKS_FILE.exists():
        TASKS_FILE.write_text("[]")
    if not MOODS_FILE.exists():
        MOODS_FILE.write_text("[]")


def load_tasks() -> List[Dict]:
    _ensure_files()
    return json.loads(TASKS_FILE.read_text())


def save_tasks(tasks: List[Dict]):
    _ensure_files()
    TASKS_FILE.write_text(json.dumps(tasks, indent=2, ensure_ascii=False))


def load_moods() -> List[Dict]:
    _ensure_files()
    return json.loads(MOODS_FILE.read_text())


def save_moods(moods: List[Dict]):
    _ensure_files()
    MOODS_FILE.write_text(json.dumps(moods, indent=2, ensure_ascii=False))


def create_task(task_data: Dict) -> Dict:
    tasks = load_tasks()
    task_data["id"] = str(uuid.uuid4())[:8]
    task_data["created_at"] = datetime.now().isoformat()
    task_data["completed"] = False
    tasks.append(task_data)
    save_tasks(tasks)
    return task_data


def get_tasks(date_filter: Optional[str] = None) -> List[Dict]:
    tasks = load_tasks()
    if date_filter:
        tasks = [
            t for t in tasks
            if t.get("scheduled_date") == date_filter
            or (not t.get("scheduled_date") and date_filter == date.today().isoformat())
        ]
    return tasks


def get_task(task_id: str) -> Optional[Dict]:
    return next((t for t in load_tasks() if t["id"] == task_id), None)


def update_task(task_id: str, updates: Dict) -> Optional[Dict]:
    tasks = load_tasks()
    for i, task in enumerate(tasks):
        if task["id"] == task_id:
            # Use explicit None check — allow False, 0, empty string
            tasks[i].update({k: v for k, v in updates.items() if v is not None or k == "completed"})
            save_tasks(tasks)
            return tasks[i]
    return None


def delete_task(task_id: str) -> bool:
    tasks = load_tasks()
    new_tasks = [t for t in tasks if t["id"] != task_id]
    if len(new_tasks) < len(tasks):
        save_tasks(new_tasks)
        return True
    return False


def save_mood(mood_data: Dict) -> Dict:
    moods = load_moods()
    mood_data["date"] = mood_data.get("date") or date.today().isoformat()
    mood_data["timestamp"] = datetime.now().isoformat()
    # Replace today's mood if exists
    moods = [m for m in moods if m.get("date") != mood_data["date"]]
    moods.append(mood_data)
    save_moods(moods)
    return mood_data


def get_today_mood() -> Optional[Dict]:
    moods = load_moods()
    today = date.today().isoformat()
    return next((m for m in moods if m.get("date") == today), None)


def get_stats() -> Dict:
    tasks = load_tasks()
    completed = [t for t in tasks if t.get("completed")]
    by_type: Dict[str, int] = {}
    for t in completed:
        atype = t.get("activity_type", "other")
        by_type[atype] = by_type.get(atype, 0) + t.get("duration_minutes", 0)
    return {
        "total_tasks": len(tasks),
        "completed_tasks": len(completed),
        "minutes_by_type": by_type,
        "completion_rate": round(len(completed) / len(tasks) * 100) if tasks else 0,
    }
