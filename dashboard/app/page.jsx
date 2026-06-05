"use client";

import { useEffect, useState, useCallback } from "react";

const ALARM_MANAGER_URL =
  process.env.NEXT_PUBLIC_ALARM_MANAGER_URL || "http://localhost:8002";

const SEVERITY_STYLES = {
  CRITICAL: "bg-red-100 text-red-800 border border-red-300",
  HIGH:     "bg-orange-100 text-orange-800 border border-orange-300",
  MEDIUM:   "bg-yellow-100 text-yellow-800 border border-yellow-300",
  LOW:      "bg-blue-100 text-blue-800 border border-blue-300",
};

const STATUS_STYLES = {
  ACTIVE:       "bg-red-500 text-white",
  ACKNOWLEDGED: "bg-yellow-500 text-white",
  CLEARED:      "bg-green-600 text-white",
};

function Badge({ text, className }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${className}`}>
      {text}
    </span>
  );
}

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

export default function NOCDashboard() {
  const [alarms, setAlarms] = useState([]);
  const [wsStatus, setWsStatus] = useState("connecting");
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);

  // Initial fetch
  useEffect(() => {
    fetch(`${ALARM_MANAGER_URL}/alarms?limit=200`)
      .then((r) => r.json())
      .then((data) => {
  const sorted = data.sort(
    (a, b) =>
      new Date(b.timestamp) -
      new Date(a.timestamp)
  );

  setAlarms(sorted);
  setLoading(false);
})
      .catch(() => setLoading(false));
  }, []);

  // WebSocket live feed
  useEffect(() => {
    const wsUrl = ALARM_MANAGER_URL.replace(/^http/, "ws") + "/ws";
    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => setWsStatus("live");

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.event === "new_alarm") {
  setAlarms((prev) => {
    const exists = prev.find(
      (a) =>
        a.camera_id === msg.alarm.camera_id &&
        a.status === "ACTIVE"
    );

    if (exists) return prev;

    return [msg.alarm, ...prev];
  });
} else if (msg.event === "alarm_updated") {
          setAlarms((prev) =>
            prev.map((a) => (a.id === msg.alarm.id ? msg.alarm : a))
          );
        }
      };

      ws.onclose = () => {
        setWsStatus("reconnecting");
        reconnectTimer = setTimeout(connect, 4000);
      };

      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  const updateAlarm = useCallback(async (id, status) => {
    const res = await fetch(`${ALARM_MANAGER_URL}/alarms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) alert("Failed to update alarm");
  }, []);

  const activeCount = alarms.filter((a) => a.status === "ACTIVE").length;

  const displayed = filter === "ALL"
    ? alarms
    : alarms.filter((a) => a.status === filter);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-mono">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <h1 className="text-lg font-bold tracking-tight text-white">
            Airtel BTS — Theft Monitoring NOC
          </h1>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold ${
              wsStatus === "live"
                ? "bg-green-900 text-green-300"
                : "bg-yellow-900 text-yellow-300"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                wsStatus === "live" ? "bg-green-400" : "bg-yellow-400 animate-pulse"
              }`}
            />
            {wsStatus === "live" ? "Live" : "Reconnecting…"}
          </span>
          <span className="text-gray-400">
            {activeCount} active alarm{activeCount !== 1 ? "s" : ""}
          </span>
        </div>
      </header>

      {/* Active alarm banner */}
      {activeCount > 0 && (
        <div className="bg-red-900/60 border-b border-red-700 px-6 py-2 text-sm text-red-200 flex items-center gap-2">
          <span className="text-red-400 font-bold">⚠</span>
          {activeCount} active intrusion alarm{activeCount !== 1 ? "s" : ""} require attention
        </div>
      )}

      {/* Filters */}
      <div className="px-6 py-3 flex gap-2 border-b border-gray-800">
        {["ALL", "ACTIVE", "ACKNOWLEDGED", "CLEARED"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
              filter === f
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-xs text-gray-500 self-center">
          {displayed.length} record{displayed.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Alarm table */}
      <div className="px-6 py-4">
        {loading ? (
          <p className="text-gray-500 text-sm">Loading alarms…</p>
        ) : displayed.length === 0 ? (
          <div className="text-center py-20 text-gray-600">
            <p className="text-4xl mb-3">🛡</p>
            <p className="text-sm">No alarms in this view</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
                  <th className="pb-2 pr-4">Time</th>
                  <th className="pb-2 pr-4">Camera</th>
                  <th className="pb-2 pr-4">Site</th>
                  <th className="pb-2 pr-4">Zone</th>
                  <th className="pb-2 pr-4">Confidence</th>
                  <th className="pb-2 pr-4">Severity</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((alarm) => (
                  <tr
                    key={alarm.id}
                    className={`border-b border-gray-800/60 ${
                      alarm.status === "ACTIVE"
                        ? "bg-red-950/20"
                        : "hover:bg-gray-900/40"
                    } transition-colors`}
                  >
                    <td className="py-2.5 pr-4 text-gray-400 whitespace-nowrap">
                      {formatTime(alarm.timestamp)}
                    </td>
                    <td className="py-2.5 pr-4 text-white font-semibold">
                      {alarm.camera_id}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-300">
                      {alarm.site_id || "—"}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-300">
                      {alarm.zone_id || "—"}
                    </td>
                   <td className="py-2.5 pr-4 text-gray-300">
                      {alarm.confidence != null
                      ? `${(alarm.confidence * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge
                        text={alarm.severity}
                        className={SEVERITY_STYLES[alarm.severity] || ""}
                      />
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge
                        text={alarm.status}
                        className={STATUS_STYLES[alarm.status] || ""}
                      />
                    </td>
                    <td className="py-2.5">
                      <div className="flex gap-2">
                        {alarm.status === "ACTIVE" && (
                          <button
                            onClick={() => updateAlarm(alarm.id, "ACKNOWLEDGED")}
                            className="px-2 py-1 text-xs rounded bg-yellow-800/60 text-yellow-300 hover:bg-yellow-700/60 transition-colors"
                          >
                            Ack
                          </button>
                        )}
                        {alarm.status !== "CLEARED" && (
                          <button
                            onClick={() => updateAlarm(alarm.id, "CLEARED")}
                            className="px-2 py-1 text-xs rounded bg-green-800/60 text-green-300 hover:bg-green-700/60 transition-colors"
                          >
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
        )}
      </div>
    </div>
  );
}