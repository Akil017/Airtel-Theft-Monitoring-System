"use client";
import { useEffect, useState, useRef } from "react";

const WS_URL  = process.env.NEXT_PUBLIC_ALARM_MANAGER_WS  ?? "ws://localhost:8002/ws";
const API_URL = process.env.NEXT_PUBLIC_ALARM_MANAGER_URL ?? "http://localhost:8002";

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

export default function Dashboard() {
  const [alarms,   setAlarms]   = useState([]);
  const [stats,    setStats]    = useState({ total_alarms: 0, active_alarms: 0, ws_clients: 0 });
  const [wsStatus, setWsStatus] = useState("connecting");
  const [filter,   setFilter]   = useState("ALL");
  const [loading,  setLoading]  = useState(true);
  const wsRef = useRef(null);

  // Initial load
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

  // WebSocket
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

  const ack = async (id) => {
    await fetch(`${API_URL}/alarms/acknowledge`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alarm_id: id, operator_id: "NOC_OPERATOR_1" }),
    });
  };
  const clear = async (id) => {
    await fetch(`${API_URL}/alarms/clear`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alarm_id: id, operator_id: "NOC_OPERATOR_1", reason: "Manually cleared" }),
    });
  };

  const filtered     = filter === "ALL" ? alarms : alarms.filter(a => a.status === filter);
  const activeAlarms = alarms.filter(a => a.status === "ACTIVE");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono text-sm">

      {/* ── Header ── */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div>
          <div className="text-xs text-red-500 font-bold tracking-widest uppercase">Airtel Networks</div>
          <div className="text-base font-semibold tracking-tight">
            BTS Theft Monitoring — NOC Dashboard
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            Restricted Area Intrusion Detection
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-xs px-3 py-1 rounded-full border font-medium ${
            wsStatus === "live"
              ? "bg-green-900/40 text-green-400 border-green-700"
              : "bg-yellow-900/40 text-yellow-400 border-yellow-700"
          }`}>
            ● {wsStatus === "live" ? "Live" : wsStatus}
          </span>
          <span className="text-xs text-gray-500">{new Date().toLocaleString()}</span>
        </div>
      </header>

      {/* ── Stats bar ── */}
      <div className="grid grid-cols-3 border-b border-gray-800">
        {[
          { label: "Active Alarms",    val: stats.active_alarms, col: "text-red-400"  },
          { label: "Total Alarms",     val: stats.total_alarms,  col: "text-gray-200" },
          { label: "Dashboard Clients",val: stats.ws_clients,    col: "text-blue-400" },
        ].map(s => (
          <div key={s.label} className="px-6 py-4 border-r border-gray-800 last:border-r-0">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{s.label}</div>
            <div className={`text-3xl font-medium ${s.col}`}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* ── Active alarm banner ── */}
      {activeAlarms.length > 0 && (
        <div className="bg-red-950/70 border-b border-red-800 px-6 py-2.5 flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-ping flex-shrink-0" />
          <span className="text-red-300 text-xs font-medium">
            {activeAlarms.length} ACTIVE INTRUSION ALARM{activeAlarms.length > 1 ? "S" : ""} —
            Sites: {[...new Set(activeAlarms.map(a => a.site_id))].join(", ")} —
            Response required immediately
          </span>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="px-6 py-2.5 flex gap-2 border-b border-gray-800 items-center">
        {["ALL", "ACTIVE", "ACKNOWLEDGED", "CLEARED"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              filter === f
                ? "bg-gray-700 border-gray-500 text-white"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-gray-500"
            }`}>
            {f}
            <span className="ml-1.5 text-gray-600">
              {f === "ALL" ? alarms.length : alarms.filter(a => a.status === f).length}
            </span>
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-600">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* ── Table ── */}
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
                {["Status","Severity","Threat Level","Site","Camera",
                  "Persons","Animals","Confidence","Time","Response","Actions"].map(h => (
                  <th key={h} className="px-3 py-3 text-left font-normal whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(alarm => (
                <tr key={alarm.alarm_id}
                  className={`border-b border-gray-800/50 transition-colors ${
                    alarm.status === "ACTIVE"
                      ? "bg-red-950/15 hover:bg-red-950/25"
                      : "hover:bg-gray-900/40"
                  }`}>

                  {/* Status */}
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[alarm.status] ?? "bg-gray-500"}`} />
                      <span className={STATUS_STYLE[alarm.status] ?? "text-gray-400"}>
                        {alarm.status}
                      </span>
                    </span>
                  </td>

                  {/* Severity */}
                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${SEV_STYLE[alarm.severity] ?? "bg-gray-800 text-gray-400 border border-gray-700"}`}>
                      {alarm.severity}
                    </span>
                  </td>

                  {/* Threat level */}
                  <td className="px-3 py-3 text-orange-300 font-medium whitespace-nowrap">
                    {alarm.threat_level || "—"}
                  </td>

                  {/* Site */}
                  <td className="px-3 py-3 text-gray-300 whitespace-nowrap">{alarm.site_id}</td>

                  {/* Camera */}
                  <td className="px-3 py-3 text-gray-400">{alarm.camera_id}</td>

                  {/* Persons */}
                  <td className="px-3 py-3 text-center">
                    <span className={`font-bold ${alarm.person_count > 0 ? "text-red-400" : "text-gray-600"}`}>
                      {alarm.person_count ?? 0}
                    </span>
                  </td>

                  {/* Animals */}
                  <td className="px-3 py-3 text-center">
                    <span className={`font-bold ${alarm.animal_count > 0 ? "text-purple-400" : "text-gray-600"}`}>
                      {alarm.animal_count ?? 0}
                    </span>
                  </td>

                  {/* Confidence */}
                  <td className="px-3 py-3 text-gray-300">
                    {alarm.confidence != null ? `${(alarm.confidence * 100).toFixed(1)}%` : "—"}
                  </td>

                  {/* Time */}
                  <td className="px-3 py-3 text-gray-500 whitespace-nowrap">
                    {fmt(alarm.first_detected)}
                  </td>

                  {/* Response */}
                  <td className="px-3 py-3 text-blue-300 max-w-xs">
                    <span className="block truncate">{alarm.response || "—"}</span>
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-3">
                    <div className="flex gap-1.5">
                      {alarm.status === "ACTIVE" && (
                        <button onClick={() => ack(alarm.alarm_id)}
                          className="px-2 py-1 border border-yellow-700 text-yellow-400 rounded hover:bg-yellow-900/30 transition-colors whitespace-nowrap">
                          Ack
                        </button>
                      )}
                      {alarm.status !== "CLEARED" && (
                        <button onClick={() => clear(alarm.alarm_id)}
                          className="px-2 py-1 border border-gray-600 text-gray-400 rounded hover:bg-gray-800 transition-colors whitespace-nowrap">
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
