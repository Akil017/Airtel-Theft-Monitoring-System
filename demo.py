"""
Airtel BTS Theft Monitoring — Live Demo
========================================
Standalone demo script — no Docker, no database, no services needed.
Just a webcam and YOLOv8.

What it does:
  - Opens your webcam
  - Runs YOLOv8 person detection on every frame
  - Draws bounding boxes and confidence scores
  - Shows ALARM overlay when a person is detected for 3+ consecutive frames
  - Logs every alarm event to a local CSV file

Requirements:
  pip install ultralytics opencv-python

Run:
  python demo.py
"""

import cv2
import csv
import time
import os
from datetime import datetime
from ultralytics import YOLO

# ── Config ────────────────────────────────────────────────────────────────────
CAMERA_SOURCE       = 0          # 0 = built-in webcam, 1 = USB cam, or "rtsp://..."
CAMERA_ID           = "CAM-DEMO"
SITE_ID             = "AIRTEL-ASM-BTS-001"
MODEL_PATH          = "yolov8n.pt"   # auto-downloads on first run (~6MB)
CONFIDENCE_THRESHOLD = 0.55
CONSECUTIVE_REQUIRED = 3             # frames before alarm triggers
ALARM_COOLDOWN_SEC  = 5              # seconds before another alarm can trigger
LOG_FILE            = "demo_alarms.csv"
# ─────────────────────────────────────────────────────────────────────────────

# Colours (BGR)
GREEN  = (0, 220, 80)
RED    = (0, 0, 220)
ORANGE = (0, 140, 255)
WHITE  = (255, 255, 255)
BLACK  = (0, 0, 0)


def init_log():
    if not os.path.exists(LOG_FILE):
        with open(LOG_FILE, "w", newline="") as f:
            csv.writer(f).writerow(
                ["timestamp", "camera_id", "site_id", "confidence", "event"]
            )


def log_alarm(confidence: float):
    with open(LOG_FILE, "a", newline="") as f:
        csv.writer(f).writerow([
            datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            CAMERA_ID,
            SITE_ID,
            f"{confidence:.2f}",
            "INTRUSION_DETECTED",
        ])


def draw_box(frame, x1, y1, x2, y2, conf, alarming):
    color = RED if alarming else GREEN
    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

    label = f"PERSON  {conf:.0%}"
    (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
    cv2.rectangle(frame, (x1, y1 - th - 8), (x1 + tw + 6, y1), color, -1)
    cv2.putText(frame, label, (x1 + 3, y1 - 4),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, WHITE, 1, cv2.LINE_AA)


def draw_hud(frame, fps, consecutive, alarming, alarm_count, last_alarm_time):
    h, w = frame.shape[:2]

    # Top bar background
    cv2.rectangle(frame, (0, 0), (w, 52), (20, 20, 20), -1)

    # Title
    cv2.putText(frame, "AIRTEL BTS  |  Theft Monitoring Demo", (12, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (180, 180, 180), 1, cv2.LINE_AA)

    # Site / Camera
    cv2.putText(frame, f"{SITE_ID}   |   {CAMERA_ID}", (12, 42),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 120, 120), 1, cv2.LINE_AA)

    # FPS
    cv2.putText(frame, f"FPS {fps:04.1f}", (w - 110, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (100, 200, 100), 1, cv2.LINE_AA)

    # Alarm counter
    cv2.putText(frame, f"ALARMS: {alarm_count}", (w - 140, 42),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, ORANGE, 1, cv2.LINE_AA)

    # Detection counter bar
    bar_x, bar_y = 12, h - 36
    cv2.putText(frame, "DETECTION WINDOW:", (bar_x, bar_y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (140, 140, 140), 1, cv2.LINE_AA)
    for i in range(CONSECUTIVE_REQUIRED):
        filled = i < consecutive
        col = RED if (filled and alarming) else (GREEN if filled else (50, 50, 50))
        bx = bar_x + 165 + i * 22
        cv2.rectangle(frame, (bx, bar_y - 12), (bx + 16, bar_y + 2), col, -1)

    # ALARM overlay
    if alarming:
        overlay = frame.copy()
        cv2.rectangle(overlay, (0, 55), (w, h - 45), (0, 0, 180), -1)
        cv2.addWeighted(overlay, 0.12, frame, 0.88, 0, frame)

        # Flashing ALARM text
        if int(time.time() * 2) % 2 == 0:
            text = "  INTRUSION ALARM  "
            (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, 1.1, 2)
            tx = (w - tw) // 2
            ty = h // 2 - 10
            cv2.rectangle(frame, (tx - 10, ty - th - 10), (tx + tw + 10, ty + 10),
                          RED, -1)
            cv2.putText(frame, text, (tx, ty),
                        cv2.FONT_HERSHEY_DUPLEX, 1.1, WHITE, 2, cv2.LINE_AA)

        # Last alarm time
        if last_alarm_time:
            ts = datetime.fromtimestamp(last_alarm_time).strftime("%H:%M:%S")
            cv2.putText(frame, f"First detected: {ts}", (12, h - 52),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, ORANGE, 1, cv2.LINE_AA)


def main():
    print("\n" + "=" * 55)
    print("  Airtel BTS Theft Monitoring — Demo")
    print("=" * 55)
    print(f"  Camera  : {CAMERA_SOURCE}")
    print(f"  Site    : {SITE_ID}")
    print(f"  Model   : {MODEL_PATH}")
    print(f"  Threshold: {CONFIDENCE_THRESHOLD:.0%} confidence")
    print(f"  Trigger : {CONSECUTIVE_REQUIRED} consecutive frames")
    print(f"  Log file: {LOG_FILE}")
    print("=" * 55)
    print("  Press Q to quit\n")

    init_log()

    print("Loading YOLOv8 model...")
    model = YOLO(MODEL_PATH)
    print("Model ready.\n")

    cap = cv2.VideoCapture(CAMERA_SOURCE)
    if not cap.isOpened():
        print(f"ERROR: Cannot open camera source: {CAMERA_SOURCE}")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    consecutive    = 0
    alarming       = False
    alarm_count    = 0
    last_alarm_time = None
    last_alarm_logged = 0
    fps            = 0.0
    prev_time      = time.time()

    print("Stream open. Starting detection loop...\n")

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Frame read error — retrying...")
            time.sleep(0.5)
            continue

        # FPS
        now = time.time()
        fps = 0.9 * fps + 0.1 * (1.0 / max(now - prev_time, 1e-6))
        prev_time = now

        # Inference
        results = model(frame, verbose=False, classes=[0])[0]  # class 0 = person

        person_found = False
        best_conf    = 0.0

        for box in results.boxes:
            conf = float(box.conf[0])
            if conf < CONFIDENCE_THRESHOLD:
                continue
            person_found = True
            if conf > best_conf:
                best_conf = conf
            x1, y1, x2, y2 = [int(v) for v in box.xyxy[0]]
            draw_box(frame, x1, y1, x2, y2, conf, alarming)

        # Consecutive frame counter
        if person_found:
            consecutive = min(consecutive + 1, CONSECUTIVE_REQUIRED)
        else:
            consecutive = max(consecutive - 1, 0)

        # Alarm logic
        if consecutive >= CONSECUTIVE_REQUIRED:
            if not alarming:
                alarming = True
                alarm_count += 1
                last_alarm_time = now
                print(f"[{datetime.now().strftime('%H:%M:%S')}]  ALARM #{alarm_count}  "
                      f"conf={best_conf:.0%}  site={SITE_ID}  cam={CAMERA_ID}")

            # Log with cooldown
            if now - last_alarm_logged >= ALARM_COOLDOWN_SEC:
                log_alarm(best_conf)
                last_alarm_logged = now
        else:
            if alarming:
                print(f"[{datetime.now().strftime('%H:%M:%S')}]  Alarm cleared")
            alarming = False

        draw_hud(frame, fps, consecutive, alarming, alarm_count, last_alarm_time)

        cv2.imshow("Airtel BTS — Theft Monitoring Demo  [Q to quit]", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()
    print(f"\nDemo ended. {alarm_count} alarm(s) logged to '{LOG_FILE}'.")


if __name__ == "__main__":
    main()
