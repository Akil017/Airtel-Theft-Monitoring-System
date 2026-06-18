"use client";
import { useEffect, useState, useRef, useCallback } from "react";

const WS_URL  = process.env.NEXT_PUBLIC_ALARM_MANAGER_WS  ?? "ws://localhost:8002/ws";
const API_URL = process.env.NEXT_PUBLIC_ALARM_MANAGER_URL ?? "http://localhost:8002";
const RTMP_STAT_URL = process.env.NEXT_PUBLIC_RTMP_STAT_URL ?? "http://localhost:8080";

const SEV_STYLE = {
  CRITICAL: "bg-red-950 text-red-300 border border-red-700",
  HIGH:     "bg-orange-950 text-orange-300 border border-orange-700",
};
const STATUS_DOT = {
  ACTIVE:       "bg-red-500 animate-pulse",
  ACKNOWLEDGED: "bg-yellow-400",
  CLEARED:      "bg-green-500",
};
const STATUS_STYLE = {
  ACTIVE:       "text-red-400",
  ACKNOWLEDGED: "text-yellow-400",
  CLEARED:      "text-green-400",
};

function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" });
}

// ── Alarm Detail Modal ────────────────────────────────────────────────────────
function AlarmModal({ alarm, onClose, onAck, onClear, rtmpStatUrl }) {
  const [activeTab, setActiveTab] = useState("details");
  const [streamActive, setStreamActive] = useState(false);

  const hlsUrl = `${rtmpStatUrl.replace(':8080','')}/hls/bts01.m3u8`;
  const streamPreviewUrl = `${rtmpStatUrl}/hls/bts01.m3u8`;

  if (!alarm) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">

        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 bg-gray-950">
          <div className="flex items-center gap-3">
            <span className={`w-3 h-3 rounded-full flex-shrink-0 ${STATUS_DOT[alarm.status]}`} />
            <div>
              <div className="font-bold text-white text-sm">
                ALM — {alarm.alarm_id?.slice(0,8).toUpperCase()}
              </div>
              <div className="text-xs text-gray-400">{alarm.site_id} · {alarm.camera_id}</div>
            </div>
            <span className={`ml-2 px-2 py-0.5 rounded text-xs font-bold ${SEV_STYLE[alarm.severity] ?? "bg-gray-800 text-gray-300 border border-gray-600"}`}>
              {alarm.severity}
            </span>
          </div>
          <button onClick={onClose}
            className="text-gray-500 hover:text-white text-xl leading-none px-2">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 bg-gray-950">
          {[
            { id: "details",   label: "📋 Details"    },
            { id: "snapshot",  label: "📸 Snapshot"   },
            { id: "livestream",label: "📡 Live Stream" },
          ].map(tab => (
            <button key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-red-500 text-white"
                  : "border-transparent text-gray-500 hover:text-gray-300"
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── Details tab ── */}
          {activeTab === "details" && (
            <div className="space-y-4">
              {/* Threat banner */}
              <div className="bg-red-950/40 border border-red-800/50 rounded-lg px-4 py-3">
                <div className="text-xs text-red-400 font-medium uppercase tracking-wider mb-1">Threat Level</div>
                <div className="text-red-200 font-bold text-sm">{alarm.threat_level || "UNKNOWN"}</div>
              </div>

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Status",       val: alarm.status,       col: STATUS_STYLE[alarm.status] },
                  { label: "Severity",     val: alarm.severity,     col: alarm.severity === "CRITICAL" ? "text-red-400" : "text-orange-400" },
                  { label: "Site ID",      val: alarm.site_id,      col: "text-gray-200" },
                  { label: "Camera ID",    val: alarm.camera_id,    col: "text-gray-200" },
                  { label: "Persons",      val: alarm.person_count ?? 0, col: alarm.person_count > 0 ? "text-red-400 font-bold" : "text-gray-500" },
                  { label: "Animals",      val: alarm.animal_count ?? 0, col: alarm.animal_count > 0 ? "text-purple-400 font-bold" : "text-gray-500" },
                  { label: "Confidence",   val: alarm.confidence != null ? `${(alarm.confidence*100).toFixed(1)}%` : "—", col: "text-blue-300" },
                  { label: "First Detected", val: fmt(alarm.first_detected), col: "text-gray-300" },
                ].map(({ label, val, col }) => (
                  <div key={label} className="bg-gray-800/50 rounded-lg px-3 py-2.5">
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</div>
                    <div className={`text-xs font-medium ${col}`}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Response */}
              {alarm.response && (
                <div className="bg-blue-950/30 border border-blue-800/40 rounded-lg px-4 py-3">
                  <div className="text-xs text-blue-400 font-medium uppercase tracking-wider mb-1">Required Response</div>
                  <div className="text-blue-200 text-xs">{alarm.response}</div>
                </div>
              )}

              {/* Description */}
              {alarm.description && (
                <div className="bg-gray-800/40 rounded-lg px-4 py-3">
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Description</div>
                  <div className="text-gray-300 text-xs">{alarm.description}</div>
                </div>
              )}
            </div>
          )}

          {/* ── Snapshot tab ── */}
          {activeTab === "snapshot" && (
            <div className="space-y-4">
              {alarm.snapshot_path ? (
                <div>
                  <div className="text-xs text-gray-400 mb-3">
                    Auto-captured at time of alarm trigger
                  </div>
                  <div className="bg-black rounded-lg overflow-hidden border border-gray-700">
                    <img
                      src={`${API_URL}/snapshots/${alarm.alarm_id}`}
                      alt={`Snapshot for alarm ${alarm.alarm_id}`}
                      className="w-full object-contain max-h-96"
                      onError={(e) => {
                        e.target.style.display = "none";
                        e.target.nextSibling.style.display = "flex";
                      }}
                    />
                    <div className="hidden items-center justify-center py-16 text-gray-600 text-xs flex-col gap-2">
                      <span className="text-3xl">📸</span>
                      <span>Snapshot not available</span>
                      <span className="text-gray-700">{alarm.snapshot_path}</span>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-600">
                    Path: {alarm.snapshot_path}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-gray-600 gap-3">
                  <span className="text-4xl">📸</span>
                  <span className="text-sm">No snapshot available for this alarm</span>
                  <span className="text-xs text-gray-700">
                    Snapshots are saved when YOLO detects an intrusion via camera stream
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Live stream tab ── */}
          {activeTab === "livestream" && (
            <div className="space-y-4">
              <div className="bg-gray-800/40 rounded-lg px-4 py-3">
                <div className="text-xs text-gray-400 mb-1">Camera</div>
                <div className="text-white text-sm font-medium">{alarm.camera_id}</div>
                <div className="text-xs text-gray-500 mt-1">Site: {alarm.site_id}</div>
              </div>

              {/* HLS stream player */}
              <div className="bg-black rounded-lg overflow-hidden border border-gray-700 aspect-video flex items-center justify-center">
                {streamActive ? (
                  <video
                    autoPlay
                    muted
                    controls
                    className="w-full h-full"
                    src={streamPreviewUrl}
                    onError={() => setStreamActive(false)}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-4 text-gray-600">
                    <span className="text-5xl">📡</span>
                    <span className="text-sm">Live stream not started</span>
                    <button
                      onClick={() => setStreamActive(true)}
                      className="px-4 py-2 bg-red-800 hover:bg-red-700 text-white text-xs rounded-lg transition-colors">
                      Connect to Live Stream
                    </button>
                  </div>
                )}
              </div>

              {/* Stream URLs */}
              <div className="bg-gray-800/40 rounded-lg px-4 py-3 space-y-2">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Stream URLs</div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">HLS (browser):</div>
                  <div className="text-xs text-blue-300 font-mono break-all">{streamPreviewUrl}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">RTMP (VLC):</div>
                  <div className="text-xs text-green-300 font-mono break-all">
                    rtmp://49.37.110.161:1935/live/bts01
                  </div>
                </div>
              </div>

              <div className="text-xs text-gray-600 bg-gray-800/30 rounded px-3 py-2">
                💡 To view in VLC: Media → Open Network Stream → paste RTMP URL
              </div>
            </div>
          )}
        </div>

        {/* Modal footer — actions */}
        <div className="px-5 py-4 border-t border-gray-800 bg-gray-950 flex items-center justify-between">
          <div className="text-xs text-gray-600">
            ID: {alarm.alarm_id?.slice(0,16)}...
          </div>
          <div className="flex gap-2">
            {alarm.status === "ACTIVE" && (
              <button onClick={() => { onAck(alarm.alarm_id); onClose(); }}
                className="px-4 py-2 border border-yellow-700 text-yellow-400 rounded-lg text-xs hover:bg-yellow-900/30 transition-colors">
                Acknowledge
              </button>
            )}
            {alarm.status !== "CLEARED" && (
              <button onClick={() => { onClear(alarm.alarm_id); onClose(); }}
                className="px-4 py-2 border border-green-700 text-green-400 rounded-lg text-xs hover:bg-green-900/30 transition-colors">
                Clear Alarm
              </button>
            )}
            <button onClick={onClose}
              className="px-4 py-2 border border-gray-700 text-gray-400 rounded-lg text-xs hover:bg-gray-800 transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [alarms,      setAlarms]      = useState([]);
  const [stats,       setStats]       = useState({ total_alarms: 0, active_alarms: 0, ws_clients: 0 });
  const [wsStatus,    setWsStatus]    = useState("connecting");
  const [filter,      setFilter]      = useState("ALL");
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(null);
  const wsRef = useRef(null);

  useEffect(() => {
    fetch(`${API_URL}/alarms?limit=200`)
      .then(r => r.json())
      .then(d => { setAlarms(d); setLoading(false); })
      .catch(() => setLoading(false));
    fetch(`${API_URL}/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(console.error);
  }, []);

  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen  = () => setWsStatus("live");
      ws.onclose = () => { setWsStatus("reconnecting"); setTimeout(connect, 3000); };
      ws.onerror = () => setWsStatus("error");
      ws.onmessage = (msg) => {
        const p = JSON.parse(msg.data);
        if (p.event === "ALARM_CREATED") {
          setAlarms(prev => [p.alarm, ...prev]);
          setStats(s => ({ ...s, active_alarms: s.active_alarms + 1, total_alarms: s.total_alarms + 1 }));
        }
        if (p.event === "ALARM_ACKNOWLEDGED")
          setAlarms(prev => prev.map(a => a.alarm_id === p.alarm_id ? { ...a, status: "ACKNOWLEDGED" } : a));
        if (p.event === "ALARM_CLEARED") {
          setAlarms(prev => prev.map(a => a.alarm_id === p.alarm_id ? { ...a, status: "CLEARED" } : a));
          setStats(s => ({ ...s, active_alarms: Math.max(0, s.active_alarms - 1) }));
        }
        try { ws.send("pong"); } catch {}
      };
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  const ack = useCallback(async (id) => {
    await fetch(`${API_URL}/alarms/acknowledge`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alarm_id: id, operator_id: "NOC_OPERATOR_1" }),
    });
    setAlarms(prev => prev.map(a => a.alarm_id === id ? { ...a, status: "ACKNOWLEDGED" } : a));
  }, []);

  const clear = useCallback(async (id) => {
    await fetch(`${API_URL}/alarms/clear`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alarm_id: id, operator_id: "NOC_OPERATOR_1", reason: "Manually cleared" }),
    });
    setAlarms(prev => prev.map(a => a.alarm_id === id ? { ...a, status: "CLEARED" } : a));
  }, []);

  const filtered     = filter === "ALL" ? alarms : alarms.filter(a => a.status === filter);
  const activeAlarms = alarms.filter(a => a.status === "ACTIVE");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono text-sm">

      {/* Modal */}
      {selected && (
        <AlarmModal
          alarm={selected}
          onClose={() => setSelected(null)}
          onAck={ack}
          onClear={clear}
          rtmpStatUrl={RTMP_STAT_URL}
        />
      )}

      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div>
          <div className="text-xs text-red-500 font-bold tracking-widest uppercase">Airtel Networks</div>
          <div className="text-base font-semibold tracking-tight">BTS Theft Monitoring — NOC Dashboard</div>
          <div className="text-xs text-gray-500 mt-0.5">Restricted Area Intrusion Detection</div>
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-xs px-3 py-1 rounded-full border font-medium ${
            wsStatus === "live"
              ? "bg-green-900/40 text-green-400 border-green-700"
              : "bg-yellow-900/40 text-yellow-400 border-yellow-700"
          }`}>● {wsStatus === "live" ? "Live" : wsStatus}</span>
          <span className="text-xs text-gray-500">{new Date().toLocaleString()}</span>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-3 border-b border-gray-800">
        {[
          { label: "Active Alarms",     val: stats.active_alarms, col: "text-red-400"  },
          { label: "Total Alarms",      val: stats.total_alarms,  col: "text-gray-200" },
          { label: "Dashboard Clients", val: stats.ws_clients,    col: "text-blue-400" },
        ].map(s => (
          <div key={s.label} className="px-6 py-4 border-r border-gray-800 last:border-r-0">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{s.label}</div>
            <div className={`text-3xl font-medium ${s.col}`}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Active banner */}
      {activeAlarms.length > 0 && (
        <div className="bg-red-950/70 border-b border-red-800 px-6 py-2.5 flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-ping flex-shrink-0" />
          <span className="text-red-300 text-xs font-medium">
            {activeAlarms.length} ACTIVE INTRUSION ALARM{activeAlarms.length > 1 ? "S" : ""} —
            Sites: {[...new Set(activeAlarms.map(a => a.site_id))].join(", ")} — Response required immediately
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="px-6 py-2.5 flex gap-2 border-b border-gray-800 items-center">
        {["ALL","ACTIVE","ACKNOWLEDGED","CLEARED"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              filter === f
                ? "bg-gray-700 border-gray-500 text-white"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-gray-500"
            }`}>
            {f} <span className="ml-1.5 text-gray-600">
              {f === "ALL" ? alarms.length : alarms.filter(a => a.status === f).length}
            </span>
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-600">
          Click any row to view details, snapshot & live stream
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        {loading ? (
          <div className="px-6 py-16 text-center text-gray-600 text-xs">Loading alarms...</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-700">
            <div className="text-3xl mb-2">🛡</div>
            <div className="text-xs">No alarms in this view</div>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500 uppercase tracking-wider">
                {["Status","Severity","Threat","Site","Camera","👤","🐾","Conf","Time","Actions"].map(h => (
                  <th key={h} className="px-3 py-3 text-left font-normal whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(alarm => (
                <tr key={alarm.alarm_id}
                  onClick={() => setSelected(alarm)}
                  className={`border-b border-gray-800/50 transition-colors cursor-pointer ${
                    alarm.status === "ACTIVE"
                      ? "bg-red-950/15 hover:bg-red-950/30"
                      : "hover:bg-gray-800/40"
                  }`}>

                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[alarm.status]}`} />
                      <span className={STATUS_STYLE[alarm.status]}>{alarm.status}</span>
                    </span>
                  </td>

                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${SEV_STYLE[alarm.severity] ?? "bg-gray-800 text-gray-400 border border-gray-700"}`}>
                      {alarm.severity}
                    </span>
                  </td>

                  <td className="px-3 py-3 text-orange-300 font-medium whitespace-nowrap max-w-32">
                    <span className="block truncate">{alarm.threat_level || "—"}</span>
                  </td>

                  <td className="px-3 py-3 text-gray-300 whitespace-nowrap">{alarm.site_id}</td>
                  <td className="px-3 py-3 text-gray-400">{alarm.camera_id}</td>

                  <td className="px-3 py-3 text-center">
                    <span className={`font-bold ${alarm.person_count > 0 ? "text-red-400" : "text-gray-600"}`}>
                      {alarm.person_count ?? 0}
                    </span>
                  </td>

                  <td className="px-3 py-3 text-center">
                    <span className={`font-bold ${alarm.animal_count > 0 ? "text-purple-400" : "text-gray-600"}`}>
                      {alarm.animal_count ?? 0}
                    </span>
                  </td>

                  <td className="px-3 py-3 text-gray-300">
                    {alarm.confidence != null ? `${(alarm.confidence*100).toFixed(1)}%` : "—"}
                  </td>

                  <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{fmt(alarm.first_detected)}</td>

                  <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1.5">
                      <button onClick={() => setSelected(alarm)}
                        className="px-2 py-1 border border-gray-600 text-gray-300 rounded hover:bg-gray-700 transition-colors">
                        View
                      </button>
                      {alarm.status === "ACTIVE" && (
                        <button onClick={() => ack(alarm.alarm_id)}
                          className="px-2 py-1 border border-yellow-700 text-yellow-400 rounded hover:bg-yellow-900/30 transition-colors">
                          Ack
                        </button>
                      )}
                      {alarm.status !== "CLEARED" && (
                        <button onClick={() => clear(alarm.alarm_id)}
                          className="px-2 py-1 border border-gray-600 text-gray-400 rounded hover:bg-gray-800 transition-colors">
                          Clear
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
