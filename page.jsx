"use client";
import { useEffect, useState, useCallback, useRef } from "react";

const ALARM_MANAGER_URL = process.env.NEXT_PUBLIC_ALARM_MANAGER_URL || "http://74.225.144.11:8002";
const ALARM_MANAGER_WS  = process.env.NEXT_PUBLIC_ALARM_MANAGER_WS  || "ws://74.225.144.11:8002/ws";
const RTMP_SERVER_URL   = "http://74.225.144.11:8080";
const HLS_URL           = `${RTMP_SERVER_URL}/hls/bts01.m3u8`;
const PLAYER_URL        = `${RTMP_SERVER_URL}/player.html`;

const SEVERITY = {
  CRITICAL: { bg: "bg-red-950", border: "border-red-500", badge: "bg-red-500 text-white", dot: "bg-red-500", glow: "shadow-red-500/30" },
  HIGH:     { bg: "bg-orange-950", border: "border-orange-500", badge: "bg-orange-500 text-white", dot: "bg-orange-400", glow: "shadow-orange-500/20" },
  MEDIUM:   { bg: "bg-yellow-950", border: "border-yellow-500", badge: "bg-yellow-500 text-black", dot: "bg-yellow-400", glow: "" },
  LOW:      { bg: "bg-blue-950", border: "border-blue-500", badge: "bg-blue-500 text-white", dot: "bg-blue-400", glow: "" },
};

const STATUS = {
  ACTIVE:       "bg-red-500/20 text-red-400 border border-red-500/40",
  ACKNOWLEDGED: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40",
  CLEARED:      "bg-green-500/20 text-green-400 border border-green-500/40",
};

function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDuration(ts) {
  if (!ts) return "";
  const secs = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (secs < 60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// ── Pulsing dot for active alarms ────────────────────────────────────────────
function PulseDot({ color = "bg-red-500" }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-60`} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}

// ── Live stream panel ─────────────────────────────────────────────────────────
function LiveStreamPanel({ compact = false }) {
  const [streamStatus, setStreamStatus] = useState("checking");
  const iframeRef = useRef(null);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${RTMP_SERVER_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) setStreamStatus("online");
        else setStreamStatus("offline");
      } catch {
        setStreamStatus("offline");
      }
    };
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  if (compact) return (
    <div className="relative w-full aspect-video bg-gray-950 rounded-lg overflow-hidden border border-gray-700">
      {streamStatus === "online" ? (
        <iframe ref={iframeRef} src={PLAYER_URL} className="w-full h-full border-0" title="Live Feed" allowFullScreen />
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
          <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          </svg>
          <span className="text-xs font-mono">STREAM OFFLINE</span>
          <span className="text-xs text-gray-600">Enable RTMP in EzyLiv+ app</span>
        </div>
      )}
      <div className={`absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-mono ${streamStatus === "online" ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-gray-800 text-gray-500 border border-gray-700"}`}>
        <PulseDot color={streamStatus === "online" ? "bg-green-500" : "bg-gray-500"} />
        {streamStatus === "online" ? "LIVE" : "OFFLINE"}
      </div>
    </div>
  );

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" />
          </svg>
          <span className="text-sm font-semibold text-white font-mono tracking-wide">CAM-BTS-01 — LIVE FEED</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500 font-mono">800×448 · H.264 · 15fps</span>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border ${streamStatus === "online" ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-gray-800 text-gray-500 border-gray-700"}`}>
            <PulseDot color={streamStatus === "online" ? "bg-green-500" : "bg-gray-500"} />
            {streamStatus === "online" ? "STREAMING" : "OFFLINE"}
          </div>
          <a href={PLAYER_URL} target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:text-white transition-colors font-mono">OPEN ↗</a>
        </div>
      </div>
      <div className="relative aspect-video bg-black">
        {streamStatus === "online" ? (
          <iframe src={PLAYER_URL} className="w-full h-full border-0" title="Live Feed" allowFullScreen />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-600">
            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
              <svg className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-mono text-gray-500">STREAM OFFLINE</p>
              <p className="text-xs text-gray-700 mt-1">Open EzyLiv+ → Settings → Advanced → RTMP → Enable</p>
              <p className="text-xs text-gray-700 mt-0.5 font-mono">rtmp://74.225.144.11:1935/live/bts01</p>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-t border-gray-800">
        <span className="text-xs font-mono text-gray-600">AIRTEL-ASM-BTS-001 · Central India</span>
        <div className="flex gap-3">
          <a href={HLS_URL} target="_blank" rel="noreferrer" className="text-xs font-mono text-gray-600 hover:text-blue-400 transition-colors">HLS ↗</a>
          <span className="text-xs font-mono text-gray-700">|</span>
          <a href={`rtmp://74.225.144.11:1935/live/bts01`} className="text-xs font-mono text-gray-600 hover:text-blue-400 transition-colors select-all">RTMP</a>
        </div>
      </div>
    </div>
  );
}

// ── Screenshot gallery ────────────────────────────────────────────────────────
function SnapshotGallery({ alarmId, timestamp }) {
  // Generate 3 snapshot "slots" based on alarm timestamp
  // In production these would be real snapshot URLs from the detection service
  const snapshots = [0, 1, 2].map(i => ({
    id: i,
    label: `Frame +${i * 2}s`,
    time: timestamp ? new Date(new Date(timestamp).getTime() + i * 2000).toISOString() : null,
  }));

  return (
    <div className="space-y-2">
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Detection Snapshots</p>
      <div className="grid grid-cols-3 gap-2">
        {snapshots.map(s => (
          <div key={s.id} className="relative aspect-video bg-gray-950 rounded-lg border border-gray-800 overflow-hidden flex items-center justify-center group">
            <div className="text-center space-y-1">
              <svg className="w-6 h-6 text-gray-700 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <p className="text-xs font-mono text-gray-700">{s.label}</p>
            </div>
            <div className="absolute bottom-1 left-1 right-1 text-center">
              <span className="text-xs font-mono text-gray-700">{s.time ? fmtTime(s.time) : "—"}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-700 font-mono">Snapshots auto-captured at detection · stored in /snapshots</p>
    </div>
  );
}

// ── Alarm detail panel ────────────────────────────────────────────────────────
function AlarmDetail({ alarm, onClose, onAck, onClear }) {
  const sev = SEVERITY[alarm.severity] || SEVERITY.HIGH;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className={`w-full max-w-3xl bg-gray-900 border ${sev.border} rounded-2xl shadow-2xl ${sev.glow} overflow-hidden`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${sev.border} bg-gray-950`}>
          <div className="flex items-center gap-3">
            <PulseDot color={sev.dot} />
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono px-2 py-0.5 rounded ${sev.badge}`}>{alarm.severity}</span>
                <span className={`text-xs font-mono px-2 py-0.5 rounded ${STATUS[alarm.status] || STATUS.ACTIVE}`}>{alarm.status}</span>
              </div>
              <h2 className="text-white font-bold font-mono mt-1 text-lg">{alarm.alarm_id || alarm.id?.slice(0, 8).toUpperCase()}</h2>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto">
          {/* Info grid */}
          <div className="grid grid-cols-2 gap-4">
            {[
              ["Site ID", alarm.site_id],
              ["Camera", alarm.camera_id],
              ["Threat Level", alarm.threat_level || "INTRUSION DETECTED"],
              ["Confidence", alarm.confidence ? `${(alarm.confidence * 100).toFixed(1)}%` : "—"],
              ["Persons", alarm.person_count ?? "—"],
              ["Animals", alarm.animal_count ?? "—"],
              ["Date", fmtDate(alarm.created_at)],
              ["Time", fmtTime(alarm.created_at)],
            ].map(([label, val]) => (
              <div key={label} className="bg-gray-950 rounded-lg p-3 border border-gray-800">
                <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-1">{label}</p>
                <p className="text-sm font-mono text-white">{val || "—"}</p>
              </div>
            ))}
          </div>

          {/* Response required */}
          {alarm.response && (
            <div className="bg-red-950/50 border border-red-500/30 rounded-lg p-4">
              <p className="text-xs font-mono text-red-400 uppercase tracking-wider mb-1">Required Action</p>
              <p className="text-sm font-mono text-red-300">{alarm.response}</p>
            </div>
          )}

          {/* Snapshots */}
          <SnapshotGallery alarmId={alarm.id} timestamp={alarm.created_at} />

          {/* Live stream */}
          <div>
            <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Live Feed — {alarm.camera_id}</p>
            <LiveStreamPanel compact />
          </div>

          {/* Stream URLs */}
          <div className="bg-gray-950 rounded-lg p-4 border border-gray-800 space-y-2">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Stream URLs</p>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-gray-500">HLS (browser)</span>
                <a href={HLS_URL} target="_blank" rel="noreferrer" className="text-xs font-mono text-blue-400 hover:text-blue-300 transition-colors">{HLS_URL}</a>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-gray-500">RTMP (VLC)</span>
                <span className="text-xs font-mono text-green-400 select-all">rtmp://74.225.144.11:1935/live/bts01</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            {alarm.status === "ACTIVE" && (
              <button onClick={() => onAck(alarm.id)} className="flex-1 py-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm font-mono hover:bg-yellow-500/20 transition-colors">
                Acknowledge
              </button>
            )}
            {alarm.status !== "CLEARED" && (
              <button onClick={() => onClear(alarm.id)} className="flex-1 py-2.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-mono hover:bg-green-500/20 transition-colors">
                Clear Alarm
              </button>
            )}
            <button onClick={onClose} className="px-6 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 text-sm font-mono hover:bg-gray-700 transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Alarm row ─────────────────────────────────────────────────────────────────
function AlarmRow({ alarm, onClick }) {
  const sev = SEVERITY[alarm.severity] || SEVERITY.HIGH;
  const isActive = alarm.status === "ACTIVE";

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-4 px-4 py-3.5 border-b border-gray-800 hover:bg-gray-800/50 transition-colors cursor-pointer ${isActive ? "bg-gray-900" : "bg-gray-900/50"}`}
    >
      <div className="flex items-center gap-2 w-28 shrink-0">
        {isActive && <PulseDot color={sev.dot} />}
        <span className={`text-xs font-mono px-2 py-0.5 rounded ${sev.badge}`}>{alarm.severity}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-white truncate">{alarm.site_id}</span>
          <span className="text-xs font-mono text-gray-600">·</span>
          <span className="text-xs font-mono text-gray-400">{alarm.camera_id}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs font-mono text-gray-500">{alarm.threat_level || "INTRUSION DETECTED"}</span>
          {alarm.person_count > 0 && (
            <span className="text-xs font-mono text-red-400">{alarm.person_count} person{alarm.person_count > 1 ? "s" : ""}</span>
          )}
          {alarm.confidence && (
            <span className="text-xs font-mono text-gray-600">{(alarm.confidence * 100).toFixed(0)}% conf</span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0 space-y-1">
        <div className={`text-xs font-mono px-2 py-0.5 rounded inline-block ${STATUS[alarm.status] || STATUS.ACTIVE}`}>{alarm.status}</div>
        <div className="text-xs font-mono text-gray-600 block">{fmtDuration(alarm.created_at)}</div>
      </div>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent = "text-white", pulse = false }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">{label}</p>
      <div className="flex items-end gap-2">
        <span className={`text-4xl font-bold font-mono ${accent} ${pulse && value > 0 ? "animate-pulse" : ""}`}>{value}</span>
        {sub && <span className="text-xs font-mono text-gray-600 mb-1">{sub}</span>}
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [alarms, setAlarms]           = useState([]);
  const [filter, setFilter]           = useState("ALL");
  const [wsStatus, setWsStatus]       = useState("connecting");
  const [selected, setSelected]       = useState(null);
  const [showStream, setShowStream]   = useState(false);
  const [clock, setClock]             = useState(new Date());
  const wsRef = useRef(null);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // WebSocket
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(ALARM_MANAGER_WS);
    wsRef.current = ws;

    ws.onopen  = () => setWsStatus("connected");
    ws.onclose = () => { setWsStatus("reconnecting"); setTimeout(connectWs, 3000); };
    ws.onerror = () => { setWsStatus("error"); ws.close(); };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "alarm_created" || msg.type === "new_alarm") {
          setAlarms(prev => {
            if (prev.find(a => a.id === msg.alarm.id)) return prev;
            return [msg.alarm, ...prev];
          });
        } else if (msg.type === "alarm_updated") {
          setAlarms(prev => prev.map(a => a.id === msg.alarm.id ? msg.alarm : a));
        } else if (msg.type === "initial_state" && msg.alarms) {
          setAlarms(msg.alarms);
        }
      } catch {}
    };
  }, []);

  useEffect(() => {
    connectWs();
    // Fetch existing alarms
    fetch(`${ALARM_MANAGER_URL}/alarms`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data) && data.length) setAlarms(data); })
      .catch(() => {});
    return () => wsRef.current?.close();
  }, [connectWs]);

  const ackAlarm = async (id) => {
    await fetch(`${ALARM_MANAGER_URL}/alarms/${id}/acknowledge`, { method: "POST" });
    setAlarms(prev => prev.map(a => a.id === id ? { ...a, status: "ACKNOWLEDGED" } : a));
    if (selected?.id === id) setSelected(s => ({ ...s, status: "ACKNOWLEDGED" }));
  };

  const clearAlarm = async (id) => {
    await fetch(`${ALARM_MANAGER_URL}/alarms/${id}/clear`, { method: "POST" });
    setAlarms(prev => prev.map(a => a.id === id ? { ...a, status: "CLEARED" } : a));
    if (selected?.id === id) setSelected(null);
  };

  const filtered = alarms.filter(a => {
    if (filter === "ALL")          return true;
    if (filter === "ACTIVE")       return a.status === "ACTIVE";
    if (filter === "ACKNOWLEDGED") return a.status === "ACKNOWLEDGED";
    if (filter === "CLEARED")      return a.status === "CLEARED";
    return true;
  });

  const activeCount = alarms.filter(a => a.status === "ACTIVE").length;
  const criticalCount = alarms.filter(a => a.severity === "CRITICAL" && a.status === "ACTIVE").length;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace" }}>

      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-red-500 font-bold text-sm tracking-widest">AIRTEL</span>
              <span className="text-gray-600 text-xs">|</span>
              <span className="text-xs text-gray-400 tracking-wider">BTS THEFT MONITORING — NOC</span>
            </div>
            <p className="text-xs text-gray-600 mt-0.5">Restricted Area Intrusion Detection · Assam Circle</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Active alarm flash */}
          {activeCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg animate-pulse">
              <PulseDot color="bg-red-500" />
              <span className="text-xs font-mono text-red-400">{activeCount} ACTIVE ALARM{activeCount > 1 ? "S" : ""}</span>
            </div>
          )}

          {/* WS status */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border ${
            wsStatus === "connected"   ? "bg-green-500/10 text-green-400 border-green-500/30" :
            wsStatus === "connecting"  ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30" :
            "bg-red-500/10 text-red-400 border-red-500/30"
          }`}>
            <PulseDot color={wsStatus === "connected" ? "bg-green-500" : wsStatus === "connecting" ? "bg-yellow-400" : "bg-red-500"} />
            {wsStatus === "connected" ? "LIVE" : wsStatus === "connecting" ? "CONNECTING" : "RECONNECTING"}
          </div>

          {/* Clock */}
          <div className="text-right">
            <div className="text-sm font-mono text-white">{clock.toLocaleTimeString("en-IN")}</div>
            <div className="text-xs font-mono text-gray-600">{clock.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
          </div>
        </div>
      </header>

      {/* ── Critical banner ── */}
      {criticalCount > 0 && (
        <div className="bg-red-500 px-6 py-2 flex items-center justify-center gap-3">
          <svg className="w-4 h-4 text-white animate-pulse" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="text-white text-sm font-bold font-mono tracking-widest">
            !! CRITICAL ALERT — {criticalCount} MASS INTRUSION DETECTED — DISPATCH MULTIPLE SECURITY UNITS IMMEDIATELY !!
          </span>
        </div>
      )}

      {/* ── Main content ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: Alarms ── */}
        <div className={`flex flex-col ${showStream ? "w-1/2" : "flex-1"} border-r border-gray-800 overflow-hidden transition-all duration-300`}>

          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-4 p-4 border-b border-gray-800 shrink-0">
            <StatCard label="Active Alarms" value={activeCount} accent={activeCount > 0 ? "text-red-400" : "text-gray-400"} pulse={activeCount > 0} />
            <StatCard label="Total Today" value={alarms.length} accent="text-white" />
            <StatCard label="Cleared" value={alarms.filter(a => a.status === "CLEARED").length} accent="text-green-400" />
          </div>

          {/* Filter tabs + stream toggle */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
            <div className="flex gap-1">
              {["ALL", "ACTIVE", "ACKNOWLEDGED", "CLEARED"].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${
                    filter === f ? "bg-white text-gray-950 font-bold" : "text-gray-500 hover:text-white hover:bg-gray-800"
                  }`}
                >
                  {f}
                  {f === "ACTIVE" && activeCount > 0 && (
                    <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{activeCount}</span>
                  )}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowStream(s => !s)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono border transition-colors ${
                showStream ? "bg-blue-500/20 border-blue-500/40 text-blue-400" : "border-gray-700 text-gray-500 hover:text-white hover:border-gray-600"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
              {showStream ? "HIDE STREAM" : "LIVE FEED"}
            </button>
          </div>

          {/* Alarm list */}
          <div className="flex-1 overflow-y-auto">
            {/* Column headers */}
            <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800 bg-gray-950 text-xs font-mono text-gray-600 uppercase tracking-wider sticky top-0">
              <span className="w-28 shrink-0">Severity</span>
              <span className="flex-1">Site · Camera · Threat</span>
              <span className="text-right shrink-0">Status · Time</span>
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-700">
                <svg className="w-12 h-12 mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm font-mono">No alarms in this view</p>
                <p className="text-xs text-gray-800 mt-1">All clear — monitoring active</p>
              </div>
            ) : (
              filtered.map(alarm => (
                <AlarmRow key={alarm.id} alarm={alarm} onClick={() => setSelected(alarm)} />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-gray-800 bg-gray-950 flex items-center justify-between shrink-0">
            <span className="text-xs font-mono text-gray-600">{filtered.length} alarm{filtered.length !== 1 ? "s" : ""} shown</span>
            <span className="text-xs font-mono text-gray-700">Click any row for details, snapshots & live stream</span>
          </div>
        </div>

        {/* ── Right: Live stream panel ── */}
        {showStream && (
          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900 shrink-0">
              <span className="text-xs font-mono text-gray-400 uppercase tracking-wider">Live Camera Feed</span>
              <button onClick={() => setShowStream(false)} className="text-gray-600 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              <LiveStreamPanel />

              {/* Site info */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Site Information</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ["Site ID", "AIRTEL-ASM-BTS-001"],
                    ["Camera", "CAM-BTS-01"],
                    ["Model", "CP Plus EZ-S35T"],
                    ["Network", "4G LTE (Airtel SIM)"],
                    ["Resolution", "800×448 · 15fps"],
                    ["Protocol", "RTMP Push"],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-gray-600 font-mono">{k}</p>
                      <p className="text-xs text-white font-mono mt-0.5">{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick actions */}
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Quick Actions</p>
                <div className="space-y-2">
                  <a href={PLAYER_URL} target="_blank" rel="noreferrer"
                    className="flex items-center justify-between w-full px-3 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors">
                    <span className="text-xs font-mono text-white">Open in full screen</span>
                    <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                  <div className="flex items-center justify-between w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg">
                    <span className="text-xs font-mono text-gray-400">VLC URL</span>
                    <span className="text-xs font-mono text-green-400 select-all">rtmp://74.225.144.11:1935/live/bts01</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Alarm detail modal ── */}
      {selected && (
        <AlarmDetail
          alarm={selected}
          onClose={() => setSelected(null)}
          onAck={ackAlarm}
          onClear={clearAlarm}
        />
      )}
    </div>
  );
}
