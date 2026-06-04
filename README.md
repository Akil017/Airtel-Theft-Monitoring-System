<<<<<<< HEAD
# Airtel Theft Monitoring System

AI-powered telecom site intrusion detection using YOLOv8, FastAPI, PostgreSQL, and Next.js.

## Architecture

```
IP Camera / Webcam
       ↓  RTSP / cv2
Detection Service        (YOLOv8 inference)
       ↓  HTTP POST
Event Processor          (business rules: confidence, consecutive frames)
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
cp .env.example .env
# Edit .env — set SITE_ID, CAMERA_ID, RTSP_URL

cd docker
docker compose up --build
```

Dashboard → http://localhost:3000  
Alarm Manager API → http://localhost:8002/docs  
Event Processor API → http://localhost:8001/docs  

## Business Rules (Event Processor)

| Rule                        | Default | Env var                      |
|-----------------------------|---------|------------------------------|
| Minimum confidence          | 80%     | `MIN_CONFIDENCE`             |
| Consecutive detections      | 3       | `CONSECUTIVE_FRAMES_REQUIRED`|
| Restricted sites filter     | all     | `RESTRICTED_SITES`           |

## Alarm Severity Mapping

| Confidence | Severity |
|------------|----------|
| ≥ 90%      | CRITICAL |
| ≥ 75%      | MAJOR    |
| < 75%      | MINOR    |

## eNode Integration

Set `ENODE_API_URL` and `ENODE_API_KEY` in `.env`.  
The Alarm Manager will POST each validated alarm to eNode automatically.  
If not configured, alarms are stored in PostgreSQL and shown on the dashboard only.

## Future: Netcool

Add a `netcool-connector` service that consumes the Alarm Manager's REST API (`GET /alarms?status=ACTIVE`).  
No changes needed in detection, event processor, or alarm manager code.

## Folder Structure

```
airtel-theft-monitor/
├── detection-service/     # YOLOv8 + OpenCV
├── event-processor/       # FastAPI business rules
├── alarm-manager/         # FastAPI + PostgreSQL + WebSocket + eNode
├── dashboard/             # Next.js NOC UI
├── shared/                # Pydantic models (shared across services)
├── docker/                # docker-compose.yml
└── .env.example
```

## Internship Context

Built as part of Airtel Networks internship (Assam circle).  
Addresses real BTS site security issues: battery theft, diesel theft, cable theft, vandalism.
=======
# Airtel-Theft-Monitoring-System
Airtel theft monitoring system using cctv human movement + hooters to generate alarm 
>>>>>>> 61bfcd0006f57f72ac342547cd3591e7f8e48b00
