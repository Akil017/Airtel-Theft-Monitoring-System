# Airtel BTS Theft Monitoring System

AI-powered telecom site intrusion detection using YOLOv8, FastAPI, PostgreSQL, and Next.js.  
Built during Airtel Networks internship — Assam circle.

---

## Project Structure

This project has two parts:

| Part | What it is | When to use |
|------|-----------|-------------|
| `demo.py` | Standalone webcam demo | Show to teacher, quick proof of concept |
| Full system (4 services) | Production-grade microservices | Full deployment on VM/server |

---

## Part 1 — Quick Demo (demo.py)

No Docker. No database. No setup. Just Python + webcam.

### Install

```bash
pip install ultralytics opencv-python
```

### Run

```bash
python demo.py
```

### What you'll see
- Live webcam feed with bounding boxes around detected people
- Detection window indicator (fills up over consecutive frames)
- Flashing **INTRUSION ALARM** overlay when triggered
- Alarm count and FPS in the corner
- Every alarm saved to `demo_alarms.csv`
- Press **Q** to quit

### How it works
1. Opens your webcam
2. Runs YOLOv8 on every frame — only looks for `person` class
3. Needs 3 consecutive frames with ≥ 55% confidence before alarm fires
4. Alarm clears automatically when person leaves frame

---

## Part 2 — Full System (4 Microservices)

### Architecture

```
IP Camera / Webcam
         ↓
 Detection Service       ← YOLOv8 inference, person filter, throttle
         ↓  HTTP POST
 Event Processor         ← Business rules: confidence + consecutive frames + restricted site
         ↓  HTTP POST
 Alarm Manager           ← PostgreSQL + WebSocket broadcast + eNode REST
         ↓  WebSocket
 NOC Dashboard           ← Next.js real-time alarm table
         ↓  (future)
 Netcool Connector        ← No existing code changes needed
```

### Services

| Service | Port | Technology | Responsibility |
|---------|------|------------|----------------|
| Detection Service | — | Python, YOLOv8, OpenCV | Read stream, run inference |
| Event Processor | 8001 | FastAPI | Business rules, false alarm filter |
| Alarm Manager | 8002 | FastAPI, asyncpg | PostgreSQL + WebSocket + eNode |
| NOC Dashboard | 3000 | Next.js, Tailwind | Real-time alarm table |
| PostgreSQL | 5432 | Postgres 16 | Alarm persistence |

### Run

```bash
cp .env.example .env
# Edit .env — set CAMERA_ID, SITE_ID, RTSP_URL

docker compose up --build
```

### Service URLs

| URL | Description |
|-----|-------------|
| http://localhost:3000 | NOC Dashboard |
| http://localhost:8002/docs | Alarm Manager API |
| http://localhost:8001/docs | Event Processor API |

---

## Configuration (.env)

```env
# Camera
CAMERA_ID=CAM01
SITE_ID=AIRTEL_ASM_001
RTSP_URL=                           # leave empty to use webcam

# YOLO
MODEL_PATH=yolov8n.pt
CONFIDENCE_THRESHOLD=0.70
INFERENCE_EVERY_N_FRAMES=5
EVENT_THROTTLE_SECONDS=2.0

# Business rules
MIN_CONFIDENCE=0.80
CONSECUTIVE_FRAMES_REQUIRED=3
RESTRICTED_SITES=                   # comma-separated; empty = all sites

# eNode (leave blank to skip)
ENODE_API_URL=
ENODE_API_KEY=

# Database
DATABASE_URL=postgresql+asyncpg://airtel:airtel@postgres:5432/airtel_monitor
```

---

## Business Rules (False Alarm Prevention)

| Rule | Default | Purpose |
|------|---------|---------|
| Confidence ≥ MIN_CONFIDENCE | 80% | Filters low-quality detections |
| Consecutive frames ≥ N | 3 | Eliminates shadows, reflections, animals |
| Site in restricted list | all | Only alarms on monitored sites |

---

## Alarm Severity

| Confidence | Severity |
|------------|----------|
| ≥ 90% | CRITICAL |
| ≥ 75% | MAJOR |
| < 75% | MINOR |

---

## Folder Structure

```
Airtel-Theft-Monitoring-System/
├── demo.py                  ← standalone demo for presentations
├── detection-service/
│   ├── detector.py
│   ├── config.py
│   ├── requirements.txt
│   └── Dockerfile
├── event-processor/
│   ├── main.py
│   ├── config.py
│   ├── requirements.txt
│   └── Dockerfile
├── alarm-manager/
│   ├── main.py
│   ├── config.py
│   ├── requirements.txt
│   └── Dockerfile
├── dashboard/
│   ├── app/
│   │   ├── page.jsx
│   │   ├── layout.jsx
│   │   └── globals.css
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── Dockerfile
├── shared/
│   └── models.py
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

---

## Tech Stack Justification

| Decision | Why |
|----------|-----|
| YOLOv8 over motion detection | Class-filtered — only `person` triggers alarms, not wind/animals/shadows |
| FastAPI over Flask | Async by default — WebSocket and DB writes happen simultaneously |
| WebSocket over polling | Sub-second alarm delivery instead of 5-second refresh cycles |
| 4-layer separation | Each service is independently deployable and replaceable |
| PostgreSQL | Structured alarm records — SQL is the right fit |
| Docker Compose | Each service restarts independently |

---

## Roadmap

- [ ] Multi-camera support (threaded detection, one thread per stream)
- [ ] Redis message queue between detection and event processor
- [ ] GPU-accelerated inference for higher throughput
- [ ] Snapshot capture on alarm (save frame as image)
- [ ] Netcool connector service
- [ ] Camera health monitoring (stream-down alerts)

---

## Internship Context

Built as part of Airtel Networks internship — Assam circle.  
Addresses real BTS site security threats: battery theft, diesel theft, cable theft, vandalism.
