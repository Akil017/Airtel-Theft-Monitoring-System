"""
YOLO Detection Service
Reads RTSP / webcam stream, runs YOLOv8 inference, emits detection events.
"""
import cv2
import time
import json
import logging
import httpx
import asyncio
from ultralytics import YOLO
from datetime import datetime, timezone
from config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [DETECTOR] %(message)s")
log = logging.getLogger(__name__)


class DetectionService:
    def __init__(self):
        log.info(f"Loading model: {settings.MODEL_PATH}")
        self.model = YOLO(settings.MODEL_PATH)
        self.camera_id = settings.CAMERA_ID
        self.confidence_threshold = settings.CONFIDENCE_THRESHOLD
        self.frame_count = 0
        self.last_event_time = 0

    def open_stream(self) -> cv2.VideoCapture:
        source = settings.RTSP_URL if settings.RTSP_URL else 0
        cap = cv2.VideoCapture(source)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open stream: {source}")
        log.info(f"Stream opened: {source}")
        return cap

    def build_event(self, confidence: float, bbox: list) -> dict:
        return {
            "camera_id": self.camera_id,
            "site_id": settings.SITE_ID,
            "event_type": "HUMAN_DETECTED",
            "confidence": round(confidence, 4),
            "bbox": bbox,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "frame": self.frame_count,
        }

    async def post_event(self, event: dict):
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.post(
                    f"{settings.EVENT_PROCESSOR_URL}/events/detection",
                    json=event,
                )
                log.info(f"Event sent → {r.status_code} | conf={event['confidence']}")
        except Exception as e:
            log.warning(f"Event POST failed: {e}")

    def run(self):
        cap = self.open_stream()
        log.info("Detection loop started")

        loop = asyncio.new_event_loop()

        while True:
            ret, frame = cap.read()
            if not ret:
                log.warning("Frame read failed — retrying in 2s")
                time.sleep(2)
                cap = self.open_stream()
                continue

            self.frame_count += 1

            # Run inference every N frames to save CPU
            if self.frame_count % settings.INFERENCE_EVERY_N_FRAMES != 0:
                continue

            results = self.model(frame, verbose=False)[0]

            for box in results.boxes:
                cls = int(box.cls[0])
                conf = float(box.conf[0])
                label = self.model.names[cls]

                if label == "person" and conf >= self.confidence_threshold:
                    # Throttle: don't spam events
                    now = time.time()
                    if now - self.last_event_time < settings.EVENT_THROTTLE_SECONDS:
                        continue
                    self.last_event_time = now

                    x1, y1, x2, y2 = [int(v) for v in box.xyxy[0]]
                    event = self.build_event(conf, [x1, y1, x2, y2])
                    loop.run_until_complete(self.post_event(event))

        cap.release()


if __name__ == "__main__":
    DetectionService().run()
