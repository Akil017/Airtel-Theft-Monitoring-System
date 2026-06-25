import cv2, os, logging
from datetime import datetime
from pathlib import Path
log = logging.getLogger("snapshot")
SNAPSHOT_DIR = Path(os.getenv("SNAPSHOT_DIR","/shared/snapshots"))

def ensure_dir(): SNAPSHOT_DIR.mkdir(parents=True,exist_ok=True)

def cleanup_old(max_files=300):
    try:
        files=sorted(SNAPSHOT_DIR.glob("*.jpg"),key=lambda f:f.stat().st_mtime)
        for f in files[:max(0,len(files)-max_files)]: f.unlink(missing_ok=True)
    except: pass

def save_snapshots(frames:list,camera_id:str,alarm_id:str)->list:
    ensure_dir(); cleanup_old(); saved=[]
    ts=datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    safe_cam=camera_id.replace("/","-").replace(" ","_")
    safe_alm=str(alarm_id)[:8].upper()
    for i,frame in enumerate(frames[:3]):
        if frame is None: continue
        try:
            ann=frame.copy(); h,w=ann.shape[:2]
            cv2.rectangle(ann,(0,h-26),(w,h),(0,0,0),-1)
            cv2.putText(ann,f"AIRTEL BTS | {camera_id} | {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC | FRAME {i+1}/3",(6,h-9),cv2.FONT_HERSHEY_SIMPLEX,0.36,(0,200,255),1,cv2.LINE_AA)
            cv2.putText(ann,"!! INTRUSION DETECTED !!",(6,22),cv2.FONT_HERSHEY_SIMPLEX,0.52,(30,30,220),2,cv2.LINE_AA)
            fname=f"{safe_cam}_{safe_alm}_{i}.jpg"
            cv2.imwrite(str(SNAPSHOT_DIR/fname),ann,[cv2.IMWRITE_JPEG_QUALITY,85])
            saved.append(f"snapshots/{fname}"); log.info(f"Snapshot saved: {fname}")
        except Exception as e: log.error(f"Snapshot {i} failed: {e}")
    return saved

class FrameBuffer:
    def __init__(self,size=6): self._buf=[]; self._size=size
    def push(self,frame):
        if frame is not None:
            self._buf.append(frame.copy())
            if len(self._buf)>self._size: self._buf.pop(0)
    def get_frames(self):
        n=len(self._buf)
        if n==0: return []
        if n<=3: return list(self._buf)
        return [self._buf[0],self._buf[n//2],self._buf[-1]]
