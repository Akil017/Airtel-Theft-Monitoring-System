"use client";
import { useEffect, useState, useCallback, useRef } from "react";

const ALARM_MANAGER_URL = process.env.NEXT_PUBLIC_ALARM_MANAGER_URL || "http://74.225.144.11:8002";
const ALARM_MANAGER_WS  = process.env.NEXT_PUBLIC_ALARM_MANAGER_WS  || "ws://74.225.144.11:8002/ws";
const RTMP_SERVER_URL   = "http://74.225.144.11:8080";
const HLS_URL           = `${RTMP_SERVER_URL}/hls/bts01.m3u8`;
const PLAYER_URL        = `${RTMP_SERVER_URL}/player.html`;

// ── Severity / status style maps ──────────────────────────────────────────────
const SEVERITY = {
  CRITICAL: { bg:"bg-red-950",    border:"border-red-500",    badge:"bg-red-500 text-white",       dot:"bg-red-500",    glow:"shadow-red-500/30"    },
  HIGH:     { bg:"bg-orange-950", border:"border-orange-500", badge:"bg-orange-500 text-white",    dot:"bg-orange-400", glow:"shadow-orange-500/20" },
  "MID-HIGH":{ bg:"bg-orange-950",border:"border-orange-400", badge:"bg-orange-400 text-white",   dot:"bg-orange-300", glow:""                     },
  MEDIUM:   { bg:"bg-yellow-950", border:"border-yellow-500", badge:"bg-yellow-500 text-black",   dot:"bg-yellow-400", glow:""                     },
  LOW:      { bg:"bg-blue-950",   border:"border-blue-500",   badge:"bg-blue-500 text-white",     dot:"bg-blue-400",   glow:""                     },
};
const STATUS = {
  ACTIVE:       "bg-red-500/20 text-red-400 border border-red-500/40",
  ACKNOWLEDGED: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40",
  CLEARED:      "bg-green-500/20 text-green-400 border border-green-500/40",
};

function fmtTime(ts) { if (!ts) return "—"; return new Date(ts).toLocaleTimeString("en-IN", {hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
function fmtDate(ts) { if (!ts) return "—"; return new Date(ts).toLocaleDateString("en-IN", {day:"2-digit",month:"short",year:"numeric"}); }
function fmtDuration(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

// ── Alarm sound (Web Audio API — no external file needed) ─────────────────────
function playAlarmSound(severity = "HIGH") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();

    const patterns = {
      CRITICAL: [
        { freq:1800, dur:0.12 }, { freq:0, dur:0.05 },
        { freq:1800, dur:0.12 }, { freq:0, dur:0.05 },
        { freq:2200, dur:0.25 }, { freq:0, dur:0.10 },
        { freq:1800, dur:0.12 }, { freq:0, dur:0.05 },
        { freq:1800, dur:0.12 }, { freq:0, dur:0.05 },
        { freq:2200, dur:0.40 },
      ],
      HIGH: [
        { freq:1100, dur:0.20 }, { freq:0, dur:0.08 },
        { freq:1300, dur:0.20 }, { freq:0, dur:0.08 },
        { freq:1100, dur:0.30 },
      ],
    };

    const seq = patterns[severity] || patterns.HIGH;
    let time  = ctx.currentTime;

    seq.forEach(({ freq, dur }) => {
      if (freq > 0) {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type      = severity === "CRITICAL" ? "sawtooth" : "square";
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(0.35, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
        osc.start(time);
        osc.stop(time + dur);
      }
      time += dur;
    });
  } catch (e) {
    // AudioContext blocked — silently skip
    console.warn("Alarm sound blocked:", e.message);
  }
}

// ── Pulsing dot ───────────────────────────────────────────────────────────────
function PulseDot({ color = "bg-red-500" }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-60`} />
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}

// ── Live stream panel ──────────────────────────────────────────────────────────
function LiveStreamPanel({ compact = false }) {
  const [streamStatus, setStreamStatus] = useState("checking");
  const iframeRef = useRef(null);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${RTMP_SERVER_URL}/health`, { signal: AbortSignal.timeout(3000) });
        setStreamStatus(r.ok ? "online" : "offline");
      } catch { setStreamStatus("offline"); }
    };
    check();
    const t = setInterval(check, 10000);
    return () => clearInterval(t);
  }, []);

  const content = streamStatus === "online"
    ? <iframe ref={iframeRef} src={PLAYER_URL} className="w-full h-full border-0" title="Live Feed" allowFullScreen />
    : (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
        <svg className="w-10 h-10 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
        </svg>
        <span className="text-xs font-mono">STREAM OFFLINE</span>
        <span className="text-xs text-gray-600">Enable RTMP in EzyLiv+ app</span>
      </div>
    );

  if (compact) return (
    <div className="relative w-full aspect-video bg-gray-950 rounded-lg overflow-hidden border border-gray-700">
      {content}
      <div className={`absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-mono ${streamStatus === "online" ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-gray-800 text-gray-500 border border-gray-700"}`}>
        <PulseDot color={streamStatus === "online" ? "bg-green-500" : "bg-gray-500"} />
        {streamStatus === "online" ? "LIVE" : "OFFLINE"}
      </div>
    </div>
  );

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="text-sm font-semibold text-white font-mono tracking-wide">CAM-BTS-01 — LIVE FEED</span>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border ${streamStatus === "online" ? "bg-green-500/10 text-green-400 border-green-500/30" : "bg-gray-800 text-gray-500 border-gray-700"}`}>
          <PulseDot color={streamStatus === "online" ? "bg-green-500" : "bg-gray-500"} />
          {streamStatus === "online" ? "STREAMING" : "OFFLINE"}
        </div>
      </div>
      <div className="relative aspect-video bg-black">{content}</div>
      <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-t border-gray-800">
        <span className="text-xs font-mono text-gray-600">AIRTEL-ASM-BTS-001</span>
        <a href={PLAYER_URL} target="_blank" rel="noreferrer" className="text-xs font-mono text-gray-600 hover:text-blue-400 transition-colors">OPEN ↗</a>
      </div>
    </div>
  );
}

// ── Snapshot gallery — fetches REAL snapshots from alarm-manager ──────────────
function SnapshotGallery({ alarm }) {
  const [snapshots, setSnapshots] = useState(null);
  const [loading,   setLoading  ] = useState(true);
  const [selected,  setSelected ] = useState(null);

  useEffect(() => {
    if (!alarm?.alarm_id && !alarm?.id) return;
    const id = alarm.alarm_id || `ALM-${alarm.id?.slice(0,8).toUpperCase()}`;

    setLoading(true);
    fetch(`${ALARM_MANAGER_URL}/snapshots/alarm/${encodeURIComponent(id)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        setSnapshots(data?.snapshots || []);
        setLoading(false);
      })
      .catch(() => { setSnapshots([]); setLoading(false); });
  }, [alarm?.alarm_id, alarm?.id]);

  if (loading) return (
    <div className="space-y-2">
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Detection Snapshots</p>
      <div className="grid grid-cols-3 gap-2">
        {[0,1,2].map(i => (
          <div key={i} className="aspect-video bg-gray-900 rounded-lg border border-gray-800 animate-pulse" />
        ))}
      </div>
    </div>
  );

  if (!snapshots || snapshots.length === 0) return (
    <div className="space-y-2">
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Detection Snapshots</p>
      <div className="flex flex-col items-center justify-center py-10 gap-3 bg-gray-950 rounded-lg border border-gray-800">
        <svg className="w-8 h-8 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        </svg>
        <p className="text-xs font-mono text-gray-600">No snapshots yet</p>
        <p className="text-xs text-gray-700 font-mono">Auto-captured when YOLO detects a person</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Detection Snapshots ({snapshots.length})</p>
        <span className="text-xs font-mono text-green-400">● Auto-captured at detection</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {snapshots.map((snap, i) => (
          <div
            key={snap.filename}
            onClick={() => setSelected(snap)}
            className="relative aspect-video bg-gray-950 rounded-lg border border-gray-800 overflow-hidden cursor-pointer hover:border-blue-500 transition-colors group"
          >
            <img
              src={`${ALARM_MANAGER_URL}${snap.url}`}
              alt={`Snapshot ${i + 1}`}
              className="w-full h-full object-cover"
              onError={e => { e.target.style.display = "none"; }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
              <span className="text-xs font-mono text-white">🔍 Enlarge</span>
            </div>
            <div className="absolute top-1 left-1 bg-black/70 rounded px-1.5 py-0.5">
              <span className="text-xs font-mono text-yellow-400">{snap.offset || `+${i*2}s`}</span>
            </div>
            <div className="absolute bottom-1 right-1 bg-black/70 rounded px-1 py-0.5">
              <span className="text-xs font-mono text-gray-400">{fmtTime(snap.taken_at)}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-700 font-mono">Stored in /shared/snapshots · Click to enlarge</p>

      {/* Lightbox */}
      {selected && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="relative max-w-4xl w-full" onClick={e => e.stopPropagation()}>
            <img src={`${ALARM_MANAGER_URL}${selected.url}`} alt="Snapshot" className="w-full rounded-xl border border-gray-700" />
            <div className="flex items-center justify-between mt-2 px-1">
              <span className="text-xs font-mono text-gray-400">{selected.filename}</span>
              <div className="flex gap-3">
                <a href={`${ALARM_MANAGER_URL}${selected.url}`} download className="text-xs font-mono text-blue-400 hover:text-blue-300">Download ↓</a>
                <button onClick={() => setSelected(null)} className="text-xs font-mono text-gray-500 hover:text-white">Close ✕</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Performance metrics card ───────────────────────────────────────────────────
function PerfMetrics({ alarms }) {
  const active    = alarms.filter(a => a.status === "ACTIVE").length;
  const cleared   = alarms.filter(a => a.status === "CLEARED").length;
  const critical  = alarms.filter(a => a.severity === "CRITICAL").length;
  const total     = alarms.length;
  const ackRate   = total > 0 ? Math.round((alarms.filter(a => a.status !== "ACTIVE").length / total) * 100) : 100;

  // MTTA: mean time to acknowledge (seconds)
  const acknowledged = alarms.filter(a => a.acknowledged_at && a.created_at);
  const mtta = acknowledged.length > 0
    ? Math.round(acknowledged.reduce((sum, a) => sum + (new Date(a.acknowledged_at) - new Date(a.created_at)) / 1000, 0) / acknowledged.length)
    : null;

  const metrics = [
    { label:"Response Rate", value:`${ackRate}%`, sub:"alarms handled", color: ackRate >= 90 ? "text-green-400" : ackRate >= 70 ? "text-yellow-400" : "text-red-400" },
    { label:"MTTA",          value: mtta != null ? `${mtta}s` : "—", sub:"mean time to ack", color:"text-blue-400" },
    { label:"Critical",      value: critical,  sub:"today",           color: critical > 0 ? "text-red-400" : "text-gray-400" },
    { label:"Cleared",       value: cleared,   sub:"resolved",        color:"text-green-400" },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {metrics.map(m => (
        <div key={m.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-2">{m.label}</p>
          <p className={`text-3xl font-bold font-mono ${m.color}`}>{m.value}</p>
          <p className="text-xs font-mono text-gray-700 mt-1">{m.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ── WhatsApp contacts panel ────────────────────────────────────────────────────
function ContactsPanel({ onClose }) {
  const [contacts,   setContacts  ] = useState([]);
  const [loading,    setLoading   ] = useState(true);
  const [form,       setForm      ] = useState({ name:"", phone:"", role:"NOC Operator", notify_high:true, notify_critical:true });
  const [saving,     setSaving    ] = useState(false);
  const [testStatus, setTestStatus] = useState({});
  const [editingId,  setEditingId ] = useState(null);
  const [error,      setError     ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${ALARM_MANAGER_URL}/alerts/contacts`);
      if (r.ok) setContacts(await r.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim()) { setError("Name and phone are required"); return; }
    setSaving(true); setError("");
    try {
      const method = editingId ? "PUT" : "POST";
      const url    = editingId ? `${ALARM_MANAGER_URL}/alerts/contacts/${editingId}` : `${ALARM_MANAGER_URL}/alerts/contacts`;
      const r = await fetch(url, { method, headers:{"Content-Type":"application/json"}, body: JSON.stringify(form) });
      if (r.ok) {
        setForm({ name:"", phone:"", role:"NOC Operator", notify_high:true, notify_critical:true });
        setEditingId(null);
        await load();
      } else {
        const d = await r.json();
        setError(d.detail || "Save failed");
      }
    } catch (e) { setError(String(e)); }
    setSaving(false);
  };

  const remove = async (id) => {
    if (!confirm("Remove this contact?")) return;
    await fetch(`${ALARM_MANAGER_URL}/alerts/contacts/${id}`, { method:"DELETE" });
    await load();
  };

  const testContact = async (id, name) => {
    setTestStatus(s => ({ ...s, [id]:"sending" }));
    try {
      const r = await fetch(`${ALARM_MANAGER_URL}/alerts/contacts/${id}/test`, { method:"POST" });
      const d = await r.json();
      setTestStatus(s => ({ ...s, [id]: d.status === "sent" ? "sent" : "failed" }));
    } catch { setTestStatus(s => ({ ...s, [id]:"failed" })); }
    setTimeout(() => setTestStatus(s => { const n={...s}; delete n[id]; return n; }), 3000);
  };

  const startEdit = (c) => {
    setForm({ name:c.name, phone:c.phone, role:c.role, notify_high:c.notify_high, notify_critical:c.notify_critical });
    setEditingId(c.id);
  };

  const toggleEnabled = async (c) => {
    await fetch(`${ALARM_MANAGER_URL}/alerts/contacts/${c.id}`, {
      method:"PUT", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ enabled: !c.enabled })
    });
    await load();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-500/10 border border-green-500/30 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.890-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-white font-bold font-mono">WhatsApp Alert Contacts</h2>
              <p className="text-xs text-gray-500 font-mono">{contacts.length} contacts · instant alarm notifications</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Add / Edit form */}
          <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
            <p className="text-xs font-mono text-gray-400 uppercase tracking-wider mb-1">
              {editingId ? "✏️ Edit Contact" : "➕ Add New Contact"}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-mono text-gray-500 block mb-1">Name *</label>
                <input
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-green-500 transition-colors"
                  placeholder="e.g. Rahul Sharma"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-mono text-gray-500 block mb-1">WhatsApp Number *</label>
                <input
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-green-500 transition-colors"
                  placeholder="+919876543210"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs font-mono text-gray-500 block mb-1">Role</label>
                <select
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-green-500"
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                >
                  {["NOC Operator","Security Guard","Site Manager","Circle Manager","CTO"].map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2 justify-end">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.notify_high} onChange={e => setForm(f => ({ ...f, notify_high: e.target.checked }))} className="accent-orange-500" />
                  <span className="text-xs font-mono text-orange-400">HIGH alerts</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.notify_critical} onChange={e => setForm(f => ({ ...f, notify_critical: e.target.checked }))} className="accent-red-500" />
                  <span className="text-xs font-mono text-red-400">CRITICAL alerts</span>
                </label>
              </div>
            </div>
            {error && <p className="text-xs font-mono text-red-400">⚠ {error}</p>}
            <div className="flex gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="px-4 py-2 bg-green-500/10 border border-green-500/30 text-green-400 text-sm font-mono rounded-lg hover:bg-green-500/20 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving…" : editingId ? "Update Contact" : "Add Contact"}
              </button>
              {editingId && (
                <button
                  onClick={() => { setEditingId(null); setForm({ name:"", phone:"", role:"NOC Operator", notify_high:true, notify_critical:true }); }}
                  className="px-4 py-2 bg-gray-800 border border-gray-700 text-gray-400 text-sm font-mono rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          {/* Contact list */}
          {loading ? (
            <div className="text-center py-8 text-gray-600 font-mono text-sm">Loading contacts…</div>
          ) : contacts.length === 0 ? (
            <div className="text-center py-8 text-gray-700 font-mono text-sm">No contacts yet — add one above</div>
          ) : (
            <div className="space-y-2">
              {contacts.map(c => (
                <div key={c.id} className={`flex items-center gap-3 p-3 bg-gray-950 border rounded-xl transition-colors ${c.enabled ? "border-gray-800" : "border-gray-800/50 opacity-60"}`}>
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-green-400">{c.name[0]?.toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-white">{c.name}</span>
                      <span className="text-xs font-mono text-gray-600">{c.role}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-mono text-gray-400">{c.phone}</span>
                      {c.notify_critical && <span className="text-xs font-mono text-red-400 border border-red-500/20 px-1 rounded">CRIT</span>}
                      {c.notify_high && <span className="text-xs font-mono text-orange-400 border border-orange-500/20 px-1 rounded">HIGH</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Test button */}
                    <button
                      onClick={() => testContact(c.id, c.name)}
                      disabled={testStatus[c.id] === "sending"}
                      className={`px-2 py-1 text-xs font-mono rounded border transition-colors ${
                        testStatus[c.id] === "sent"    ? "bg-green-500/20 border-green-500/40 text-green-400" :
                        testStatus[c.id] === "failed"  ? "bg-red-500/20 border-red-500/40 text-red-400" :
                        "bg-gray-800 border-gray-700 text-gray-400 hover:text-white"
                      }`}
                    >
                      {testStatus[c.id] === "sending" ? "…" : testStatus[c.id] === "sent" ? "✓ Sent" : testStatus[c.id] === "failed" ? "✗ Failed" : "Test"}
                    </button>
                    {/* Enable toggle */}
                    <button
                      onClick={() => toggleEnabled(c)}
                      className={`px-2 py-1 text-xs font-mono rounded border transition-colors ${c.enabled ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-gray-800 border-gray-700 text-gray-600"}`}
                    >
                      {c.enabled ? "ON" : "OFF"}
                    </button>
                    {/* Edit */}
                    <button onClick={() => startEdit(c)} className="p-1.5 text-gray-600 hover:text-white rounded hover:bg-gray-800 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    {/* Delete */}
                    <button onClick={() => remove(c.id)} className="p-1.5 text-gray-600 hover:text-red-400 rounded hover:bg-gray-800 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Twilio setup note */}
          <div className="bg-blue-950/40 border border-blue-500/20 rounded-xl p-4">
            <p className="text-xs font-mono text-blue-400 mb-2">⚙ WhatsApp Setup (Twilio)</p>
            <div className="space-y-1 text-xs font-mono text-gray-500">
              <p>1. Create account at twilio.com/try-twilio</p>
              <p>2. Enable WhatsApp Sandbox in Twilio Console</p>
              <p>3. Add to .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN</p>
              <p>4. Recipients must send "join &lt;sandbox-word&gt;" to +14155238886 once</p>
              <p className="text-blue-500 mt-1">Alarm sound links are included in every alert message</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Alarm detail modal with tabs ──────────────────────────────────────────────
function AlarmDetail({ alarm, onClose, onAck, onClear }) {
  const sev  = SEVERITY[alarm.severity] || SEVERITY.HIGH;
  const [tab, setTab] = useState("details");

  const tabs = ["details", "snapshots", "live"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className={`w-full max-w-3xl bg-gray-900 border ${sev.border} rounded-2xl shadow-2xl overflow-hidden`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${sev.border} bg-gray-950`}>
          <div className="flex items-center gap-3">
            <PulseDot color={sev.dot} />
            <div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-mono px-2 py-0.5 rounded ${sev.badge}`}>{alarm.severity}</span>
                <span className={`text-xs font-mono px-2 py-0.5 rounded ${STATUS[alarm.status] || STATUS.ACTIVE}`}>{alarm.status}</span>
              </div>
              <h2 className="text-white font-bold font-mono mt-1 text-lg">
                {alarm.alarm_id || alarm.id?.slice(0, 8).toUpperCase()}
              </h2>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-800">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 bg-gray-950">
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors ${tab === t ? "text-white border-b-2 border-white" : "text-gray-600 hover:text-gray-400"}`}
            >
              {t === "live" ? "Live Stream" : t}
            </button>
          ))}
        </div>

        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {/* Details tab */}
          {tab === "details" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[
                  ["Site ID",      alarm.site_id],
                  ["Camera",       alarm.camera_id],
                  ["Threat Level", alarm.threat_level || "INTRUSION DETECTED"],
                  ["Confidence",   alarm.confidence ? `${(alarm.confidence * 100).toFixed(1)}%` : "—"],
                  ["Persons",      alarm.person_count ?? "—"],
                  ["Animals",      alarm.animal_count ?? "—"],
                  ["Date",         fmtDate(alarm.created_at)],
                  ["Time",         fmtTime(alarm.created_at)],
                ].map(([label, val]) => (
                  <div key={label} className="bg-gray-950 rounded-lg p-3 border border-gray-800">
                    <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-1">{label}</p>
                    <p className="text-sm font-mono text-white">{val || "—"}</p>
                  </div>
                ))}
              </div>
              {alarm.response && (
                <div className="bg-red-950/50 border border-red-500/30 rounded-lg p-4">
                  <p className="text-xs font-mono text-red-400 uppercase tracking-wider mb-1">Required Action</p>
                  <p className="text-sm font-mono text-red-300">{alarm.response}</p>
                </div>
              )}
            </div>
          )}

          {/* Snapshots tab */}
          {tab === "snapshots" && <SnapshotGallery alarm={alarm} />}

          {/* Live stream tab */}
          {tab === "live" && (
            <div className="space-y-4">
              <LiveStreamPanel compact />
              <div className="bg-gray-950 rounded-lg p-4 border border-gray-800 space-y-2">
                <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Stream URLs</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-500">HLS (browser)</span>
                  <a href={HLS_URL} target="_blank" rel="noreferrer" className="text-xs font-mono text-blue-400">{HLS_URL}</a>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-gray-500">RTMP (VLC)</span>
                  <span className="text-xs font-mono text-green-400 select-all">rtmp://74.225.144.11:1935/live/bts01</span>
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 mt-4 border-t border-gray-800">
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
  const sev      = SEVERITY[alarm.severity] || SEVERITY.HIGH;
  const isActive = alarm.status === "ACTIVE";
  return (
    <div onClick={onClick} className={`flex items-center gap-4 px-4 py-3.5 border-b border-gray-800 hover:bg-gray-800/50 transition-colors cursor-pointer ${isActive ? "bg-gray-900" : "bg-gray-900/50"}`}>
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
          {alarm.person_count > 0 && <span className="text-xs font-mono text-red-400">{alarm.person_count} person{alarm.person_count > 1 ? "s" : ""}</span>}
          {alarm.confidence && <span className="text-xs font-mono text-gray-600">{(alarm.confidence * 100).toFixed(0)}% conf</span>}
        </div>
      </div>
      <div className="text-right shrink-0 space-y-1">
        <div className={`text-xs font-mono px-2 py-0.5 rounded inline-block ${STATUS[alarm.status] || STATUS.ACTIVE}`}>{alarm.status}</div>
        <div className="text-xs font-mono text-gray-600 block">{fmtDuration(alarm.created_at)}</div>
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [alarms,        setAlarms       ] = useState([]);
  const [filter,        setFilter       ] = useState("ALL");
  const [wsStatus,      setWsStatus     ] = useState("connecting");
  const [selected,      setSelected     ] = useState(null);
  const [showStream,    setShowStream   ] = useState(false);
  const [showContacts,  setShowContacts ] = useState(false);
  const [clock,         setClock        ] = useState(new Date());
  const [soundEnabled,  setSoundEnabled ] = useState(true);
  const [activeTab,     setActiveTab    ] = useState("alarms"); // "alarms" | "metrics"
  const wsRef          = useRef(null);
  const prevActiveRef  = useRef(0);

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
          setAlarms(prev => prev.find(a => a.id === msg.alarm.id) ? prev : [msg.alarm, ...prev]);
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
    fetch(`${ALARM_MANAGER_URL}/alarms`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data) && data.length) setAlarms(data); })
      .catch(() => {});
    return () => wsRef.current?.close();
  }, [connectWs]);

  // Play sound when new active alarms appear
  useEffect(() => {
    const active = alarms.filter(a => a.status === "ACTIVE").length;
    if (soundEnabled && active > prevActiveRef.current) {
      const newest = alarms.find(a => a.status === "ACTIVE");
      playAlarmSound(newest?.severity || "HIGH");
    }
    prevActiveRef.current = active;
  }, [alarms, soundEnabled]);

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

  const activeCount   = alarms.filter(a => a.status === "ACTIVE").length;
  const criticalCount = alarms.filter(a => a.severity === "CRITICAL" && a.status === "ACTIVE").length;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>

      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-red-500 font-bold text-sm tracking-widest">AIRTEL</span>
            <span className="text-gray-600 text-xs">|</span>
            <span className="text-xs text-gray-400 tracking-wider">BTS THEFT MONITORING — NOC</span>
          </div>
          <p className="text-xs text-gray-600 mt-0.5">Restricted Area Intrusion Detection · Assam Circle</p>
        </div>

        <div className="flex items-center gap-3">
          {activeCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg animate-pulse">
              <PulseDot color="bg-red-500" />
              <span className="text-xs font-mono text-red-400">{activeCount} ACTIVE ALARM{activeCount > 1 ? "S" : ""}</span>
            </div>
          )}

          {/* Sound toggle */}
          <button
            onClick={() => setSoundEnabled(s => !s)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border transition-colors ${soundEnabled ? "bg-blue-500/10 text-blue-400 border-blue-500/30" : "bg-gray-800 text-gray-600 border-gray-700"}`}
            title="Toggle alarm sound"
          >
            {soundEnabled ? "🔊 SOUND ON" : "🔇 MUTED"}
          </button>

          {/* WhatsApp contacts */}
          <button
            onClick={() => setShowContacts(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
          >
            📱 Contacts
          </button>

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
            <div className="text-xs font-mono text-gray-600">{clock.toLocaleDateString("en-IN", {day:"2-digit",month:"short",year:"numeric"})}</div>
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

        {/* ── Left: Alarms + Metrics ── */}
        <div className={`flex flex-col ${showStream ? "w-1/2" : "flex-1"} border-r border-gray-800 overflow-hidden transition-all duration-300`}>

          {/* Performance metrics */}
          <div className="p-4 border-b border-gray-800 shrink-0">
            <PerfMetrics alarms={alarms} />
          </div>

          {/* Filter tabs + stream toggle */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 shrink-0">
            <div className="flex gap-1">
              {["ALL","ACTIVE","ACKNOWLEDGED","CLEARED"].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${filter === f ? "bg-white text-gray-950 font-bold" : "text-gray-500 hover:text-white hover:bg-gray-800"}`}
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
              className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono border transition-colors ${showStream ? "bg-blue-500/20 border-blue-500/40 text-blue-400" : "border-gray-700 text-gray-500 hover:text-white hover:border-gray-600"}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
              {showStream ? "HIDE STREAM" : "LIVE FEED"}
            </button>
          </div>

          {/* Alarm list */}
          <div className="flex-1 overflow-y-auto">
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

          <div className="px-4 py-2 border-t border-gray-800 bg-gray-950 flex items-center justify-between shrink-0">
            <span className="text-xs font-mono text-gray-600">{filtered.length} alarm{filtered.length !== 1 ? "s" : ""} shown</span>
            <span className="text-xs font-mono text-gray-700">Click row → Details · Snapshots · Live</span>
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
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
                <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Site Information</p>
                <div className="grid grid-cols-2 gap-3">
                  {[["Site ID","AIRTEL-ASM-BTS-001"],["Camera","CAM-BTS-01"],["Model","CP Plus EZ-S35T"],["Network","4G LTE (Airtel SIM)"],["Resolution","800×448 · 15fps"],["Protocol","RTMP Push"]].map(([k,v]) => (
                    <div key={k}>
                      <p className="text-xs text-gray-600 font-mono">{k}</p>
                      <p className="text-xs text-white font-mono mt-0.5">{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {selected && <AlarmDetail alarm={selected} onClose={() => setSelected(null)} onAck={ackAlarm} onClear={clearAlarm} />}
      {showContacts && <ContactsPanel onClose={() => setShowContacts(false)} />}
    </div>
  );
}
