# Airtel BTS Theft Monitoring System

Real-time human intrusion detection for BTS (Base Transceiver Station) sites using YOLOv8, deployed as 4 independent microservices.

## Architecture

```
IP Camera (RTSP)
      ↓
Detection Service      ← YOLOv8 inference, person class filter
      ↓
Event Processor        ← Business rules (confidence, consecutive frames, restricted area)
      ↓
Alarm Manager          ← PostgreSQL persistence + WebSocket push + eNode REST
      ↓
NOC Dashboard          ← Next.js real-time alarm table (Vercel or Docker)
      ↓ (future)
Netcool Connector      ← GET /alarms?status=ACTIVE, no existing code changes needed
```

## Quick Start

### 1. Clone the repo
```bash
git clone https://github.com/Akil017/Airtel-Theft-Monitoring-System.git
cd Airtel-Theft-Monitoring-System
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env — at minimum set your RTSP_URL and CAMERA_ID
```

### 3. Run with Docker Compose
```bash
cd docker
docker compose up --build
```

| Service          | URL                          |
|------------------|------------------------------|
| Event Processor  | http://localhost:8001/docs   |
| Alarm Manager    | http://localhost:8002/docs   |
| NOC Dashboard    | http://localhost:3000        |
| PostgreSQL       | localhost:5432               |

## Service Overview

### Detection Service
- Reads RTSP stream with OpenCV
- Runs YOLOv8 inference every frame
- Filters: class = person, confidence ≥ `CONFIDENCE_THRESHOLD`
- Throttles events (max 1 per `THROTTLE_SECONDS` per camera)
- POSTs to Event Processor

### Event Processor (port 8001)
Business rules before raising an alarm:
1. **Confidence** ≥ `MIN_CONFIDENCE` (default 80%)
2. **Restricted area** — `SITE_ID` must be in `RESTRICTED_SITES`
3. **Consecutive frames** — ≥ `CONSECUTIVE_FRAMES` detections within `WINDOW_SECONDS`

### Alarm Manager (port 8002)
- Persists alarms to PostgreSQL
- Broadcasts new/updated alarms over WebSocket (`/ws`)
- Optionally POSTs to eNode REST API
- REST endpoints: `GET /alarms`, `POST /alarm`, `PATCH /alarms/{id}`

### Dashboard (port 3000)
- Dark NOC-style alarm table
- Live WebSocket feed — sub-second alarm arrival
- Filter by status (ACTIVE / ACKNOWLEDGED / CLEARED)
- Per-alarm Acknowledge and Clear actions

## Environment Variables

| Variable             | Default                        | Description                        |
|----------------------|--------------------------------|------------------------------------|
| `RTSP_URL`           | rtsp://...                     | Camera stream URL                  |
| `CAMERA_ID`          | CAM01                          | Camera identifier                  |
| `SITE_ID`            | BTS_SITE_001                   | Site identifier                    |
| `ZONE_ID`            | RESTRICTED_ZONE_A              | Zone within the site               |
| `MIN_CONFIDENCE`     | 0.80                           | Minimum confidence to raise alarm  |
| `CONSECUTIVE_FRAMES` | 3                              | Detections needed in window        |
| `WINDOW_SECONDS`     | 30                             | Sliding window duration            |
| `RESTRICTED_SITES`   | BTS_SITE_001,...               | Comma-separated restricted sites   |
| `ENODE_URL`          | (blank)                        | eNode base URL — leave blank to skip |
| `ENODE_API_KEY`      | (blank)                        | eNode API key                      |
| `DATABASE_URL`       | postgresql://airtel:...        | PostgreSQL connection string       |

## Deploy Dashboard to Vercel

1. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
2. Set **Root Directory** to `dashboard`
3. Add environment variable: `NEXT_PUBLIC_ALARM_MANAGER_URL=http://YOUR_SERVER_IP:8002`
4. Deploy

## Future Netcool Integration

Add a Netcool connector that polls:
```
GET http://alarm-manager:8002/alarms?status=ACTIVE
```
No changes to existing services required.

## File Structure

```
├── detection-service/
│   ├── detector.py
│   ├── requirements.txt
│   └── Dockerfile
├── event-processor/
│   ├── main.py
│   ├── requirements.txt
│   └── Dockerfile
├── alarm-manager/
│   ├── main.py
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
├── docker/
│   └── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```
