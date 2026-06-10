"""
Detection Service
-----------------
Reads RTSP / webcam stream, runs YOLOv8 inference,
detects persons AND animals, posts events to Event Processor.
"""
import cv2, time, logging, httpx, asyncio
from ultralytics import YOLO
from datetime import datetime, timezone
from config import settings

logging.basicConfig(level=logging.INFO,
    format="%(asctime)s [DETECTOR] %(levelname)s: %(message)s")
log = logging.getLogger(__name__)

ANIMAL_CLASSES = {
    15:"Cat", 16:"Dog", 17:"Horse", 18:"Sheep",
    19:"Cow", 20:"Elephant", 21:"Bear", 22:"Zebra", 23:"Giraffe"
}
DETECT_CLASSES = [int(c) for c in settings.DETECT_CLASSES.split(",")]


class DetectionService:
    def __init__(self):
        log.info(f"Loading model: {settings.MODEL_PATH}")
        self.model       = YOLO(settings.MODEL_PATH)
        self.frame_count     = 0
        self.last_event_time = 0

    def open_stream(self):
        source = settings.RTSP_URL if settings.RTSP_URL else 0
        cap    = cv2.VideoCapture(source)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open stream: {source}")
        log.info(f"Stream opened: {source}")
        return cap

    def build_event(self, conf, label, bbox):
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

    async def post_event(self, event):
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                r = await client.post(
                    f"{settings.EVENT_PROCESSOR_URL}/events/detection",
                    json=event)
                log.info(f"Event [{event['label']}] conf={event['confidence']:.2f} -> {r.status_code}")
        except Exception as e:
            log.warning(f"Event POST failed: {e}")

    def run(self):
        loop = asyncio.new_event_loop()
        cap  = self.open_stream()
        log.info("Detection loop started")

        while True:
            ret, frame = cap.read()
            if not ret:
                log.warning("Frame read failed - retrying in 2s")
                time.sleep(2)
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
                loop.run_until_complete(self.post_event(
                    self.build_event(conf, label, [x1, y1, x2, y2])))

        cap.release()


if __name__ == "__main__":
    DetectionService().run()
