# Airtel BTS Theft & Intrusion Monitoring System

AI-powered restricted-area intrusion detection for unmanned BTS towers — built
during an Airtel Networks internship, NESA Circle (Assam).

A 4G CCTV camera streams live video to a cloud server, where a YOLOv8 model
distinguishes human intruders from animals in real time, triggers an on-site
hooter, and pushes alerts to a NOC dashboard, Telegram, and a NOC ticketing
service — all running as containerized microservices.

---

## Table of Contents

- [Why This Exists](#why-this-exists)
- [Architecture](#architecture)
- [Services](#services)
- [Severity & Detection Logic](#severity--detection-logic)
- [Camera Integration](#camera-integration)
- [Hooter Control](#hooter-control)
- [Quick Start](#quick-start)
- [Configuration](#configuration-env)
- [Testing Without a Camera](#testing-without-a-camera)
- [Folder Structure](#folder-structure)
- [VM Deployment](#vm-deployment)
- [Known Limitations](#known-limitations)
- [Internship Context](#internship-context)

---

## Why This Exists

BTS towers are frequently unmanned and remote — exactly the conditions that
make them targets for cable theft, battery theft, diesel-generator theft, and
vandalism. Traditional security relies on periodic manual patrols, meaning
theft is often discovered hours or days after the fact, with no evidence
trail. This system replaces that with continuous, automated visual monitoring
and instant alerting.

---

## Architecture

The camera in this deployment is 4G-only with no public IP — it sits behind
carrier-grade NAT, so it cannot accept an inbound connection. Instead of
pulling video from the camera, the camera **pushes** an RTMP stream outward to
a cloud VM, which every other service then pulls from:

```
CP Plus Camera (4G, no public IP)
        |  pushes RTMP outbound
        v
 RTMP Server — nginx-rtmp (port 1935 / 8080)
        |  pulled via an ffmpeg subprocess pipe
        v                (OpenCV's native FFMPEG backend proved
 Detection Service         unreliable against live RTMP — replaced
   - YOLOv8s inference     with a direct ffmpeg pipe for reliability)
   - Person + animal detection
   - CP Plus hooter relay control
        |  HTTP POST
        v
 Event Processor (port 8001)
   - Confidence threshold + consecutive-frame confirmation
   - Restricted-site filter
   - Severity / threat-level classification
        |  HTTP POST
        v
 Alarm Manager (port 8002)
   - PostgreSQL persistence
   - WebSocket broadcast to the dashboard
   - Hooter stop command on CLEAR
   - Forwards to the NOC ticketing service (optional)
        |
   +----+----+
   |         |
 NOC Dashboard   NOC Ticketing Service
 (port 3000)     (port 9000)
 Next.js         - Receives alarms from alarm-manager
                 - Operators can clear alarms from here
                 - Included as a self-contained prototype,
                   deployable independently (e.g. to Vercel)
```

---

## Services

| Service | Port | Purpose |
|---|---|---|
| `rtmp-server` | 1935 (RTMP), 8080 (HLS/stat) | Receives the camera's outbound RTMP push, re-serves it to every consumer |
| `detection-service` | 8003 | YOLOv8s inference over an ffmpeg-piped RTMP read; CP Plus hooter relay control |
| `event-processor` | 8001 | Confidence/consecutive-frame business rules, severity classification |
| `alarm-manager` | 8002 | PostgreSQL persistence, WebSocket broadcast, hooter-stop dispatch, NOC ticketing hook |
| `dashboard` | 3000 | Operator-facing NOC dashboard (Next.js) |
| `enode-noc` | 9000 | Included NOC ticketing prototype — receives and displays alarms independently of the main dashboard |
| `postgres` | 5432 | Alarm history and state |

---

## Severity & Detection Logic

YOLOv8s runs on every third frame and classifies ten categories — a person,
plus nine animal classes. Only **human** detections above the confidence
threshold, that also pass the consecutive-frame and restricted-site checks,
ever become an alarm:

| Detection | Result |
|---|---|
| 1 person | **HIGH** severity — `SINGLE INTRUDER` — hooter ON |
| 2 persons | **HIGH** severity — `COORDINATED INTRUSION` — hooter ON |
| 3+ persons | **CRITICAL** severity — `MASS INTRUSION` — hooter ON (escalated pattern) |
| Animal only (no person) | Logged for audit only — **no alarm is raised, no hooter, no NOC notification** |

This asymmetry is deliberate: animals should never wake up a NOC operator or
ring the hooter, but every detection is still logged so the history can be
audited later if needed.

---

## Camera Integration

### Stream ingestion

The camera pushes RTMP to the server; nothing pulls from the camera directly.
On the camera side (EzyLiv+ or equivalent app), set the RTMP push target to:

```
rtmp://<your-server-ip>:1935/live/<stream-key>
```

The detection service then reads that same stream. Despite the variable name
below being a legacy holdover from an earlier RTSP-based design, it now holds
the RTMP URL:

```env
RTSP_URL=rtmp://rtmp-server:1935/live/bts01
```

### Hooter control

```env
CPPLUS_CAM_IP=192.168.1.64
CPPLUS_USER=admin
CPPLUS_PASS=your_password
HOOTER_DURATION_SECONDS=30
```

Leave `CPPLUS_CAM_IP` empty to disable hooter control entirely — detection,
alerting, and the dashboard all continue to work fully without it.

### Hooter flow

```
Human detected by YOLO
    -> detection-service fires the hooter relay ON
    -> hooter rings for HOOTER_DURATION_SECONDS
    -> auto-off after duration
    OR
    -> NOC operator clicks Clear
    -> alarm-manager calls detection-service's /hooter/stop
    -> hooter stops immediately
```

---

## Quick Start

```bash
git clone https://github.com/Akil017/Airtel-Theft-Monitoring-System.git
cd Airtel-Theft-Monitoring-System

cp .env.example .env
# edit .env — set CAMERA_ID, SITE_ID, RTSP_URL (RTMP target), CPPLUS_CAM_IP

docker compose up --build -d
```

| URL | Description |
|---|---|
| `http://localhost:3000` | NOC Dashboard |
| `http://localhost:9000` | NOC Ticketing prototype |
| `http://localhost:8002/docs` | Alarm Manager API (FastAPI docs) |
| `http://localhost:8001/docs` | Event Processor API (FastAPI docs) |
| `http://localhost:8003/health` | Detection Service health check |
| `http://localhost:8080/stat` | RTMP server stream stats |

---

## Configuration (`.env`)

```env
# Camera
CAMERA_ID=CAM-BTS-01
SITE_ID=AIRTEL-ASM-BTS-001
RTSP_URL=                            # RTMP target, e.g. rtmp://rtmp-server:1935/live/bts01

# CP Plus hooter (fill in after a site visit)
CPPLUS_CAM_IP=                       # e.g. 192.168.1.64 — leave empty to disable
CPPLUS_USER=admin
CPPLUS_PASS=admin
HOOTER_DURATION_SECONDS=30

# YOLO
MODEL_PATH=yolov8s.pt
CONFIDENCE_THRESHOLD=0.45
INFERENCE_EVERY_N_FRAMES=3
DETECT_CLASSES=0,15,16,17,18,19,20,21,22,23

# Business rules (event-processor)
MIN_CONFIDENCE=0.45                  # keep in sync with CONFIDENCE_THRESHOLD above
CONSECUTIVE_FRAMES_REQUIRED=3

# NOC ticketing integration (optional)
ENODE_API_URL=http://enode-noc:9000
ENODE_API_KEY=

# Database
DATABASE_URL=postgresql+asyncpg://airtel:airtel@postgres:5432/airtel_monitor
```

> **Note:** `CONFIDENCE_THRESHOLD` (detector) and `MIN_CONFIDENCE`
> (event-processor) are two independent settings enforced in two different
> services. If they drift out of sync, the event-processor can silently
> reject detections the detector already accepted — keep them equal unless
> you deliberately want a stricter second gate.

---

## Testing Without a Camera

```bash
# send 3 events — the 3rd crosses CONSECUTIVE_FRAMES_REQUIRED and raises an alarm
for i in 1 2 3; do
  curl -s -X POST http://localhost:8001/events/detection \
    -H "Content-Type: application/json" \
    -d '{
      "camera_id":  "CAM-BTS-01",
      "site_id":    "AIRTEL-ASM-BTS-001",
      "event_type": "HUMAN_DETECTED",
      "confidence": 0.92,
      "label":      "Person",
      "timestamp":  "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
    }' && sleep 1
done
```

Test the hooter relay directly, independent of detection:

```bash
curl -X POST http://localhost:8003/hooter/test
```

---

## Folder Structure

```
Airtel-Theft-Monitoring-System/
├── rtmp-server/          nginx-rtmp — camera ingestion (ports 1935, 8080)
├── detection-service/    YOLOv8s + hooter control (port 8003)
├── event-processor/      Business rules engine (port 8001)
├── alarm-manager/        PostgreSQL + WebSocket + NOC hook (port 8002)
├── dashboard/            NOC dashboard — Next.js (port 3000)
├── enode-noc/            NOC ticketing prototype (port 9000)
├── shared/               Shared Pydantic models
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## VM Deployment

```bash
# 1. SSH into the VM
ssh ubuntu@YOUR_VM_IP

# 2. Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 3. Clone and configure
git clone https://github.com/Akil017/Airtel-Theft-Monitoring-System.git
cd Airtel-Theft-Monitoring-System
cp .env.example .env
nano .env   # set your values

# 4. Run
docker compose up --build -d

# 5. Verify
docker compose ps
```

---

## Known Limitations

- Single-site pilot deployment — not yet load-tested across multiple towers.
- No TLS on the backend by default; a public dashboard deployment (e.g.
  Vercel) needs an HTTPS-capable tunnel or reverse proxy in front of the
  backend, since browsers block mixed HTTP/WS content from an HTTPS page.
- The NOC ticketing service (`enode-noc`) is a self-built prototype
  demonstrating the escalation pattern, not an integration with an existing
  external enterprise NOC system.
- No automatic reconnect/backoff tuning beyond basic retry loops if the
  camera's 4G connection drops mid-stream.

---

## Internship Context

Built during an Airtel Networks internship, NESA Circle (Assam), May–July 2026.
Motivated by a well-known industry problem: passive infrastructure theft —
cables, batteries, and diesel from generator sets — at remote, unmanned BTS
sites.
