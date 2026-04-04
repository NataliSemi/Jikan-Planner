import json
import uuid
from pathlib import Path
from datetime import datetime, date
from typing import List, Optional, Dict, Any

DATA_DIR = Path("/app/data")
TASKS_FILE = DATA_DIR / "tasks.json"
MOODS_FILE = DATA_DIR / "moods.json"
WEEKDAY_MAP = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


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


def _matches_weekday(task: Dict, target_date: str) -> bool:
    recurrence = task.get("recurrence") or {}
    if recurrence.get("frequency") != "weekly":
        return False
    weekdays = [d.lower() for d in recurrence.get("weekdays", [])]
    if not weekdays:
        return False
    try:
        day_idx = date.fromisoformat(target_date).weekday()
    except ValueError:
        return False
    return any(WEEKDAY_MAP.get(day) == day_idx for day in weekdays)


def _expand_task_for_date(task: Dict, target_date: str) -> Dict:
    expanded = task.copy()
    expanded["instance_date"] = target_date
    expanded["source_task_id"] = task["id"]
    expanded["id"] = f"{task['id']}@{target_date}"
    expanded["completed"] = target_date in task.get("completion_log", [])
    return expanded


def get_tasks(date_filter: Optional[str] = None) -> List[Dict]:
    tasks = load_tasks()
    if date_filter:
        filtered = []
        for task in tasks:
            if task.get("scheduled_date") == date_filter:
                filtered.append(task)
            elif task.get("recurrence") and _matches_weekday(task, date_filter):
                filtered.append(_expand_task_for_date(task, date_filter))
            elif not task.get("scheduled_date") and not task.get("recurrence") and date_filter == date.today().isoformat():
                filtered.append(task)
        tasks = filtered
    return tasks


def get_task(task_id: str) -> Optional[Dict]:
    if "@" in task_id:
        base_id, instance_date = task_id.split("@", 1)
        base_task = next((t for t in load_tasks() if t["id"] == base_id), None)
        if base_task and base_task.get("recurrence") and _matches_weekday(base_task, instance_date):
            return _expand_task_for_date(base_task, instance_date)
        return None
    return next((t for t in load_tasks() if t["id"] == task_id), None)


def update_task(task_id: str, updates: Dict) -> Optional[Dict]:
    tasks = load_tasks()
    base_id = task_id.split("@", 1)[0] if "@" in task_id else task_id
    instance_date = updates.get("instance_date") or (task_id.split("@", 1)[1] if "@" in task_id else None)
    for i, task in enumerate(tasks):
        if task["id"] == base_id:
            if task.get("recurrence") and updates.get("completed") is True and instance_date:
                completion_log = set(task.get("completion_log", []))
                completion_log.add(instance_date)
                tasks[i]["completion_log"] = sorted(completion_log)
            elif task.get("recurrence") and updates.get("completed") is False and instance_date:
                tasks[i]["completion_log"] = [d for d in task.get("completion_log", []) if d != instance_date]
            # Use explicit None check — allow False, 0, empty string
            safe_updates = {k: v for k, v in updates.items() if v is not None or k == "completed"}
            safe_updates.pop("instance_date", None)
            if not task.get("recurrence"):
                tasks[i].update(safe_updates)
            else:
                # Recurring templates persist completion in completion_log;
                # avoid overriding template-level completed boolean.
                safe_updates.pop("completed", None)
                tasks[i].update(safe_updates)
            save_tasks(tasks)
            if task.get("recurrence") and instance_date:
                return _expand_task_for_date(tasks[i], instance_date)
            return tasks[i]
    return None


def delete_task(task_id: str) -> bool:
    tasks = load_tasks()
    base_id = task_id.split("@", 1)[0] if "@" in task_id else task_id
    new_tasks = [t for t in tasks if t["id"] != base_id]
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
