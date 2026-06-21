"""
Detection Service
-----------------
Reads RTSP / webcam stream, runs YOLOv8s inference.
Detects persons AND animals, posts events to Event Processor.
Runs a small FastAPI control server on port 8003 for hooter stop commands.

CP Plus Hooter Logic:
  - Human detected  -> hooter ON (rings for HOOTER_DURATION_SECONDS)
  - Animal detected -> NO hooter, still logged to NOC for investigation
  - NOC clears alarm -> alarm-manager calls POST /hooter/stop -> hooter OFF immediately
"""
import cv2, time, logging, httpx, asyncio, threading
from ultralytics import YOLO
from datetime import datetime, timezone
from config import settings

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [DETECTOR] %(levelname)s: %(message)s")
log = logging.getLogger(__name__)

ANIMAL_CLASSES = {
    15:"Cat", 16:"Dog",      17:"Horse",  18:"Sheep",
    19:"Cow", 20:"Elephant", 21:"Bear",   22:"Zebra", 23:"Giraffe"
}
DETECT_CLASSES = [int(c) for c in settings.DETECT_CLASSES.split(",")]


# ── CP Plus Hooter Controller ─────────────────────────────────────────────────
class HooterController:
    """
    Controls CP Plus camera digital output relay (hooter/siren).

    CP Plus CGI relay endpoint:
      GET http://<cam-ip>/cgi-bin/alarmOut.cgi
          ?action=setAlarm&channel=0&AlarmType=0&status=<1|0>
      Auth: HTTP Basic (camera admin credentials)

    status=1 -> relay ON  -> hooter rings
    status=0 -> relay OFF -> hooter stops

    Set CPPLUS_CAM_IP, CPPLUS_USER, CPPLUS_PASS in .env
    Leave CPPLUS_CAM_IP empty to disable hooter entirely.
    """

    def __init__(self):
        self.cam_ip   = settings.CPPLUS_CAM_IP
        self.user     = settings.CPPLUS_USER
        self.password = settings.CPPLUS_PASS
        self.duration = settings.HOOTER_DURATION_SECONDS
        self._task    = None
        self.enabled  = bool(self.cam_ip)
        self._loop    = None   # set after event loop starts

        if self.enabled:
            log.info(f"Hooter controller ready -> {self.cam_ip}")
        else:
            log.info("Hooter disabled (CPPLUS_CAM_IP not set — set in .env when camera available)")

    def _relay_url(self, status: int) -> str:
        return (
            f"http://{self.cam_ip}/cgi-bin/alarmOut.cgi"
            f"?action=setAlarm&channel=0&AlarmType=0&status={status}"
        )

    async def _set_relay(self, status: int):
        if not self.enabled:
            return
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.get(
                    self._relay_url(status),
                    auth=(self.user, self.password)
                )
            label = "ON" if status == 1 else "OFF"
            log.info(f"Hooter relay {label} -> HTTP {r.status_code}")
        except Exception as e:
            log.warning(f"Hooter relay command failed: {e}")

    async def _ring_and_auto_stop(self):
        await self._set_relay(1)
        await asyncio.sleep(self.duration)
        await self._set_relay(0)
        log.info(f"Hooter auto-stopped after {self.duration}s")

    async def trigger(self):
        """Ring hooter. If already ringing, restart the timer."""
        if not self.enabled:
            return
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = asyncio.ensure_future(self._ring_and_auto_stop())
        log.info(f"Hooter triggered ({self.duration}s)")

    async def stop(self):
        """Immediately stop hooter — called by NOC clear command."""
        if not self.enabled:
            return
        if self._task and not self._task.done():
            self._task.cancel()
        await self._set_relay(0)
        log.info("Hooter stopped by NOC operator")


# ── Global hooter instance (shared with control server) ──────────────────────
hooter = HooterController()


# ── FastAPI control server (port 8003) ────────────────────────────────────────
control_app = FastAPI(title="Detection Control API")
control_app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

@control_app.post("/hooter/stop")
async def stop_hooter(body: dict = {}):
    """Called by alarm-manager when NOC operator clears an alarm."""
    await hooter.stop()
    return {"status": "stopped", "camera_id": body.get("camera_id", "unknown")}

@control_app.post("/hooter/test")
async def test_hooter():
    """Test endpoint — ring hooter for 3 seconds."""
    orig = hooter.duration
    hooter.duration = 3
    await hooter.trigger()
    hooter.duration = orig
    return {"status": "test_triggered", "duration_seconds": 3}

@control_app.get("/health")
async def health():
    return {
        "service": "detection-service",
        "status":  "ok",
        "hooter":  {"enabled": hooter.enabled, "cam_ip": hooter.cam_ip or "not configured"}
    }


def start_control_server():
    """Run the control FastAPI server in a background thread."""
    uvicorn.run(control_app, host="0.0.0.0", port=8003, log_level="warning")


# ── Detection Service ─────────────────────────────────────────────────────────
class DetectionService:
    def __init__(self):
        log.info(f"Loading model: {settings.MODEL_PATH}")
        self.model           = YOLO(settings.MODEL_PATH)
        self.frame_count     = 0
        self.last_event_time = 0

    def open_stream(self):
        source = settings.RTSP_URL if settings.RTSP_URL else 0

        cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)

        for _ in range(20):
            if cap.isOpened():
                break
            time.sleep(0.5)

        if not cap.isOpened():
            raise RuntimeError(f"Cannot open stream: {source}")

        log.info(f"Stream opened: {source}")
        return cap
    def build_event(self, conf: float, label: str, bbox: list) -> dict:
        return {
            "camera_id":  settings.CAMERA_ID,
            "site_id":    settings.SITE_ID,
            "event_type": "HUMAN_DETECTED" if label == "Person" else "ANIMAL_DETECTED",
            "confidence": round(conf, 4),
            "label":      label,
            "bbox":       bbox,
            "timestamp":  datetime.now(timezone.utc).isoformat(),
            "frame":      self.frame_count,
        }

    async def post_event(self, event: dict):
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.post(
                    f"{settings.EVENT_PROCESSOR_URL}/events/detection",
                    json=event
                )
            log.info(
                f"Event [{event['label']}] conf={event['confidence']:.2f} -> {r.status_code}"
            )
            # Hooter fires for humans only
            if event["label"] == "Person":
                await hooter.trigger()
            else:
                log.info(f"Animal ({event['label']}) -> logged only, no hooter")
        except Exception as e:
            log.warning(f"Event POST failed: {e}")

    async def run_async(self):
        cap = self.open_stream()
        log.info("Detection loop started")

        while True:
            ret, frame = cap.read()
            if not ret:
                log.warning("Frame read failed — retrying in 2s")
                await asyncio.sleep(2)
                cap = self.open_stream()
                continue

            self.frame_count += 1
            if self.frame_count % settings.INFERENCE_EVERY_N_FRAMES != 0:
                continue

            results = self.model(
                frame, verbose=False,
                classes=DETECT_CLASSES,
                conf=settings.CONFIDENCE_THRESHOLD
            )[0]

            for box in results.boxes:
                conf  = float(box.conf[0])
                cls   = int(box.cls[0])
                label = "Person" if cls == 0 else ANIMAL_CLASSES.get(cls, "Animal")
                now   = time.time()
                if now - self.last_event_time < settings.EVENT_THROTTLE_SECONDS:
                    continue
                self.last_event_time = now
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0]]
                await self.post_event(self.build_event(conf, label, [x1, y1, x2, y2]))

        cap.release()


if __name__ == "__main__":
    # Start control server in background thread
    t = threading.Thread(target=start_control_server, daemon=True)
    t.start()
    log.info("Control server started on port 8003")

    # Run detection loop
    svc = DetectionService()
    asyncio.run(svc.run_async())
