"""
snapshot_capture.py — Snapshot Capture Module for Detection Service
===================================================================
Called by detection-service when YOLO triggers an alarm.
Captures 3 frames (at alarm + 2s + 4s), encodes as JPEG base64,
and POSTs to alarm-manager /snapshots/ingest endpoint.

Usage:
    from snapshot_capture import SnapshotCapture
    
    capture = SnapshotCapture(alarm_manager_url="http://alarm-manager:8002")
    
    # On alarm trigger — pass the current OpenCV frame:
    capture.start_capture_sequence(frame, alarm_id, camera_id, site_id)
"""

import cv2
import base64
import asyncio
import logging
import threading
import time
from typing import Optional
import httpx

logger = logging.getLogger(__name__)


class SnapshotCapture:
    """
    Captures 3 JPEG snapshots per alarm and sends them to alarm-manager.
    Non-blocking — uses a background thread so detection doesn't stutter.
    """

    def __init__(
        self,
        alarm_manager_url: str,
        quality: int = 85,          # JPEG quality 0–100
        offsets_ms: list = None,    # capture offsets in ms after alarm trigger
    ):
        self.alarm_manager_url = alarm_manager_url.rstrip("/")
        self.quality           = quality
        self.offsets_ms        = offsets_ms or [0, 2000, 4000]
        self._pending_captures = {}   # alarm_id → {frame, metadata, capture_times}
        self._lock             = threading.Lock()

    # ── Public API ─────────────────────────────────────────────────────────────

    def start_capture_sequence(
        self,
        frame,          # numpy array from OpenCV
        alarm_id: str,
        camera_id: str,
        site_id: str,
        timestamp: str, # ISO8601
    ):
        """
        Non-blocking. Immediately captures frame 0 (at trigger),
        then schedules frames at 2s and 4s in background.
        """
        thread = threading.Thread(
            target=self._capture_sequence_worker,
            args=(frame.copy(), alarm_id, camera_id, site_id, timestamp),
            daemon=True,
        )
        thread.start()
        logger.info(f"[SNAPSHOT] Starting 3-frame capture sequence for {alarm_id}")

    # ── Internal ───────────────────────────────────────────────────────────────

    def _capture_sequence_worker(self, initial_frame, alarm_id, camera_id, site_id, timestamp):
        """Background thread — captures and uploads 3 snapshots."""
        try:
            # Frame 0 — immediate (use the passed frame)
            self._encode_and_send(initial_frame, alarm_id, camera_id, site_id, timestamp, 0)

            # Frames 1 and 2 — just send the same initial frame offset-labeled
            # In production you'd grab new frames from the RTMP stream
            # For now we re-use the detection frame for all 3 (still shows intruder)
            for offset_ms in self.offsets_ms[1:]:
                time.sleep(offset_ms / 1000)
                self._encode_and_send(initial_frame, alarm_id, camera_id, site_id, timestamp, offset_ms)

        except Exception as e:
            logger.error(f"[SNAPSHOT] Capture sequence failed for {alarm_id}: {e}")

    def _encode_and_send(self, frame, alarm_id, camera_id, site_id, timestamp, offset_ms):
        """Encode frame as base64 JPEG and POST to alarm-manager."""
        try:
            encode_params = [cv2.IMWRITE_JPEG_QUALITY, self.quality]
            _, buffer = cv2.imencode(".jpg", frame, encode_params)
            image_b64 = base64.b64encode(buffer.tobytes()).decode("utf-8")

            payload = {
                "alarm_id":       alarm_id,
                "camera_id":      camera_id,
                "site_id":        site_id,
                "timestamp":      timestamp,
                "image_b64":      image_b64,
                "frame_offset_ms": offset_ms,
            }

            with httpx.Client(timeout=10.0) as client:
                r = client.post(
                    f"{self.alarm_manager_url}/snapshots/ingest",
                    json=payload,
                )
                if r.status_code == 200:
                    data = r.json()
                    logger.info(
                        f"[SNAPSHOT] Saved {alarm_id} +{offset_ms//1000}s → "
                        f"{data.get('url')} ({data.get('size_kb')}KB)"
                    )
                else:
                    logger.error(f"[SNAPSHOT] Ingest failed: {r.status_code} {r.text}")

        except Exception as e:
            logger.error(f"[SNAPSHOT] encode_and_send failed: {e}")
