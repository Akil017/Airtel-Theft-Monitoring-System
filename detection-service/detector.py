"""
Detection Service
-----------------
Reads camera RTSP stream, runs YOLOv8 inference,
filters for person class, and POSTs detection events
to the Event Processor.
"""

import cv2
import time
import httpx
import logging
import os
from datetime import datetime, timezone
from ultralytics import YOLO

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [detection-service] %(levelname)s: %(message)s"
)
log = logging.getLogger(__name__)

# ── Configuration (override via environment variables) ──────────────────────
RTSP_URL = os.getenv("RTSP_URL", "rtsp://admin:admin@192.168.1.100:554/stream1")
CAMERA_ID = os.getenv("CAMERA_ID", "CAM01")
SITE_ID = os.getenv("SITE_ID", "BTS_SITE_001")
ZONE_ID = os.getenv("ZONE_ID", "RESTRICTED_ZONE_A")
MODEL_PATH = os.getenv("YOLO_MODEL", "yolov8n.pt")
CONFIDENCE_THRESHOLD = float(os.getenv("CONFIDENCE_THRESHOLD", "0.5"))
EVENT_PROCESSOR_URL = os.getenv("EVENT_PROCESSOR_URL", "http://event-processor:8001/detection")
THROTTLE_SECONDS = int(os.getenv("THROTTLE_SECONDS", "5"))   # min gap between events per camera
PERSON_CLASS_ID = 0  # COCO class 0 = person


def load_model() -> YOLO:
    log.info(f"Loading YOLO model from '{MODEL_PATH}'")
    model = YOLO(MODEL_PATH)
    log.info("Model loaded successfully")
    return model


def open_stream(rtsp_url: str) -> cv2.VideoCapture:
    log.info(f"Connecting to stream: {rtsp_url}")
    cap = cv2.VideoCapture(rtsp_url)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open stream: {rtsp_url}")
    log.info("Stream opened successfully")
    return cap


def post_event(payload: dict) -> None:
    try:
        resp = httpx.post(EVENT_PROCESSOR_URL, json=payload, timeout=5)
        resp.raise_for_status()
        log.info(f"Event sent → {resp.status_code}")
    except Exception as exc:
        log.warning(f"Failed to post event: {exc}")


def run() -> None:
    model = load_model()
    last_sent: float = 0.0

    while True:
        cap = None
        try:
            cap = open_stream(RTSP_URL)
        except RuntimeError as err:
            log.error(f"{err} — retrying in 10s")
            time.sleep(10)
            continue

        log.info("Starting inference loop")
        while True:
            ret, frame = cap.read()
            if not ret:
                log.warning("Frame read failed — reconnecting")
                break

            results = model(frame, verbose=False)[0]

            person_detected = False
            best_conf = 0.0
            best_bbox = None

            for box in results.boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                if cls_id == PERSON_CLASS_ID and conf >= CONFIDENCE_THRESHOLD:
                    person_detected = True
                    if conf > best_conf:
                        best_conf = conf
                        x1, y1, x2, y2 = box.xyxy[0].tolist()
                        best_bbox = {"x1": x1, "y1": y1, "x2": x2, "y2": y2}

            now = time.time()
            if person_detected and (now - last_sent) >= THROTTLE_SECONDS:
                payload = {
                    "camera_id": CAMERA_ID,
                    "event_type": "HUMAN_DETECTED",
                    "confidence": round(best_conf, 4),
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "site_id": SITE_ID,
                    "zone_id": ZONE_ID,
                    "bbox": best_bbox,
                }
                log.info(f"Person detected (conf={best_conf:.2f}) — posting event")
                post_event(payload)
                last_sent = now

        if cap:
            cap.release()
        time.sleep(3)


if __name__ == "__main__":
    run()
