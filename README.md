# Airtel Theft Monitoring System

AI-powered telecom site intrusion detection using YOLOv8, FastAPI, PostgreSQL, and Next.js.

## Architecture

```
IP Camera / Webcam
       ↓  RTSP / cv2
Detection Service        (YOLOv8 inference)
       ↓  HTTP POST
Event Processor          (business rules: confidence, consecutive frames, restricted sites)
       ↓  HTTP POST
Alarm Manager            (PostgreSQL + WebSocket broadcast + eNode REST)
       ↓  WebSocket
NOC Dashboard            (Next.js — Vercel or Docker)
       ↓  (future)
Netcool Integration      (plug in without touching detection code)
```

## Services & Ports

| Service           | Port | Tech              |
|-------------------|------|-------------------|
| Detection Service | —    | Python + YOLOv8   |
| Event Processor   | 8001 | FastAPI           |
| Alarm Manager     | 8002 | FastAPI + asyncpg |
| Dashboard         | 3000 | Next.js           |
| PostgreSQL        | 5432 | Postgres 16       |

## Quick Start

```bash
# 1. Copy env and edit your camera/site settings
cp .env.example .env

# 2. Build and run all services
docker compose up --build
```

- Dashboard → http://localhost:3000
- Alarm Manager API → http://localhost:8002/docs
- Event Processor API → http://localhost:8001/docs

## Business Rules (Event Processor)

| Rule                        | Default | Env var                        |
|-----------------------------|---------|--------------------------------|
| Minimum confidence          | 80%     | `MIN_CONFIDENCE`               |
| Consecutive detections      | 3       | `CONSECUTIVE_FRAMES_REQUIRED`  |
| Restricted sites filter     | all     | `RESTRICTED_SITES`             |

## Alarm Severity Mapping

| Confidence | Severity |
|------------|----------|
| ≥ 90%      | CRITICAL |
| ≥ 75%      | MAJOR    |
| < 75%      | MINOR    |

## eNode Integration

Set `ENODE_API_URL` and `ENODE_API_KEY` in `.env`.
The Alarm Manager will POST each validated alarm to eNode automatically.
Leave blank to skip — alarms are still stored in PostgreSQL and shown on the dashboard.

## Future: Netcool

Add a `netcool-connector` service that polls:
```
GET http://alarm-manager:8002/alarms?status=ACTIVE
```
No changes needed in any existing service.

## Folder Structure

```
airtel-theft-monitoring/
├── detection-service/
│   ├── detector.py          # YOLOv8 + OpenCV inference loop
│   ├── config.py            # Settings from .env
│   ├── requirements.txt
│   └── Dockerfile
├── event-processor/
│   ├── main.py              # FastAPI business rules
│   ├── config.py
│   ├── requirements.txt
│   └── Dockerfile
├── alarm-manager/
│   ├── main.py              # FastAPI + PostgreSQL + WebSocket + eNode
│   ├── config.py
│   ├── requirements.txt
│   └── Dockerfile
├── dashboard/
│   ├── app/
│   │   ├── page.jsx         # NOC alarm table
│   │   ├── layout.jsx
│   │   └── globals.css
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── Dockerfile
├── shared/
│   └── models.py            # Pydantic models shared across services
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

## Internship Context

Built as part of Airtel Networks internship (Assam circle).
Addresses real BTS site security: battery theft, diesel theft, cable theft, vandalism.
