# Airtel BTS Theft Monitoring System

AI-powered restricted area intrusion detection for BTS (Base Transceiver Station) sites.  
Built during Airtel Networks internship — Assam circle.

Detects **humans and animals** in restricted zones. Any presence = alarm.

---

## Project Structure

| Part | What it is | When to use |
|------|-----------|-------------|
| `demo.py` | Standalone Iron Man HUD demo | Presentation, offline proof of concept |
| Full system (4 services) | Production microservices via Docker | Server / VM deployment |

---

## Part 1 — Demo (demo.py)

No Docker. No database. Just Python + webcam.

```bash
pip install ultralytics opencv-python openpyxl numpy
python demo.py
```

**Features:**
- Iron Man / JARVIS style HUD overlay
- Detects persons + animals (dog, cat, cow, horse, elephant, bear...)
- Numbered target lock — `TGT-01 PERSON`, `TGT-02 DOG`
- Severity: 1-2 intruders = HIGH | 3+ = CRITICAL
- Alarm sound — different pattern for HIGH vs CRITICAL
- Auto snapshot saved to `snapshots/` on every alarm
- Full colour-coded Excel log (`demo_alarms.xlsx`)
- Press S = manual screenshot | Q = quit

---

## Part 2 — Full System (4 Microservices)

### Architecture

```
IP Camera / Webcam (RTSP or /dev/video0)
           |
  Detection Service     <- YOLOv8s inference, person + animal detection
           |  HTTP POST
  Event Processor       <- Business rules: confidence, consecutive frames, restricted site
           |  HTTP POST
  Alarm Manager         <- PostgreSQL + WebSocket broadcast + eNode REST
           |  WebSocket
  NOC Dashboard         <- Next.js real-time alarm table
           |  (future)
  Netcool Connector     <- GET /alarms?status=ACTIVE, no code changes needed
```

### Services

| Service | Port | Technology | Responsibility |
|---------|------|------------|----------------|
| Detection Service | — | Python, YOLOv8s, OpenCV | Read stream, detect persons + animals |
| Event Processor | 8001 | FastAPI | Business rules, false alarm filter |
| Alarm Manager | 8002 | FastAPI, asyncpg | PostgreSQL + WebSocket + eNode |
| NOC Dashboard | 3000 | Next.js, Tailwind | Real-time alarm table with threat info |
| PostgreSQL | 5432 | Postgres 16 | Alarm persistence |

### Severity Logic (matches demo exactly)

| Intruders in Frame | Severity | Threat Level |
|--------------------|----------|-------------|
| 1 | HIGH | SINGLE INTRUDER |
| 2 | HIGH | COORDINATED INTRUSION |
| 3+ | CRITICAL | MASS INTRUSION |
| Animals only | HIGH | ANIMAL INTRUSION |

### NOC Dashboard Columns

Status · Severity · Threat Level · Site · Camera · Persons · Animals · Confidence · Time · Response Required · Actions

---

## Quick Start (VM / Server)

```bash
# 1. Clone
git clone https://github.com/Akil017/Airtel-Theft-Monitoring-System.git
cd Airtel-Theft-Monitoring-System

# 2. Configure
cp .env.example .env
# Edit .env — set CAMERA_ID, SITE_ID, RTSP_URL (leave blank for webcam)

# 3. Build and run
docker compose up --build

# 4. Access
# Dashboard  -> http://localhost:3000
# Alarm API  -> http://localhost:8002/docs
# Event API  -> http://localhost:8001/docs
```

### Webcam on Linux VM

Uncomment this in `docker-compose.yml` under `detection-service`:

```yaml
devices:
  - /dev/video0:/dev/video0
```

---

## Configuration (.env)

```env
# Camera
CAMERA_ID=CAM-BTS-01
SITE_ID=AIRTEL-ASM-BTS-001
RTSP_URL=                           # leave empty for webcam

# YOLO
MODEL_PATH=yolov8s.pt               # or yolov8n.pt for faster/lighter
CONFIDENCE_THRESHOLD=0.45
INFERENCE_EVERY_N_FRAMES=3

# Detection classes (COCO IDs)
DETECT_CLASSES=0,15,16,17,18,19,20,21,22,23

# Business rules
MIN_CONFIDENCE=0.45
CONSECUTIVE_FRAMES_REQUIRED=3
RESTRICTED_SITES=                   # empty = all sites

# eNode (leave blank to skip)
ENODE_API_URL=
ENODE_API_KEY=

# Database
DATABASE_URL=postgresql+asyncpg://airtel:airtel@postgres:5432/airtel_monitor
```

---

## Folder Structure

```
Airtel-Theft-Monitoring-System/
|-- demo.py                      <- Iron Man HUD demo (standalone)
|-- docker-compose.yml
|-- .env.example
|-- .gitignore
|-- README.md
|-- LICENSE
|
|-- detection-service/
|   |-- detector.py              <- YOLOv8s inference loop, person + animal
|   |-- config.py
|   |-- requirements.txt
|   +-- Dockerfile
|
|-- event-processor/
|   |-- main.py                  <- Business rules engine
|   |-- config.py
|   |-- requirements.txt
|   +-- Dockerfile
|
|-- alarm-manager/
|   |-- main.py                  <- FastAPI + PostgreSQL + WebSocket + eNode
|   |-- config.py
|   |-- requirements.txt
|   +-- Dockerfile
|
|-- dashboard/
|   |-- app/
|   |   |-- page.jsx             <- NOC alarm table, real-time via WebSocket
|   |   |-- layout.jsx
|   |   +-- globals.css
|   |-- package.json
|   |-- next.config.js
|   |-- tailwind.config.js
|   |-- postcss.config.js
|   +-- Dockerfile
|
+-- shared/
    +-- models.py                <- Pydantic models shared across services
```

---

## Tech Stack

| Choice | Why |
|--------|-----|
| YOLOv8s | Better accuracy than nano, still fast on CPU |
| Persons + Animals | Any living presence in BTS = security threat |
| FastAPI | Async — WebSocket and DB writes simultaneously |
| WebSocket | Sub-second alarm delivery to dashboard |
| 4-layer separation | Each service independently deployable |
| PostgreSQL | Structured relational alarm records |
| Docker Compose | Independent restarts, easy upgrades |

---

## Roadmap

- [ ] Multi-camera threading (one thread per RTSP stream)
- [ ] Redis queue between detection and event processor
- [ ] GPU-accelerated YOLOv8 inference
- [ ] Snapshot upload to alarm record
- [ ] Netcool connector service
- [ ] Camera health / stream-down alerts

---

## Internship Context

Built during Airtel Networks internship — Assam circle.  
Addresses real BTS site security threats: battery theft, diesel theft, cable theft, vandalism.
