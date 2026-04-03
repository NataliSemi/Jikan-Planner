#!/usr/bin/env python3
"""
時間 Jikan Planner — Development entrypoint
Run with: python run.py
Or in Docker: docker-compose up --build
"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )
