# Airtel BTS Theft Monitoring System

AI-powered restricted area intrusion detection for BTS sites.
Built during Airtel Networks internship — Assam circle.

---

## Architecture

```
CP Plus Camera (RTSP stream)
          |
 Detection Service (port 8003)
   - YOLOv8s inference
   - Person + animal detection
   - CP Plus hooter relay control
          |  HTTP POST
 Event Processor (port 8001)
   - Business rules
   - Confidence + consecutive frames
   - Restricted site filter
          |  HTTP POST
 Alarm Manager (port 8002)
   - PostgreSQL persistence
   - WebSocket broadcast
   - Hooter stop on CLEAR
   - eNode NOC integration
          |
    +-----+-----+
    |           |
 NOC Dashboard  eNode NOC Server (port 9000)
 (port 3000)    - Receives alarms from alarm-manager
 Next.js        - Operator clears from here
                - Deployable to Vercel
```

---

## Services

| Service | Port | Purpose |
|---------|------|---------|
| detection-service | 8003 | YOLOv8s + CP Plus hooter control |
| event-processor | 8001 | Business rules engine |
| alarm-manager | 8002 | PostgreSQL + WebSocket + eNode |
| dashboard | 3000 | Internal NOC (Next.js) |
| enode-noc | 9000 | eNode NOC server + dashboard |
| postgres | 5432 | Alarm database |

---

## Severity Logic

Any person in a BTS site = threat. No exceptions.

| Intruders | Severity | Threat | Hooter |
|-----------|----------|--------|--------|
| 1 person | HIGH | SINGLE INTRUDER | ON |
| 2 persons | HIGH | COORDINATED INTRUSION | ON |
| 3+ persons | CRITICAL | MASS INTRUSION | ON (louder pattern) |
| Animal only | HIGH | ANIMAL INTRUSION | OFF (NOC notified only) |

---

## CP Plus Integration

### RTSP Stream
```env
RTSP_URL=rtsp://admin:PASSWORD@CAMERA_IP:554/stream1
```

### Hooter Control
```env
CPPLUS_CAM_IP=192.168.1.64
CPPLUS_USER=admin
CPPLUS_PASS=your_password
HOOTER_DURATION_SECONDS=30
```

Leave `CPPLUS_CAM_IP` empty to disable hooter — system still works fully.

### Hooter Flow
```
Human detected by YOLO
    -> detection-service fires hooter relay ON
    -> hooter rings for HOOTER_DURATION_SECONDS
    -> auto-off after duration
    OR
    -> NOC operator clicks CLEAR
    -> alarm-manager calls detection-service /hooter/stop
    -> hooter off immediately
```

---

## eNode NOC Server

Runs on port 9000. Receives alarms from alarm-manager.
Operators can clear alarms from the eNode dashboard.

**Local:** http://localhost:9000
**Deploy to Vercel:** push `enode-noc/` folder to Vercel

Set in .env:
```env
ENODE_API_URL=http://enode-noc:9000
```

---

## Quick Start

```bash
git clone https://github.com/Akil017/Airtel-Theft-Monitoring-System.git
cd Airtel-Theft-Monitoring-System

cp .env.example .env
# Edit .env — set RTSP_URL, CPPLUS_CAM_IP, CAMERA_ID, SITE_ID

docker compose up --build
```

**URLs:**
| URL | Description |
|-----|-------------|
| http://localhost:3000 | Internal NOC Dashboard |
| http://localhost:9000 | eNode NOC Dashboard |
| http://localhost:8002/docs | Alarm Manager API |
| http://localhost:8001/docs | Event Processor API |
| http://localhost:8003/health | Detection Service health |

---

## Test Without Camera

```bash
# Send 3 events — 3rd one triggers alarm + hooter
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

Test hooter directly:
```bash
curl -X POST http://localhost:8003/hooter/test
```

---

## Configuration (.env)

```env
# Camera
CAMERA_ID=CAM-BTS-01
SITE_ID=AIRTEL-ASM-BTS-001
RTSP_URL=                            # leave empty for webcam

# CP Plus Hooter (fill in after site visit)
CPPLUS_CAM_IP=                       # 192.168.1.64
CPPLUS_USER=admin
CPPLUS_PASS=admin
HOOTER_DURATION_SECONDS=30

# YOLO
MODEL_PATH=yolov8s.pt
CONFIDENCE_THRESHOLD=0.45
INFERENCE_EVERY_N_FRAMES=3
DETECT_CLASSES=0,15,16,17,18,19,20,21,22,23

# Business rules
MIN_CONFIDENCE=0.45
CONSECUTIVE_FRAMES_REQUIRED=3

# eNode NOC
ENODE_API_URL=http://enode-noc:9000
ENODE_API_KEY=

# Database
DATABASE_URL=postgresql+asyncpg://airtel:airtel@postgres:5432/airtel_monitor
```

---

## Folder Structure

```
Airtel-Theft-Monitoring-System/
|-- detection-service/     YOLOv8s + hooter control (port 8003)
|-- event-processor/       Business rules (port 8001)
|-- alarm-manager/         PostgreSQL + WebSocket + eNode (port 8002)
|-- dashboard/             Internal NOC — Next.js (port 3000)
|-- enode-noc/             eNode NOC server + dashboard (port 9000)
|-- shared/                Pydantic models
|-- docker-compose.yml
|-- .env.example
+-- README.md
```

---

## VM Deployment Steps

```bash
# 1. SSH into VM
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

# 5. Check
docker compose ps
```

---

## Internship Context

Built during Airtel Networks internship — Assam circle.
BTS site threats: battery theft, diesel theft, cable theft, vandalism.
