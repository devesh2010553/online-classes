"use strict";
/*
  EduStream Room Controller v4
  ────────────────────────────────────────────────────────
  ✅ HD 1080p / 4K video (best quality the device supports)
  ✅ Speaker detection   → tile moves to top + bigger
  ✅ Screen share        → tile moves to top + bigger
  ✅ Screen share on phone (rear-camera fallback, no crash)
  ✅ Pin any tile        → double-tap (mobile) / click 📌 (desktop)
  ✅ Unpin              → tap 📌 again on pinned tile
  ✅ Real-time chat with unread badge
  ✅ Mic / Camera toggle with visual feedback
  ✅ Raise hand
  ✅ Participant count + session timer
  ✅ PWA service worker registered
  ✅ Leave confirmation modal
  ✅ Toast notifications
  ✅ Fully responsive: phone portrait/landscape + desktop
*/

// ── PWA ────────────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// ── URL params ─────────────────────────────────────────────
const qp      = new URLSearchParams(location.search);
const ROOM    = (qp.get("room") || "").toUpperCase().trim();
const ME      = (qp.get("name") || "Guest").trim().slice(0, 32);

if (!ROOM) { alert("No class code!"); location.href = "/"; throw 0; }

// ── Socket ─────────────────────────────────────────────────
const socket = io({ transports: ["websocket", "polling"] });

// ── DOM ────────────────────────────────────────────────────
const grid        = document.getElementById("grid");
const chatPanel   = document.getElementById("chatPanel");
const chatLog     = document.getElementById("chatLog");
const chatInput   = document.getElementById("chatInput");
const btnSend     = document.getElementById("btnSend");
const btnMic      = document.getElementById("btnMic");
const btnCam      = document.getElementById("btnCam");
const btnShare    = document.getElementById("btnShare");
const btnHand     = document.getElementById("btnHand");
const btnChat     = document.getElementById("btnChat");
const btnLeave    = document.getElementById("btnLeave");
const btnCloseChat= document.getElementById("btnCloseChat");
const pCount      = document.getElementById("pCount");
const hTimer      = document.getElementById("hTimer");
const hRoomCode   = document.getElementById("hRoomCode");
const unread      = document.getElementById("unread");
const qualBadge   = document.getElementById("qualBadge");
const leaveModal  = document.getElementById("leaveModal");
const btnStay     = document.getElementById("btnStay");
const btnGo       = document.getElementById("btnGo");
const toastsEl    = document.getElementById("toasts");

// ── State ──────────────────────────────────────────────────
let localStream   = null;   // camera+mic
let screenStream  = null;   // screen / rear cam on mobile
let micOn         = true;
let camOn         = true;
let sharing       = false;
let handUp        = false;
let chatOpen      = false;
let unreadCount   = 0;
let pinnedId      = null;   // socket.id of pinned peer, or null
let speakerId     = null;   // currently loudest speaker
let sessionStart  = Date.now();
const peers       = {};     // peerId → RTCPeerConnection
const peerNames   = {};     // peerId → name string
const isMobile    = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ── ICE servers ────────────────────────────────────────────
const ICE = { iceServers: [
  { urls: "stun:stun.l.google.com:19302"  },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
]};

// ─────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────
hRoomCode.textContent = ROOM;
setInterval(updateTimer, 1000);

async function init() {
  await openCamera();
  socket.emit("join-room", { roomId: ROOM, name: ME });
  sysMsg(`Joined as "${ME}" · Room ${ROOM}`);
}

// ─────────────────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────────────────
function updateTimer() {
  const s = Math.floor((Date.now() - sessionStart) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sc = s % 60;
  const p = n => String(n).padStart(2, "0");
  hTimer.textContent = h ? `${p(h)}:${p(m)}:${p(sc)}` : `${p(m)}:${p(sc)}`;
}

// ─────────────────────────────────────────────────────────
// CAMERA / MIC
// ─────────────────────────────────────────────────────────
async function openCamera() {
  // Try ideal 4K → fallback to lower
  const attempts = [
    { video: { width:{ideal:3840}, height:{ideal:2160}, frameRate:{ideal:30}, facingMode:"user" }, audio: audioConstraints() },
    { video: { width:{ideal:1920}, height:{ideal:1080}, frameRate:{ideal:30}, facingMode:"user" }, audio: audioConstraints() },
    { video: { facingMode: "user" }, audio: audioConstraints() },
    { video: true, audio: audioConstraints() },
    { video: false, audio: audioConstraints() },
  ];
  for (const c of attempts) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia(c);
      showQuality(localStream);
      addTile(localStream, socket.id, true, ME);
      startSpeakDetect(localStream);
      return;
    } catch (_) {}
  }
  // Complete fallback: empty stream
  localStream = new MediaStream();
  addTile(localStream, socket.id, true, ME, false, false);
  toast("Camera/mic unavailable — you are listen-only", "err");
}

function audioConstraints() {
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 };
}

function showQuality(stream) {
  const vt = stream.getVideoTracks()[0];
  if (!vt) return;
  const s = vt.getSettings();
  const w = s.width || 0, h = s.height || 0;
  let label = "HD", cls = "fhd";
  if (w >= 3840 || h >= 2160)      { label = "4K";    cls = "uhd";   }
  else if (w >= 1920 || h >= 1080) { label = "1080p"; cls = "fhd";   }
  else if (w >= 1280 || h >= 720)  { label = "720p";  cls = "hd720"; }
  else                              { label = "SD";    cls = "sd";    }
  qualBadge.textContent = label;
  qualBadge.className   = `qual-badge ${cls}`;
}

// ─────────────────────────────────────────────────────────
// SPEAKING DETECTION  (AudioAnalyser on local mic)
// ─────────────────────────────────────────────────────────
function startSpeakDetect(stream) {
  try {
    const ac  = new (window.AudioContext || window.webkitAudioContext)();
    const src = ac.createMediaStreamSource(stream);
    const an  = ac.createAnalyser();
    an.fftSize = 512; an.smoothingTimeConstant = 0.7;
    src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    let wasSpeaking = false, debounce = null;

    (function tick() {
      an.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      const now = avg > 14;

      if (now && !wasSpeaking) {
        clearTimeout(debounce);
        wasSpeaking = true;
        markSpeaking(socket.id, true);
        socket.emit("speaking", { roomId: ROOM, on: true });
      } else if (!now && wasSpeaking) {
        debounce = setTimeout(() => {
          wasSpeaking = false;
          markSpeaking(socket.id, false);
          socket.emit("speaking", { roomId: ROOM, on: false });
        }, 700);
      }
      requestAnimationFrame(tick);
    })();
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────
// TILES
// ─────────────────────────────────────────────────────────
function mkInitials(name) {
  return (name || "?").split(" ").slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
}

function addTile(stream, id, isLocal, name, mic = true, cam = true) {
  if (document.getElementById("t" + id)) return;
  peerNames[id] = name;

  const tile = document.createElement("div");
  tile.className = "vt";
  tile.id = "t" + id;
  tile.dataset.name = name;

  // video
  const vid = document.createElement("video");
  vid.srcObject   = stream;
  vid.autoplay    = true;
  vid.playsInline = true;
  vid.muted       = isLocal;
  tile.appendChild(vid);

  // cam-off placeholder
  const co = document.createElement("div");
  co.className = "cam-off";
  co.style.display = cam ? "none" : "flex";
  const av = document.createElement("div");
  av.className = "av";
  av.textContent = mkInitials(name);
  const avn = document.createElement("div");
  avn.className = "av-name";
  avn.textContent = name;
  co.appendChild(av); co.appendChild(avn);
  tile.appendChild(co);

  // speaking ring
  const ring = document.createElement("div");
  ring.className = "speak-ring";
  tile.appendChild(ring);

  // bottom bar
  const bar = document.createElement("div");
  bar.className = "tile-bar";
  const nameEl = document.createElement("span");
  nameEl.className = "tile-name";
  nameEl.textContent = isLocal ? "You" : name;
  if (isLocal) {
    const tag = document.createElement("span");
    tag.className = "you-tag"; tag.textContent = "YOU";
    nameEl.appendChild(tag);
  }
  const icons = document.createElement("div");
  icons.className = "tile-icons";
  const mi = document.createElement("span");
  mi.className = "ticon" + (mic ? "" : " off");
  mi.textContent = mic ? "🎤" : "🔇";
  const ci = document.createElement("span");
  ci.className = "ticon" + (cam ? "" : " off");
  ci.textContent = cam ? "📷" : "🚫";
  icons.appendChild(mi); icons.appendChild(ci);
  bar.appendChild(nameEl); bar.appendChild(icons);
  tile.appendChild(bar);

  // pin button
  const pb = document.createElement("button");
  pb.className = "pin-btn"; pb.textContent = "📌";
  pb.title = "Pin this tile";
  pb.addEventListener("click", e => { e.stopPropagation(); togglePin(id); });
  tile.appendChild(pb);

  // double-tap → pin (mobile)
  let lastTap = 0;
  tile.addEventListener("touchend", e => {
    const now = Date.now();
    if (now - lastTap < 320) { e.preventDefault(); togglePin(id); }
    lastTap = now;
  }, { passive: false });
  // double-click → pin (desktop)
  tile.addEventListener("dblclick", () => togglePin(id));

  // internal refs
  tile._vid = vid;
  tile._co  = co;
  tile._mi  = mi;
  tile._ci  = ci;

  grid.appendChild(tile);
  relayout();
}

function removeTile(id) {
  const el = document.getElementById("t" + id);
  if (el) el.remove();
  delete peerNames[id];
  if (pinnedId === id) applyPin(null, false);
  if (speakerId === id) { speakerId = null; grid.classList.remove("spotlight-mode"); }
  relayout();
}

// ── Tile media state ───────────────────────────────────────
function setTileMedia(id, mic, cam) {
  const tile = document.getElementById("t" + id);
  if (!tile) return;
  tile._mi.textContent = mic ? "🎤" : "🔇";
  tile._mi.className   = "ticon" + (mic ? "" : " off");
  tile._ci.textContent = cam ? "📷" : "🚫";
  tile._ci.className   = "ticon" + (cam ? "" : " off");
  tile._co.style.display = cam ? "none" : "flex";
}

// ── Speaking ───────────────────────────────────────────────
function markSpeaking(id, on) {
  const tile = document.getElementById("t" + id);
  if (!tile) return;

  if (on) {
    tile.classList.add("speaking");
    speakerId = id;
    if (!pinnedId) promoteToTop(id);
  } else {
    tile.classList.remove("speaking");
    if (speakerId === id) {
      speakerId = null;
      if (!pinnedId) demoteFromTop(id);
    }
  }
}

// ── Screen share tile ──────────────────────────────────────
function markSharing(id, on) {
  const tile = document.getElementById("t" + id);
  if (!tile) return;

  if (on) {
    tile.classList.add("sharing");
    // badge
    if (!tile.querySelector(".share-badge")) {
      const b = document.createElement("div");
      b.className = "share-badge"; b.textContent = "📡 Sharing";
      tile.appendChild(b);
    }
    if (!pinnedId) promoteToTop(id);
  } else {
    tile.classList.remove("sharing");
    tile.querySelector(".share-badge")?.remove();
    if (!pinnedId) demoteFromTop(id);
  }
}

// ── Spotlight: move one tile to "first" position ───────────
// CSS order property: -1 = first, 0 = normal
function promoteToTop(id) {
  // Reset all
  grid.querySelectorAll(".vt").forEach(t => t.style.order = "");
  const tile = document.getElementById("t" + id);
  if (tile) tile.style.order = "-1";
  applySpotlightLayout(id);
}

function demoteFromTop(id) {
  const tile = document.getElementById("t" + id);
  if (tile) tile.style.order = "";
  grid.classList.remove("spotlight-mode");
}

function applySpotlightLayout(id) {
  const n = grid.querySelectorAll(".vt").length;
  if (n < 2) return; // no need for spotlight with 1 person
  grid.classList.add("spotlight-mode");

  // Move all non-spotlight tiles into the strip
  const strip = getOrCreateStrip();
  grid.querySelectorAll(".vt").forEach(tile => {
    const tId = tile.id.replace("t", "");
    if (tId === id) {
      tile.classList.add("vt-spotlight");
      tile.classList.remove("vt-strip-item");
      grid.insertBefore(tile, strip); // ensure it's before strip
    } else {
      tile.classList.remove("vt-spotlight");
      tile.classList.add("vt-strip-item");
      strip.appendChild(tile);
    }
  });
}

function exitSpotlightLayout() {
  const strip = document.getElementById("tile-strip");
  if (strip) {
    // Move all tiles back to grid
    Array.from(strip.children).forEach(tile => {
      tile.classList.remove("vt-strip-item");
      grid.appendChild(tile);
    });
    strip.remove();
  }
  grid.querySelectorAll(".vt").forEach(t => {
    t.classList.remove("vt-spotlight");
    t.style.order = "";
  });
  grid.classList.remove("spotlight-mode");
}

function getOrCreateStrip() {
  let strip = document.getElementById("tile-strip");
  if (!strip) {
    strip = document.createElement("div");
    strip.id = "tile-strip";
    strip.className = "vt-strip";
    grid.appendChild(strip);
  }
  return strip;
}

// ── Pin ────────────────────────────────────────────────────
function togglePin(id) {
  if (pinnedId === id) {
    // unpin
    socket.emit("unpin", { roomId: ROOM });
    applyPin(null, true);
  } else {
    socket.emit("pin", { roomId: ROOM, peerId: id });
    applyPin(id, true);
  }
}

function applyPin(id, showToast) {
  pinnedId = id;

  // Exit spotlight mode first (pin takes over)
  exitSpotlightLayout();

  grid.querySelectorAll(".vt").forEach(tile => {
    const tid = tile.id.replace("t", "");
    const isPin = tid === id;
    tile.classList.toggle("pinned", isPin);
    const pb = tile.querySelector(".pin-btn");
    if (pb) {
      pb.title    = isPin ? "Unpin" : "Pin this tile";
      pb.textContent = isPin ? "📍" : "📌";
    }
    tile.style.order = isPin ? "-1" : "";
  });

  if (id) {
    applySpotlightLayout(id);
    if (showToast) toast(`📌 Pinned ${id === socket.id ? "your" : (peerNames[id]||"their")} tile`);
  } else {
    if (showToast) toast("Unpinned");
    relayout();
  }
}

// ─────────────────────────────────────────────────────────
// GRID LAYOUT (data-n drives CSS)
// ─────────────────────────────────────────────────────────
function relayout() {
  const tiles = grid.querySelectorAll(".vt");
  const n     = tiles.length;
  grid.dataset.n = Math.min(n, 9);
  pCount.textContent = n;
}

// ─────────────────────────────────────────────────────────
// PEER CONNECTIONS
// ─────────────────────────────────────────────────────────
function createPeer(id, initiator, remoteName) {
  if (peers[id]) { try { peers[id].close(); } catch (_) {} }

  const pc = new RTCPeerConnection(ICE);
  peers[id] = pc;
  peerNames[id] = remoteName || "Peer";

  // Add local tracks to peer
  if (localStream) {
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  }

  // Prefer high bitrate for video
  pc.onnegotiationneeded = () => {
    pc.getSenders().forEach(sender => {
      if (sender.track?.kind !== "video") return;
      try {
        const p = sender.getParameters();
        if (!p.encodings?.length) p.encodings = [{}];
        p.encodings.forEach(enc => {
          enc.maxBitrate   = 8_000_000; // 8 Mbps for 4K
          enc.maxFramerate = 30;
          enc.scaleResolutionDownBy = 1;
        });
        sender.setParameters(p).catch(() => {});
      } catch (_) {}
    });
  };

  // Remote track → update tile video
  pc.ontrack = e => {
    const stream = e.streams[0];
    if (!stream) return;
    const tile = document.getElementById("t" + id);
    if (tile) {
      tile._vid.srcObject = stream;
    } else {
      addTile(stream, id, false, remoteName || "Peer");
    }
  };

  // ICE
  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { to: id, data: { candidate: e.candidate } });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") {
      try { pc.restartIce(); } catch (_) {}
    }
  };

  if (initiator) {
    pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      .then(o => pc.setLocalDescription(o))
      .then(() => socket.emit("signal", { to: id, data: { sdp: pc.localDescription } }))
      .catch(console.warn);
  }

  return pc;
}

// ─────────────────────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────────────────────
socket.on("connect", () => console.log("socket", socket.id));

socket.on("all-users", users => {
  users.forEach(u => {
    addTile(new MediaStream(), u.id, false, u.name);
    createPeer(u.id, true, u.name);
  });
});

socket.on("user-joined", u => {
  toast(`👋 ${u.name} joined`);
  addTile(new MediaStream(), u.id, false, u.name);
  createPeer(u.id, false, u.name);
});

socket.on("signal", async ({ from, data }) => {
  if (!peers[from]) createPeer(from, false, peerNames[from]);
  const pc = peers[from];
  try {
    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === "offer") {
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        socket.emit("signal", { to: from, data: { sdp: pc.localDescription } });
      }
    }
    if (data.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
    }
  } catch (e) { console.warn("signal:", e.message); }
});

socket.on("user-left", id => {
  toast(`${peerNames[id] || "Someone"} left`);
  peers[id]?.close();
  delete peers[id];
  removeTile(id);
});

socket.on("room-count", n => { pCount.textContent = n; });

socket.on("peer-state", ({ id, mic, cam }) => setTileMedia(id, mic, cam));

socket.on("peer-speaking", ({ id, on }) => markSpeaking(id, on));

socket.on("peer-screen-on",  ({ id, name }) => {
  markSharing(id, true);
  toast(`🖥️ ${name || "Someone"} is sharing their screen`);
});
socket.on("peer-screen-off", ({ id }) => markSharing(id, false));

socket.on("peer-hand", ({ id, name }) => {
  toast(`✋ ${name || "Someone"} raised their hand`);
  const tile = document.getElementById("t" + id);
  if (tile && !tile.querySelector(".hand-badge")) {
    const b = document.createElement("div");
    b.className = "hand-badge"; b.innerHTML = "✋ Hand raised";
    tile.appendChild(b);
    setTimeout(() => b.remove(), 9000);
  }
});

socket.on("do-pin",   ({ peerId }) => applyPin(peerId, false));
socket.on("do-unpin", ()           => applyPin(null,   false));

socket.on("chat-msg", ({ name, message, ts }) => {
  appendMsg(name, message, false, ts);
  if (!chatOpen) {
    unreadCount++;
    unread.textContent = unreadCount;
    unread.classList.remove("hidden");
  }
});

socket.on("disconnect", () => toast("Disconnected from server", "err"));

// ─────────────────────────────────────────────────────────
// CHAT
// ─────────────────────────────────────────────────────────
function appendMsg(name, message, isMe, ts) {
  if (name === null || name === undefined) {
    const el = document.createElement("div");
    el.className = "csys"; el.textContent = message;
    chatLog.appendChild(el);
  } else {
    const wrap = document.createElement("div");
    wrap.className = `cmsg ${isMe ? "me" : "them"}`;
    if (!isMe) {
      const s = document.createElement("span");
      s.className = "cm-sender"; s.textContent = name;
      wrap.appendChild(s);
    }
    const b = document.createElement("div");
    b.className = "cm-bubble"; b.textContent = message;
    wrap.appendChild(b);
    const t = document.createElement("span");
    t.className = "cm-time";
    t.textContent = ts ? new Date(ts).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) : "";
    wrap.appendChild(t);
    chatLog.appendChild(wrap);
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

function sysMsg(text) { appendMsg(null, text, false); }

function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit("chat-msg", { roomId: ROOM, message: msg });
  appendMsg(ME, msg, true, Date.now());
  chatInput.value = "";
}
btnSend.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });

// ─────────────────────────────────────────────────────────
// CONTROLS
// ─────────────────────────────────────────────────────────

// Mic toggle
btnMic.addEventListener("click", () => {
  micOn = !micOn;
  localStream?.getAudioTracks().forEach(t => t.enabled = micOn);
  btnMic.classList.toggle("active", micOn);
  btnMic.classList.toggle("off",    !micOn);
  btnMic.querySelector(".cb-lbl").textContent = micOn ? "Mute" : "Unmute";
  socket.emit("media-state", { roomId: ROOM, mic: micOn, cam: camOn });
  setTileMedia(socket.id, micOn, camOn);
});

// Camera toggle
btnCam.addEventListener("click", () => {
  camOn = !camOn;
  localStream?.getVideoTracks().forEach(t => t.enabled = camOn);
  btnCam.classList.toggle("active", camOn);
  btnCam.classList.toggle("off",    !camOn);
  btnCam.querySelector(".cb-lbl").textContent = camOn ? "Camera" : "Cam Off";
  socket.emit("media-state", { roomId: ROOM, mic: micOn, cam: camOn });
  setTileMedia(socket.id, micOn, camOn);
});

// ── Screen share / Phone share ─────────────────────────────
btnShare.addEventListener("click", () => sharing ? stopShare() : startShare());

async function startShare() {
  if (isMobile) {
    await startMobileShare();
  } else {
    await startDesktopShare();
  }
}

// Desktop: getDisplayMedia
async function startDesktopShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width:     { ideal: 3840 },
        height:    { ideal: 2160 },
        frameRate: { ideal: 30, max: 60 },
        cursor:    "always",
      },
      audio: { echoCancellation: false, noiseSuppression: false },
    });
    await applyScreenTrack(screenStream.getVideoTracks()[0]);
    screenStream.getVideoTracks()[0].addEventListener("ended", stopShare);
    toast("🖥️ Screen sharing started", "ok");
  } catch (err) {
    if (err.name !== "NotAllowedError" && err.name !== "AbortError") {
      toast("Screen share failed: " + err.message, "err");
    }
    screenStream = null;
  }
}

// Mobile: no getDisplayMedia → use rear camera as "share"
async function startMobileShare() {
  // First try environment camera (rear)
  const attempts = [
    { video: { facingMode: { exact: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
    { video: { facingMode: "environment" }, audio: false },
    { video: { facingMode: "user"        }, audio: false },
    { video: true,                           audio: false },
  ];

  for (const c of attempts) {
    try {
      screenStream = await navigator.mediaDevices.getUserMedia(c);
      await applyScreenTrack(screenStream.getVideoTracks()[0]);
      toast("📸 Sharing camera (phone mode)", "ok");
      return;
    } catch (_) {}
  }
  toast("Camera share unavailable on this device", "err");
  screenStream = null;
}

// Replace video track in all peer connections
async function applyScreenTrack(track) {
  const replaces = Object.values(peers).map(pc => {
    const sender = pc.getSenders().find(s => s.track?.kind === "video");
    return sender ? sender.replaceTrack(track).catch(() => {}) : Promise.resolve();
  });
  await Promise.all(replaces);

  // Update local tile preview
  const tile = document.getElementById("t" + socket.id);
  if (tile) tile._vid.srcObject = new MediaStream([track]);

  sharing = true;
  btnShare.classList.add("sharing");
  btnShare.querySelector(".cb-lbl").textContent = "Stop";
  socket.emit("screen-on", { roomId: ROOM });
  markSharing(socket.id, true);
}

async function stopShare() {
  if (!screenStream) return;
  screenStream.getTracks().forEach(t => t.stop());
  screenStream = null;

  // Restore camera track
  const camTrack = localStream?.getVideoTracks()[0];
  if (camTrack) {
    const replaces = Object.values(peers).map(pc => {
      const sender = pc.getSenders().find(s => s.track?.kind === "video");
      return sender ? sender.replaceTrack(camTrack).catch(() => {}) : Promise.resolve();
    });
    await Promise.all(replaces);
  }

  // Restore local tile
  const tile = document.getElementById("t" + socket.id);
  if (tile && localStream) tile._vid.srcObject = localStream;

  sharing = false;
  btnShare.classList.remove("sharing");
  btnShare.querySelector(".cb-lbl").textContent = "Share";
  socket.emit("screen-off", { roomId: ROOM });
  markSharing(socket.id, false);
  toast("🛑 Sharing stopped");
}

// Raise hand
btnHand.addEventListener("click", () => {
  handUp = !handUp;
  btnHand.classList.toggle("hand-up", handUp);
  btnHand.querySelector(".cb-lbl").textContent = handUp ? "Lower" : "Hand";
  if (handUp) {
    socket.emit("raise-hand", { roomId: ROOM });
    toast("✋ Hand raised — visible to everyone");
    setTimeout(() => {
      if (handUp) {
        handUp = false;
        btnHand.classList.remove("hand-up");
        btnHand.querySelector(".cb-lbl").textContent = "Hand";
      }
    }, 30000);
  }
});

// Chat
function openChat() {
  chatPanel.classList.add("open");
  chatOpen = true;
  unreadCount = 0;
  unread.classList.add("hidden");
  btnChat.classList.add("active");
  setTimeout(() => chatInput.focus(), 300);
}
function closeChat() {
  chatPanel.classList.remove("open");
  chatOpen = false;
  btnChat.classList.remove("active");
}
btnChat.addEventListener("click",      () => chatOpen ? closeChat() : openChat());
btnCloseChat.addEventListener("click", closeChat);

// Leave
btnLeave.addEventListener("click", () => leaveModal.classList.remove("hidden"));
btnStay.addEventListener("click",  () => leaveModal.classList.add("hidden"));
btnGo.addEventListener("click",    () => { leaveModal.classList.add("hidden"); doLeave(); });

function doLeave() {
  Object.values(peers).forEach(pc => { try { pc.close(); } catch (_) {} });
  localStream?.getTracks().forEach(t => t.stop());
  screenStream?.getTracks().forEach(t => t.stop());
  socket.disconnect();
  location.href = "/";
}

window.addEventListener("beforeunload", () => {
  try { socket.disconnect(); } catch (_) {}
});

// ─────────────────────────────────────────────────────────
// TOASTS
// ─────────────────────────────────────────────────────────
function toast(msg, type = "", dur = 3500) {
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  const ico = type === "err" ? "❌" : type === "ok" ? "✅" : "ℹ️";
  el.innerHTML = `<span>${ico}</span><span>${msg}</span>`;
  toastsEl.appendChild(el);
  setTimeout(() => {
    el.style.animation = "tOut .3s var(--ez) forwards";
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, dur);
}

// ─────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────
init();