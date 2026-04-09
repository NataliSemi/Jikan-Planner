# 時間 Jikan Planner

> *一日一歩 — One day, one step.*

A traditional Japanese-inspired time planner with AI guidance, built with **FastAPI** and powered by **Claude AI** (時間先生 · Jikan Sensei).

---

## Features

- **📅 Daily Planning** — Schedule tasks across learning, reading, playing, work, exercise, rest, creative, and social activities
- **🤖 AI Sensei** — Powered by Claude, gives you schedule recommendations, activity suggestions based on your mood, and gentle motivational reminders
- **気分 Mood Check-in** — Track your daily energy, focus, and emotional state
- **📊 Progress Stats** — Visual breakdown of time spent by activity type
- **🗾 Traditional Japanese UI** — Washi paper texture, sumi ink palette, Shippori Mincho typography, cinnabar seal accents

---

## Quick Start with Docker

### 1. Clone / copy project files

```bash
# Copy project to your machine
cd jikan-planner
```

### 2. Set up your API key

```bash
cp .env.example .env
# Edit .env and add your Anthropic API key:
# ANTHROPIC_API_KEY=sk-ant-...
```

Get your API key at: https://console.anthropic.com

### 3. Build and run

```bash
docker-compose up --build
```

### 4. Open the app

```
http://localhost:8000
```

---

## Running Without Docker

```bash
# Install dependencies
pip install -r requirements.txt

# Set API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run (from project root)
python run.py
```

---

## Project Structure

```
jikan-planner/
├── app/
│   ├── main.py           # FastAPI app, routes setup
│   ├── models.py         # Pydantic data models
│   ├── store.py          # JSON file-based data persistence
│   └── routes/
│       ├── tasks.py      # CRUD API for tasks
│       └── ai_advisor.py # AI endpoints (schedule, suggest, remind, chat)
├── static/
│   ├── css/style.css     # Traditional Japanese stylesheet
│   └── js/app.js         # Frontend SPA logic
├── templates/
│   └── index.html        # Jinja2 HTML template
├── data/                 # Persisted JSON data (mounted as Docker volume)
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── run.py                # Dev entrypoint
```

---

## API Reference

Auto-generated docs available at: `http://localhost:8000/docs`

### Tasks
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks/` | List all tasks |
| GET | `/api/tasks/today` | Today's tasks |
| POST | `/api/tasks/` | Create task |
| PATCH | `/api/tasks/{id}` | Update task |
| DELETE | `/api/tasks/{id}` | Delete task |
| GET | `/api/tasks/stats` | Progress stats |

### AI Sensei
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai/mood` | Save mood check-in |
| GET | `/api/ai/mood/today` | Get today's mood |
| POST | `/api/ai/schedule` | Get schedule recommendation |
| POST | `/api/ai/suggest` | Get activity suggestions |
| POST | `/api/ai/remind` | Get gentle reminder |
| POST | `/api/ai/chat` | Free chat with Sensei |

---

## Activity Types

| Type | 日本語 | Description |
|------|--------|-------------|
| `learning` | 学習 | Studying, courses, skill building |
| `reading` | 読書 | Books, articles, research |
| `playing` | 遊び | Games, hobbies, fun |
| `work` | 仕事 | Job shifts, office blocks, focused work sessions |
| `exercise` | 運動 | Physical activity, sport, yoga |
| `rest` | 休息 | Naps, meditation, downtime |
| `creative` | 創造 | Art, writing, music, making |
| `social` | 交流 | Friends, family, community |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | **FastAPI** (Python 3.12) |
| AI | **Anthropic Claude** (claude-sonnet-4) |
| Templates | **Jinja2** |
| Data | JSON flat-file store |
| Container | **Docker** + Docker Compose |
| Fonts | Shippori Mincho, Noto Serif JP |

---

## Why FastAPI?

FastAPI was chosen over Flask and Django because:
- **Async-native** — perfect for AI API calls without blocking requests
- **Automatic API docs** — Swagger UI at `/docs` out of the box
- **Pydantic models** — clean data validation with no extra code
- **Production performance** — built on Starlette, handles concurrent requests efficiently
- **Type-safe** — Python type hints throughout, easier to maintain

---

*万物は流転する — All things are in flux. Plan wisely.*
