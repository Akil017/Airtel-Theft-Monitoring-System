"use client";
import { useEffect, useState, useCallback, useRef } from "react";

const ALARM_URL  = process.env.NEXT_PUBLIC_ALARM_MANAGER_URL || "http://74.225.144.11:8002";
const ALARM_WS   = process.env.NEXT_PUBLIC_ALARM_MANAGER_WS  || "ws://74.225.144.11:8002/ws";
const RTMP_BASE  = "http://74.225.144.11:8080";
const PLAYER_URL = `${RTMP_BASE}/player.html`;
const HLS_URL    = `${RTMP_BASE}/hls/bts01.m3u8`;

// ── Theme ─────────────────────────────────────────────────────────────────────
const DARK = {
  bg:"bg-gray-950", card:"bg-gray-900", border:"border-gray-800",
  subcard:"bg-gray-800", subborder:"border-gray-700",
  text:"text-white", subtext:"text-gray-400", muted:"text-gray-600",
  header:"bg-gray-900", headerBorder:"border-gray-800",
  row:"bg-gray-900", rowHover:"hover:bg-gray-800/40",
  filter:"bg-gray-950", input:"bg-gray-800 border-gray-700 text-white placeholder-gray-600",
  badge:"bg-gray-800 text-gray-400 border-gray-700",
};
const LIGHT = {
  bg:"bg-gray-100", card:"bg-white", border:"border-gray-200",
  subcard:"bg-gray-50", subborder:"border-gray-200",
  text:"text-gray-900", subtext:"text-gray-600", muted:"text-gray-400",
  header:"bg-white", headerBorder:"border-gray-200",
  row:"bg-white", rowHover:"hover:bg-gray-50",
  filter:"bg-gray-50", input:"bg-white border-gray-300 text-gray-900 placeholder-gray-400",
  badge:"bg-gray-100 text-gray-600 border-gray-300",
};

const SEV = {
  CRITICAL:{ badge:"bg-red-600 text-white",   dot:"bg-red-500",    border:"border-red-500",   bg:"bg-red-950/30" },
  HIGH:    { badge:"bg-orange-500 text-white", dot:"bg-orange-400", border:"border-orange-500",bg:"bg-orange-950/20"},
  MEDIUM:  { badge:"bg-yellow-500 text-black", dot:"bg-yellow-400", border:"border-yellow-400",bg:"bg-yellow-950/10"},
  LOW:     { badge:"bg-blue-600 text-white",   dot:"bg-blue-400",   border:"border-blue-500",  bg:"" },
};
const STAT = {
  ACTIVE:      "bg-red-500/15 text-red-400 border-red-500/30",
  ACKNOWLEDGED:"bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  CLEARED:     "bg-green-500/15 text-green-400 border-green-500/30",
};

const fmtTime     = ts => ts ? new Date(ts).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}) : "—";
const fmtDate     = ts => ts ? new Date(ts).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}) : "—";
const fmtDateFull = ts => ts ? `${fmtDate(ts)} ${fmtTime(ts)}` : "—";
const fmtAgo      = ts => {
  if (!ts) return "—";
  const s = Math.floor((Date.now()-new Date(ts))/1000);
  if (s < 0)   return "just now";
  if (s < 60)  return `${s}s ago`;
  if (s < 3600)return `${Math.floor(s/60)}m ${s%60}s ago`;
  return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ago`;
};
const fmtConf = v => v ? `${(v*100).toFixed(1)}%` : "—";

function playAlarm(sev="HIGH") {
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const seqs = {
      CRITICAL:[[1800,.08],[0,.04],[1800,.08],[0,.04],[1800,.08],[0,.04],[2200,.5]],
      HIGH:    [[1100,.2],[0,.06],[1300,.2],[0,.06],[1100,.3]],
    };
    let t = ctx.currentTime;
    (seqs[sev]||seqs.HIGH).forEach(([f,d])=>{
      if(f>0){const o=ctx.createOscillator(),g=ctx.createGain();o.type="square";o.frequency.value=f;g.gain.setValueAtTime(.15,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+d);}
      t+=d;
    });
  } catch{}
}

function Dot({color="bg-red-500",size="h-2.5 w-2.5",pulse=true}){
  return <span className={`relative flex ${size}`}>{pulse&&<span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-60`}/>}<span className={`relative inline-flex rounded-full ${size} ${color}`}/></span>;
}
function Badge({children,className=""}){return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold border ${className}`}>{children}</span>;}

// ── Live Stream ───────────────────────────────────────────────────────────────
function LiveStream({compact=false,th=DARK}){
  const [live,setLive]=useState(false);
  useEffect(()=>{
    const check=async()=>{try{const r=await fetch(`${RTMP_BASE}/health`,{signal:AbortSignal.timeout(3000)});setLive(r.ok);}catch{setLive(false);}};
    check();const t=setInterval(check,8000);return()=>clearInterval(t);
  },[]);
  if(compact) return(
    <div className={`relative w-full aspect-video ${th.subcard} rounded-lg overflow-hidden border ${th.subborder}`}>
      {live?<iframe src={PLAYER_URL} className="w-full h-full border-0" title="Live" allowFullScreen/>:
        <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-600">
          <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/></svg>
          <span className="text-xs font-mono">OFFLINE — Toggle RTMP in EzyLiv+</span>
        </div>}
      <div className={`absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-mono border ${live?"bg-green-500/15 text-green-400 border-green-500/30":"bg-gray-800 text-gray-500 border-gray-700"}`}>
        <Dot color={live?"bg-green-500":"bg-gray-500"} size="h-2 w-2"/>{live?"LIVE":"OFFLINE"}
      </div>
    </div>
  );
  return(
    <div className={`${th.card} border ${th.border} rounded-xl overflow-hidden`}>
      <div className={`flex items-center justify-between px-4 py-2.5 border-b ${th.border} ${th.bg}`}>
        <div className="flex items-center gap-2"><Dot color="bg-red-500" size="h-2 w-2"/><span className={`text-xs font-mono ${th.text} tracking-wide`}>CAM-BTS-01 · LIVE FEED</span></div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-mono ${th.muted}`}>800×448 · H.264 · 15fps · 4G</span>
          <Badge className={live?"bg-green-500/10 text-green-400 border-green-500/30":`${th.badge}`}>{live?"● STREAMING":"○ OFFLINE"}</Badge>
          <a href={PLAYER_URL} target="_blank" rel="noreferrer" className={`text-xs font-mono ${th.muted} hover:text-blue-400 transition-colors`}>FULLSCREEN ↗</a>
        </div>
      </div>
      <div className="relative aspect-video bg-black">
        {live?<iframe src={PLAYER_URL} className="w-full h-full border-0" title="Live" allowFullScreen/>:
          <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-600">
            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
              <svg className="w-8 h-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"/></svg>
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-mono text-gray-500">STREAM OFFLINE</p>
              <p className="text-xs font-mono text-gray-700">EzyLiv+ → Settings → Advanced → RTMP → Enable</p>
              <p className="text-xs font-mono text-gray-800 select-all">rtmp://74.225.144.11:1935/live/bts01</p>
            </div>
          </div>}
      </div>
      <div className={`flex items-center justify-between px-4 py-2 ${th.bg} border-t ${th.border} text-xs font-mono`}>
        <span className={th.muted}>AIRTEL-ASM-BTS-001 · Central India · Azure VM</span>
        <div className="flex gap-3">
          <a href={HLS_URL} target="_blank" rel="noreferrer" className={`${th.muted} hover:text-blue-400 transition-colors`}>HLS ↗</a>
          <a href={PLAYER_URL} target="_blank" rel="noreferrer" className={`${th.muted} hover:text-blue-400 transition-colors`}>Player ↗</a>
        </div>
      </div>
    </div>
  );
}

// ── Snapshots ─────────────────────────────────────────────────────────────────
function Snapshots({alarm,th=DARK}){
  const snaps = alarm.snapshots||[];
  if(!snaps.length) return(
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-gray-600">
      <div className={`w-16 h-16 rounded-full ${th.subcard} flex items-center justify-center`}>
        <svg className="w-8 h-8 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
      </div>
      <div className="text-center">
        <p className={`text-sm font-mono ${th.subtext}`}>No snapshot available for this alarm</p>
        <p className={`text-xs font-mono ${th.muted} mt-1`}>Snapshots are saved when YOLO detects an intrusion</p>
      </div>
    </div>
  );
  return(
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className={`text-xs font-mono ${th.muted} uppercase tracking-wider`}>{snaps.length} Frame{snaps.length>1?"s":""} Captured</p>
        <p className={`text-xs font-mono ${th.muted}`}>{fmtDateFull(alarm.first_detected)}</p>
      </div>
      <div className={`grid gap-3 ${snaps.length===1?"grid-cols-1":snaps.length===2?"grid-cols-2":"grid-cols-3"}`}>
        {snaps.map((snap,i)=>(
          <div key={i} className={`relative rounded-lg overflow-hidden border ${th.subborder} group bg-gray-950`}>
            <img src={`${ALARM_URL}/snapshots/${snap.split("/").pop()}`} alt={`Frame ${i+1}`} className="w-full aspect-video object-cover" onError={e=>{e.target.parentElement.style.display="none";}}/>
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-2">
              <span className="text-xs font-mono text-gray-300">Frame {i+1} of {snaps.length}</span>
            </div>
            <a href={`${ALARM_URL}/snapshots/${snap.split("/").pop()}`} target="_blank" rel="noreferrer" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 rounded px-2 py-1 text-xs font-mono text-white">↗</a>
          </div>
        ))}
      </div>
      <p className={`text-xs font-mono ${th.muted}`}>Auto-captured by YOLO detection · Stored on server</p>
    </div>
  );
}

// ── Settings Panel (Telegram) ─────────────────────────────────────────────────
function SettingsPanel({onClose,th=DARK}){
  const [token,setToken]=useState(()=>localStorage.getItem("tg_token")||"");
  const [chatId,setChatId]=useState(()=>localStorage.getItem("tg_chat_id")||"");
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [testing,setTesting]=useState("");

  const save=async()=>{
    setSaving(true);
    localStorage.setItem("tg_token",token);
    localStorage.setItem("tg_chat_id",chatId);
    try{
      await fetch(`${ALARM_URL}/settings/telegram`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({bot_token:token,chat_id:chatId})});
      setSaved(true);setTimeout(()=>setSaved(false),3000);
    }catch{}
    setSaving(false);
  };

  const test=async()=>{
    setTesting("sending");
    try{
      const r=await fetch(`${ALARM_URL}/alerts/telegram/test`,{method:"POST"});
      setTesting(r.ok?"sent":"failed");
    }catch{setTesting("failed");}
    setTimeout(()=>setTesting(""),4000);
  };

  const inp=`w-full border rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-blue-500 ${th.input}`;

  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className={`w-full max-w-lg ${th.card} border ${th.border} rounded-2xl overflow-hidden shadow-2xl`}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${th.border} ${th.bg}`}>
          <div>
            <h2 className={`${th.text} font-bold font-mono text-sm`}>⚙️ Alert Settings</h2>
            <p className={`text-xs ${th.muted} font-mono mt-0.5`}>Telegram notifications · Alarm sounds</p>
          </div>
          <button onClick={onClose} className={`${th.muted} hover:text-red-400 p-1.5 rounded-lg transition-colors`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">

          {/* Telegram Setup Info */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 space-y-2">
            <p className="text-xs font-mono text-blue-400 font-bold uppercase tracking-wider">📱 Telegram Bot Setup</p>
            <ol className={`text-xs font-mono ${th.subtext} space-y-1.5 list-decimal list-inside`}>
              <li>Open Telegram → search <span className="text-white font-bold">@BotFather</span></li>
              <li>Send <span className="text-white">/newbot</span> → get your Bot Token</li>
              <li>Send <span className="text-white">/start</span> to your bot → get Chat ID from API</li>
              <li>Paste token + Chat ID below and Save</li>
            </ol>
          </div>

          {/* Token + Chat ID inputs */}
          <div className="space-y-3">
            <p className={`text-xs font-mono ${th.muted} uppercase tracking-wider`}>Bot Configuration</p>
            <div>
              <label className={`text-xs font-mono ${th.muted} mb-1 block`}>Bot Token</label>
              <input value={token} onChange={e=>setToken(e.target.value)} placeholder="7xxxxxxxxx:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className={inp} type="password"/>
            </div>
            <div>
              <label className={`text-xs font-mono ${th.muted} mb-1 block`}>Chat ID</label>
              <input value={chatId} onChange={e=>setChatId(e.target.value)} placeholder="8494521350" className={inp}/>
            </div>
            <div className="flex gap-2">
              <button onClick={save} disabled={!token.trim()||!chatId.trim()||saving} className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-mono font-bold transition-colors">
                {saving?"Saving…":saved?"✓ Saved":"Save Settings"}
              </button>
              <button onClick={test} disabled={!token.trim()||!chatId.trim()||testing==="sending"} className={`px-4 py-2.5 rounded-lg border text-sm font-mono font-bold transition-colors ${testing==="sent"?"border-green-500/30 text-green-400 bg-green-500/10":testing==="failed"?"border-red-500/30 text-red-400 bg-red-500/10":testing==="sending"?"border-yellow-500/30 text-yellow-400 bg-yellow-500/10":`border ${th.subborder} ${th.subtext} hover:${th.text}`}`}>
                {testing==="sending"?"…":testing==="sent"?"✓ Sent":testing==="failed"?"✗ Failed":"Test"}
              </button>
            </div>
            <p className={`text-xs font-mono ${th.muted}`}>On your Telegram phone: open bot → Notifications → Sound → set loudest alarm tone + Override DND</p>
          </div>

          {/* Alarm Sound Test */}
          <div className={`${th.subcard} border ${th.subborder} rounded-lg p-4 space-y-3`}>
            <p className={`text-xs font-mono ${th.muted} uppercase tracking-wider`}>🔊 Browser Alarm Sound Test</p>
            <div className="flex gap-2">
              <button onClick={()=>playAlarm("HIGH")} className="flex-1 py-2 rounded-lg border border-orange-500/30 text-orange-400 text-xs font-mono hover:bg-orange-500/10 transition-colors">▶ HIGH Alert</button>
              <button onClick={()=>playAlarm("CRITICAL")} className="flex-1 py-2 rounded-lg border border-red-500/30 text-red-400 text-xs font-mono hover:bg-red-500/10 transition-colors">▶ CRITICAL Alert</button>
            </div>
            <p className={`text-xs font-mono ${th.muted}`}>Plays automatically in browser when new alarm arrives</p>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Alarm Row ─────────────────────────────────────────────────────────────────
function AlarmRow({alarm,onClick,th=DARK}){
  const sev=SEV[alarm.severity]||SEV.HIGH;
  const isActive=alarm.status==="ACTIVE";
  const [,setTick]=useState(0);
  useEffect(()=>{if(!isActive)return;const t=setInterval(()=>setTick(x=>x+1),1000);return()=>clearInterval(t);},[isActive]);
  const ts = alarm.first_detected || alarm.created_at;
  return(
    <div onClick={onClick} className={`flex items-center gap-4 px-4 py-3.5 border-b ${th.border} ${th.rowHover} cursor-pointer transition-colors ${th.row}`}>
      <div className="flex items-center gap-2 w-32 shrink-0">
        {isActive?<Dot color={sev.dot} size="h-2 w-2"/>:<span className="w-2 h-2"/>}
        <Badge className={sev.badge}>{alarm.severity}</Badge>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-mono ${th.text} truncate font-medium`}>{alarm.site_id}</span>
          <span className={th.muted}>·</span>
          <span className={`text-xs font-mono ${th.subtext}`}>{alarm.camera_id}</span>
          {alarm.snapshots?.length>0&&<span className="text-xs font-mono text-blue-400 shrink-0">📷</span>}
        </div>
        <div className="flex items-center gap-3 mt-0.5">
          <span className={`text-xs font-mono ${th.muted} truncate`}>{alarm.threat_level||"INTRUSION DETECTED"}</span>
          {alarm.person_count>0&&<span className="text-xs font-mono text-red-400 shrink-0">{alarm.person_count}P</span>}
          {alarm.confidence&&<span className={`text-xs font-mono ${th.muted}`}>{fmtConf(alarm.confidence)}</span>}
        </div>
      </div>
      <div className="text-right shrink-0 space-y-1 min-w-0">
        <Badge className={`${STAT[alarm.status]||STAT.ACTIVE} border`}>{alarm.status}</Badge>
        <div className={`text-xs font-mono ${th.muted} mt-1`}>{fmtTime(ts)}</div>
        <div className={`text-xs font-mono ${th.muted}`}>{isActive?fmtAgo(ts):fmtDate(ts)}</div>
      </div>
    </div>
  );
}

// ── Alarm Modal ───────────────────────────────────────────────────────────────
function AlarmModal({alarm,onClose,onAck,onClear,th=DARK}){
  const [tab,setTab]=useState("details");
  const sev=SEV[alarm.severity]||SEV.HIGH;
  const ts  = alarm.first_detected || alarm.created_at;
  const tsU = alarm.last_updated   || alarm.updated_at;
  const tabs=[{id:"details",icon:"📋",label:"Details"},{id:"snapshot",icon:"📷",label:`Snapshot${alarm.snapshots?.length>0?" ("+alarm.snapshots.length+")":""}`},{id:"livestream",icon:"🎥",label:"Live Stream"}];
  return(
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
      <div className={`w-full max-w-2xl ${th.card} border ${sev.border} rounded-2xl shadow-2xl overflow-hidden`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${th.border} ${sev.bg} ${th.bg}`}>
          <div className="flex items-center gap-3">
            <Dot color={sev.dot}/>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={sev.badge}>{alarm.severity}</Badge>
                <Badge className={`${STAT[alarm.status]||STAT.ACTIVE} border`}>{alarm.status}</Badge>
                {alarm.snapshots?.length>0&&<Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30">📷 {alarm.snapshots.length} snap</Badge>}
              </div>
              <h2 className={`${th.text} font-bold font-mono mt-1.5 text-lg tracking-wide`}>
                ALM — {(alarm.alarm_id||alarm.id||"????????").slice(0,8).toUpperCase()}
              </h2>
              <p className={`text-xs font-mono ${th.muted} mt-0.5`}>{alarm.site_id} · {alarm.camera_id}</p>
            </div>
          </div>
          <button onClick={onClose} className={`${th.muted} hover:text-red-400 p-2 rounded-lg hover:bg-gray-800 transition-colors`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
        </div>
        {/* Tabs */}
        <div className={`flex border-b ${th.border} ${th.bg}`}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} className={`flex items-center gap-2 px-5 py-3 text-xs font-mono transition-colors border-b-2 ${tab===t.id?`border-red-500 ${th.text} ${th.card}`:`border-transparent ${th.muted} hover:${th.subtext}`}`}>
              <span>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>
        {/* Content */}
        <div className="max-h-[58vh] overflow-y-auto">
          {tab==="details"&&(
            <div className="p-5 space-y-4">
              {/* Timestamp banner */}
              <div className={`${th.subcard} border ${th.subborder} rounded-lg px-4 py-3 flex items-center justify-between`}>
                <div>
                  <p className={`text-xs font-mono ${th.muted} uppercase tracking-wider mb-0.5`}>Detection Time</p>
                  <p className={`text-sm font-mono ${th.text} font-bold`}>{fmtDateFull(ts)}</p>
                </div>
                <div className="text-right">
                  <p className={`text-xs font-mono ${th.muted} uppercase tracking-wider mb-0.5`}>Duration</p>
                  <p className="text-sm font-mono text-orange-400">{fmtAgo(ts)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Site ID",         alarm.site_id],
                  ["Camera ID",       alarm.camera_id],
                  ["Threat Level",    alarm.threat_level||"INTRUSION DETECTED"],
                  ["Confidence",      fmtConf(alarm.confidence)],
                  ["Persons Detected",alarm.person_count??0],
                  ["Animals Detected",alarm.animal_count??0],
                  ["Detection Date",  fmtDate(ts)],
                  ["Detection Time",  fmtTime(ts)],
                  ["eNode Alarm ID",  alarm.enode_alarm_id||"—"],
                  ["Detections",      alarm.detection_count??0],
                ].map(([l,v])=>(
                  <div key={l} className={`${th.subcard} border ${th.subborder} rounded-lg p-3`}>
                    <p className={`text-xs font-mono ${th.muted} uppercase tracking-wider mb-1`}>{l}</p>
                    <p className={`text-sm font-mono ${th.text}`}>{String(v)||"—"}</p>
                  </div>
                ))}
              </div>
              {alarm.response&&(
                <div className="bg-red-950/50 border border-red-500/30 rounded-lg p-4">
                  <p className="text-xs font-mono text-red-400 uppercase tracking-wider mb-1.5">⚠ Required Action</p>
                  <p className="text-sm font-mono text-red-300 font-bold">{alarm.response}</p>
                </div>
              )}
              <div className={`${th.subcard} border ${th.subborder} rounded-lg px-4 py-2.5 flex items-center justify-between`}>
                <span className={`text-xs font-mono ${th.muted}`}>Full Alarm ID</span>
                <span className={`text-xs font-mono ${th.subtext} select-all`}>{alarm.alarm_id||alarm.id}</span>
              </div>
            </div>
          )}
          {tab==="snapshot"&&<Snapshots alarm={alarm} th={th}/>}
          {tab==="livestream"&&(
            <div className="p-5 space-y-4">
              <LiveStream compact th={th}/>
              <div className={`${th.subcard} border ${th.subborder} rounded-lg p-4 space-y-2 text-xs font-mono`}>
                <p className={`${th.muted} uppercase tracking-wider mb-2`}>Stream URLs</p>
                <div className="space-y-2">
                  <div className="flex justify-between items-center"><span className={th.muted}>HLS</span><a href={HLS_URL} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300">Open ↗</a></div>
                  <div className="flex justify-between items-center"><span className={th.muted}>RTMP</span><span className="text-green-400 select-all">rtmp://74.225.144.11:1935/live/bts01</span></div>
                  <div className="flex justify-between items-center"><span className={th.muted}>Player</span><a href={PLAYER_URL} target="_blank" rel="noreferrer" className="text-blue-400 hover:text-blue-300">{PLAYER_URL} ↗</a></div>
                </div>
              </div>
            </div>
          )}
        </div>
        {/* Actions */}
        <div className={`flex items-center justify-between px-5 py-4 border-t ${th.border} ${th.bg}`}>
          <div className={`text-xs font-mono ${th.muted} space-y-0.5`}>
            <p>Detected: {fmtDateFull(ts)}</p>
            {tsU&&<p>Updated: {fmtDateFull(tsU)}</p>}
          </div>
          <div className="flex gap-2">
            {alarm.status==="ACTIVE"&&<button onClick={()=>onAck(alarm.alarm_id||alarm.id)} className="px-4 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs font-mono hover:bg-yellow-500/20 transition-colors font-bold">Acknowledge</button>}
            {alarm.status!=="CLEARED"&&<button onClick={()=>{onClear(alarm.alarm_id||alarm.id);onClose();}} className="px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-mono hover:bg-green-500/20 transition-colors font-bold">Clear Alarm</button>}
            <button onClick={onClose} className={`px-4 py-2 rounded-lg ${th.subcard} border ${th.subborder} ${th.subtext} text-xs font-mono hover:opacity-80 transition-colors`}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard(){
  const [alarms,setAlarms]=useState([]);
  const [filter,setFilter]=useState("ALL");
  const [wsStatus,setWsStatus]=useState("connecting");
  const [selected,setSelected]=useState(null);
  const [showStream,setShowStream]=useState(false);
  const [showSettings,setShowSettings]=useState(false);
  const [clock,setClock]=useState(new Date());
  const [soundOn,setSoundOn]=useState(true);
  const [dark,setDark]=useState(true);
  const th = dark ? DARK : LIGHT;
  const wsRef=useRef(null);
  const prevActive=useRef(0);

  useEffect(()=>{const t=setInterval(()=>setClock(new Date()),1000);return()=>clearInterval(t);},[]);

  const connect=useCallback(()=>{
    if(wsRef.current?.readyState===WebSocket.OPEN)return;
    const ws=new WebSocket(ALARM_WS);wsRef.current=ws;
    ws.onopen=()=>setWsStatus("connected");
    ws.onclose=()=>{setWsStatus("reconnecting");setTimeout(connect,3000);};
    ws.onerror=()=>{setWsStatus("error");ws.close();};
    ws.onmessage=e=>{
      try{const msg=JSON.parse(e.data);
        const id=a=>a.alarm_id||a.id;
        if(msg.type==="alarm_created"||msg.type==="new_alarm"||msg.event==="ALARM_CREATED"){
          const a=msg.alarm||msg;
          setAlarms(p=>{if(p.find(x=>id(x)===id(a)))return p;return[a,...p];});
          if(soundOn)playAlarm(a.severity);
        }else if(msg.type==="alarm_updated"||msg.event==="ALARM_ACKNOWLEDGED"||msg.event==="ALARM_CLEARED"){
          if(msg.alarm){setAlarms(p=>p.map(a=>id(a)===id(msg.alarm)?msg.alarm:a));setSelected(s=>s&&id(s)===id(msg.alarm)?msg.alarm:s);}
          else if(msg.alarm_id){setAlarms(p=>p.map(a=>id(a)===msg.alarm_id?{...a,status:msg.event==="ALARM_CLEARED"?"CLEARED":"ACKNOWLEDGED"}:a));}
        }else if(msg.type==="initial_state"&&msg.alarms){setAlarms(msg.alarms);}
      }catch{}
    };
  },[soundOn]);

  useEffect(()=>{
    connect();
    fetch(`${ALARM_URL}/alarms`).then(r=>r.ok?r.json():[]).then(d=>{if(Array.isArray(d)&&d.length)setAlarms(d);}).catch(()=>{});
    return()=>wsRef.current?.close();
  },[connect]);

  useEffect(()=>{
    const active=alarms.filter(a=>a.status==="ACTIVE").length;
    if(active>prevActive.current&&soundOn){const n=alarms.find(a=>a.status==="ACTIVE");if(n)playAlarm(n.severity);}
    prevActive.current=active;
  },[alarms,soundOn]);

  const getId=a=>a.alarm_id||a.id;
  const ack  =async id=>{await fetch(`${ALARM_URL}/alarms/acknowledge`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({alarm_id:id,operator_id:"NOC",note:""})});setAlarms(p=>p.map(a=>getId(a)===id?{...a,status:"ACKNOWLEDGED"}:a));};
  const clear=async id=>{await fetch(`${ALARM_URL}/alarms/clear`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({alarm_id:id,operator_id:"NOC",reason:"Cleared by NOC"})});setAlarms(p=>p.map(a=>getId(a)===id?{...a,status:"CLEARED"}:a));};

  const filtered   =alarms.filter(a=>filter==="ALL"?true:a.status===filter);
  const activeCount=alarms.filter(a=>a.status==="ACTIVE").length;
  const critCount  =alarms.filter(a=>a.severity==="CRITICAL"&&a.status==="ACTIVE").length;

  return(
    <div className={`min-h-screen ${th.bg} ${th.text} flex flex-col`} style={{fontFamily:"'JetBrains Mono','Fira Code','Courier New',monospace"}}>

      {/* Header */}
      <header className={`flex items-center justify-between px-5 py-3 ${th.header} border-b ${th.headerBorder} shrink-0`}>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-red-500 font-black tracking-widest text-sm">AIRTEL</span>
            <span className={`${th.muted} text-xs`}>|</span>
            <span className={`text-xs ${th.subtext} tracking-wider uppercase`}>BTS Theft Monitoring — NOC Dashboard</span>
          </div>
          <p className={`text-xs ${th.muted} mt-0.5`}>Restricted Area Intrusion Detection · Assam Circle · {clock.toLocaleDateString("en-IN",{weekday:"long",day:"2-digit",month:"long",year:"numeric"})}</p>
        </div>
        <div className="flex items-center gap-2">
          {activeCount>0&&<div className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 border border-red-500/30 rounded-lg"><Dot color="bg-red-500" size="h-2 w-2"/><span className="text-xs font-mono text-red-400 font-bold">{activeCount} ACTIVE ALARM{activeCount>1?"S":""}</span></div>}

          {/* Dark/Light Toggle */}
          <button onClick={()=>setDark(d=>!d)} title={dark?"Light Mode":"Dark Mode"} className={`p-2 rounded-lg border ${th.border} ${th.subtext} hover:${th.text} transition-colors`}>
            {dark
              ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"/></svg>
              : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>}
          </button>

          {/* Sound Toggle */}
          <button onClick={()=>setSoundOn(s=>!s)} title={soundOn?"Mute":"Unmute"} className={`p-2 rounded-lg border transition-colors ${soundOn?`${th.border} ${th.subtext} hover:${th.text}`:"border-red-500/30 text-red-400 bg-red-500/10"}`}>
            {soundOn
              ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M12 6v12m-3.536-9.536a5 5 0 000 7.072"/></svg>
              : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/></svg>}
          </button>

          {/* Settings */}
          <button onClick={()=>setShowSettings(true)} title="Settings" className={`p-2 rounded-lg border ${th.border} ${th.subtext} hover:${th.text} transition-colors`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          </button>

          {/* WS Status */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-mono border ${wsStatus==="connected"?"bg-green-500/10 text-green-400 border-green-500/30":wsStatus==="connecting"?"bg-yellow-500/10 text-yellow-400 border-yellow-500/30":"bg-red-500/10 text-red-400 border-red-500/30"}`}>
            <Dot color={wsStatus==="connected"?"bg-green-500":wsStatus==="connecting"?"bg-yellow-400":"bg-red-500"} size="h-2 w-2"/>
            {wsStatus==="connected"?"LIVE":wsStatus==="connecting"?"CONNECTING":"RECONNECTING"}
          </div>

          {/* Clock */}
          <div className={`text-right border-l ${th.border} pl-3`}>
            <div className={`text-sm font-mono ${th.text} tabular-nums font-bold`}>{clock.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false})}</div>
            <div className={`text-xs font-mono ${th.muted}`}>{clock.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"})}</div>
          </div>
        </div>
      </header>

      {/* Critical Banner */}
      {critCount>0&&(
        <div className="bg-red-600 px-4 py-2 flex items-center justify-center gap-3 shrink-0 animate-pulse">
          <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
          <span className="text-white text-sm font-black tracking-widest">!! CRITICAL — {critCount} MASS INTRUSION — DISPATCH MULTIPLE UNITS IMMEDIATELY !!</span>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        <div className={`flex flex-col ${showStream?"w-1/2":"flex-1"} border-r ${th.border} overflow-hidden transition-all duration-300`}>
          {/* Stats */}
          <div className={`grid grid-cols-4 border-b ${th.border} shrink-0`}>
            {[["Active",activeCount,activeCount>0?"text-red-400 animate-pulse":"text-gray-500"],["Critical",critCount,critCount>0?"text-red-400":"text-gray-500"],["Total Today",alarms.length,th.text],["Cleared",alarms.filter(a=>a.status==="CLEARED").length,"text-green-400"]].map(([l,v,c],i)=>(
              <div key={i} className={`px-5 py-4 border-r ${th.border} last:border-r-0`}>
                <p className={`text-xs font-mono ${th.muted} uppercase tracking-widest mb-1`}>{l}</p>
                <p className={`text-3xl font-black font-mono ${c}`}>{v}</p>
              </div>
            ))}
          </div>
          {/* Filters */}
          <div className={`flex items-center justify-between px-4 py-2.5 border-b ${th.border} ${th.filter} shrink-0`}>
            <div className="flex gap-1">
              {["ALL","ACTIVE","ACKNOWLEDGED","CLEARED"].map(f=>(
                <button key={f} onClick={()=>setFilter(f)} className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${filter===f?`${dark?"bg-white text-gray-950":"bg-gray-900 text-white"} font-black`:`${th.muted} hover:${th.text} hover:${th.subcard}`}`}>
                  {f}{f==="ACTIVE"&&activeCount>0&&<span className="ml-1.5 bg-red-500 text-white rounded-full px-1.5 py-px text-xs">{activeCount}</span>}
                </button>
              ))}
            </div>
            <button onClick={()=>setShowStream(s=>!s)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono border transition-colors ${showStream?"bg-blue-500/15 border-blue-500/30 text-blue-400":`${th.border} ${th.muted} hover:${th.text}`}`}>
              🎥 {showStream?"HIDE":"LIVE FEED"}
            </button>
          </div>
          {/* Column headers */}
          <div className={`flex items-center gap-4 px-4 py-2 border-b ${th.border} ${th.filter} text-xs font-mono ${th.muted} uppercase tracking-wider shrink-0`}>
            <span className="w-32 shrink-0">Severity</span>
            <span className="flex-1">Site · Camera · Threat</span>
            <span className="text-right shrink-0">Status · Time</span>
          </div>
          {/* Rows */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length===0?(
              <div className={`flex flex-col items-center justify-center h-64 ${th.muted}`}>
                <svg className="w-12 h-12 mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <p className="text-sm font-mono">No alarms in this view</p>
                <p className={`text-xs ${th.muted} mt-1`}>All clear · monitoring active</p>
              </div>
            ):filtered.map(a=><AlarmRow key={a.alarm_id||a.id} alarm={a} onClick={()=>setSelected(a)} th={th}/>)}
          </div>
          {/* Footer */}
          <div className={`px-4 py-2.5 border-t ${th.border} ${th.filter} flex items-center justify-between text-xs font-mono ${th.muted} shrink-0`}>
            <span>{filtered.length} alarm{filtered.length!==1?"s":""} · Last updated: {fmtTime(new Date().toISOString())}</span>
            <span>Click row → details, snapshots &amp; live feed</span>
          </div>
        </div>

        {/* Stream sidebar */}
        {showStream&&(
          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className={`flex items-center justify-between px-4 py-3 border-b ${th.border} ${th.card} shrink-0`}>
              <span className={`text-xs font-mono ${th.subtext} uppercase tracking-wider`}>📹 Live Camera Feed</span>
              <button onClick={()=>setShowStream(false)} className={`${th.muted} hover:text-red-400 transition-colors`}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              <LiveStream th={th}/>
              <div className={`${th.card} border ${th.border} rounded-xl p-4 text-xs font-mono space-y-2`}>
                <p className={`${th.muted} uppercase tracking-wider mb-2`}>Site Information</p>
                {[["Site","AIRTEL-ASM-BTS-001"],["Camera","CAM-BTS-01"],["Model","CP Plus EZ-S35T"],["Network","4G LTE (Airtel SIM)"],["Resolution","800×448 · H.264 · 15fps"],["Server","74.225.144.11 · Azure Central India"],["RTMP","rtmp://74.225.144.11:1935/live/bts01"]].map(([k,v])=>(
                  <div key={k} className="flex justify-between gap-4"><span className={th.muted}>{k}</span><span className={`${th.text} text-right select-all truncate`}>{v}</span></div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {selected&&<AlarmModal alarm={selected} onClose={()=>setSelected(null)} onAck={ack} onClear={clear} th={th}/>}
      {showSettings&&<SettingsPanel onClose={()=>setShowSettings(false)} th={th}/>}
    </div>
  );
}
