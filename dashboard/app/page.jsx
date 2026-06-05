"use client";
import { useEffect, useState, useRef } from "react";

const WS_URL = process.env.NEXT_PUBLIC_ALARM_MANAGER_WS ?? "ws://localhost:8002/ws";
const API_URL = process.env.NEXT_PUBLIC_ALARM_MANAGER_URL ?? "http://localhost:8002";

const SEV_COLOR = {
  CRITICAL: "bg-red-100 text-red-800 border-red-300",
  MAJOR:    "bg-orange-100 text-orange-800 border-orange-300",
  MINOR:    "bg-yellow-100 text-yellow-800 border-yellow-300",
  WARNING:  "bg-blue-100 text-blue-800 border-blue-300",
  CLEARED:  "bg-gray-100 text-gray-500 border-gray-200",
};

const STATUS_DOT = {
  ACTIVE:       "bg-red-500 animate-pulse",
  ACKNOWLEDGED: "bg-yellow-400",
  CLEARED:      "bg-green-400",
};

export default function Dashboard() {
  const [alarms, setAlarms]     = useState([]);
  const [stats, setStats]       = useState({ total_alarms: 0, active_alarms: 0, ws_clients: 0 });
  const [wsStatus, setWsStatus] = useState("connecting");
  const [filter, setFilter]     = useState("ALL");
  const wsRef = useRef(null);

  // ── Fetch initial alarms ──────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_URL}/alarms?limit=100`)
      .then(r => r.json())
      .then(data => setAlarms(data))
      .catch(console.error);

    fetch(`${API_URL}/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(console.error);
  }, []);

  // ── WebSocket live updates ────────────────────────────────────────────────
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setWsStatus("live");
      ws.onclose = () => {
        setWsStatus("reconnecting");
        setTimeout(connect, 3000);
      };
      ws.onerror = () => setWsStatus("error");

      ws.onmessage = (msg) => {
        const payload = JSON.parse(msg.data);
        if (payload.event === "ALARM_CREATED") {
          setAlarms(prev => [payload.alarm, ...prev]);
          setStats(s => ({ ...s, active_alarms: s.active_alarms + 1, total_alarms: s.total_alarms + 1 }));
        }
        if (payload.event === "ALARM_ACKNOWLEDGED") {
          setAlarms(prev => prev.map(a =>
            a.alarm_id === payload.alarm_id ? { ...a, status: "ACKNOWLEDGED" } : a
          ));
        }
        if (payload.event === "ALARM_CLEARED") {
          setAlarms(prev => prev.map(a =>
            a.alarm_id === payload.alarm_id ? { ...a, status: "CLEARED" } : a
          ));
          setStats(s => ({ ...s, active_alarms: Math.max(0, s.active_alarms - 1) }));
        }

        // keep-alive pong
        ws.send("pong");
      };
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  const acknowledge = async (alarm_id) => {
    await fetch(`${API_URL}/alarms/acknowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alarm_id, operator_id: "NOC_OPERATOR_1" }),
    });
  };

  const clear = async (alarm_id) => {
    await fetch(`${API_URL}/alarms/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alarm_id, operator_id: "NOC_OPERATOR_1", reason: "Manually cleared" }),
    });
  };

  const filtered = alarms.filter(a => filter === "ALL" || a.status === filter);
  const activeAlarms = alarms.filter(a => a.status === "ACTIVE");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono">

      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
        <div>
          <div className="text-xs text-gray-500 tracking-widest uppercase">Airtel Networks</div>
          <div className="text-lg font-medium tracking-tight">Site Theft Monitoring — NOC Dashboard</div>
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-xs px-3 py-1 rounded-full border font-medium ${
            wsStatus === "live" ? "bg-green-900/40 text-green-400 border-green-700" :
            wsStatus === "reconnecting" ? "bg-yellow-900/40 text-yellow-400 border-yellow-700" :
            "bg-red-900/40 text-red-400 border-red-700"
          }`}>
            ● {wsStatus === "live" ? "Live" : wsStatus}
          </span>
          <span className="text-xs text-gray-500">{new Date().toLocaleString()}</span>
        </div>
      </header>

      {/* Stats bar */}
      <div className="grid grid-cols-3 border-b border-gray-800">
        {[
          { label: "Active alarms", val: stats.active_alarms, accent: "text-red-400" },
          { label: "Total alarms",  val: stats.total_alarms,  accent: "text-gray-200" },
          { label: "Dashboard clients", val: stats.ws_clients, accent: "text-blue-400" },
        ].map(s => (
          <div key={s.label} className="px-6 py-4 border-r border-gray-800 last:border-r-0">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{s.label}</div>
            <div className={`text-3xl font-medium ${s.accent}`}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Active alarm banner */}
      {activeAlarms.length > 0 && (
        <div className="bg-red-950/60 border-b border-red-800 px-6 py-3 flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
          <span className="text-red-300 text-sm font-medium">
            {activeAlarms.length} active intrusion alarm{activeAlarms.length > 1 ? "s" : ""} —
            Sites: {[...new Set(activeAlarms.map(a => a.site_id))].join(", ")}
          </span>
        </div>
      )}

      {/* Filters */}
      <div className="px-6 py-3 flex gap-2 border-b border-gray-800">
        {["ALL", "ACTIVE", "ACKNOWLEDGED", "CLEARED"].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1.5 rounded border transition-colors ${
              filter === f
                ? "bg-gray-700 border-gray-500 text-white"
                : "bg-transparent border-gray-700 text-gray-400 hover:border-gray-500"
            }`}>
            {f}
            <span className="ml-1.5 text-gray-500">
              {f === "ALL" ? alarms.length : alarms.filter(a => a.status === f).length}
            </span>
          </button>
        ))}
      </div>

      {/* Alarm table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
              {["Status", "Severity", "Site", "Camera", "Confidence", "Detected", "Description", "Actions"].map(h => (
                <th key={h} className="px-4 py-3 text-left font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-600">No alarms</td></tr>
            )}
            {filtered.map(alarm => (
              <tr key={alarm.alarm_id}
                className={`border-b border-gray-800/50 hover:bg-gray-900/50 transition-colors ${
                  alarm.status === "ACTIVE" ? "bg-red-950/10" : ""
                }`}>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${STATUS_DOT[alarm.status] ?? "bg-gray-500"}`} />
                    <span className="text-xs text-gray-400">{alarm.status}</span>
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded border font-medium ${SEV_COLOR[alarm.severity] ?? ""}`}>
                    {alarm.severity}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-300">{alarm.site_id}</td>
                <td className="px-4 py-3 text-gray-400">{alarm.camera_id}</td>
                <td className="px-4 py-3 text-gray-300">{(alarm.confidence * 100).toFixed(0)}%</td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {new Date(alarm.first_detected).toLocaleTimeString()}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate">{alarm.description}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {alarm.status === "ACTIVE" && (
                      <button onClick={() => acknowledge(alarm.alarm_id)}
                        className="text-xs px-2 py-1 border border-yellow-700 text-yellow-400 rounded hover:bg-yellow-900/30 transition-colors">
                        Ack
                      </button>
                    )}
                    {alarm.status !== "CLEARED" && (
                      <button onClick={() => clear(alarm.alarm_id)}
                        className="text-xs px-2 py-1 border border-gray-600 text-gray-400 rounded hover:bg-gray-800 transition-colors">
                        Clear
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
