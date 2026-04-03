from fastapi import APIRouter, HTTPException
from typing import Optional
from app.models import Task, TaskUpdate
from app import store

router = APIRouter()


@router.get("/")
async def list_tasks(date: Optional[str] = None):
    """List all tasks, optionally filtered by date (YYYY-MM-DD)"""
    return store.get_tasks(date_filter=date)


@router.post("/")
async def create_task(task: Task):
    """Create a new task"""
    return store.create_task(task.model_dump(exclude_none=True))


@router.get("/stats")
async def get_stats():
    """Get completion stats"""
    return store.get_stats()


@router.get("/today")
async def get_today_tasks():
    """Get today's tasks"""
    from datetime import date
    today = date.today().isoformat()
    return store.get_tasks(date_filter=today)


@router.get("/{task_id}")
async def get_task(task_id: str):
    task = store.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.patch("/{task_id}")
async def update_task(task_id: str, updates: TaskUpdate):
    task = store.update_task(task_id, updates.model_dump(exclude_none=True))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.delete("/{task_id}")
async def delete_task(task_id: str):
    success = store.delete_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"message": "削除しました", "deleted": True}
