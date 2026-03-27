/* =============================================
   EduStream — Room Controller
   ============================================= */

// --- Get URL params ---
const params   = new URLSearchParams(window.location.search);
const roomId   = params.get("room");
const userName = (params.get("name") || "Anonymous").trim().slice(0, 32);

if (!roomId) {
  alert("No class code found. Redirecting…");
  window.location.href = "/";
  throw new Error("No room id");
}

// --- Socket ---
const socket = io({ transports: ["websocket", "polling"] });

// --- DOM ---
const videoGrid        = document.getElementById("videoGrid");
const chatPanel        = document.getElementById("chatPanel");
const chatMessages     = document.getElementById("chatMessages");
const chatInput        = document.getElementById("chatInput");
const sendMsgBtn       = document.getElementById("sendMsgBtn");
const micBtn           = document.getElementById("micBtn");
const camBtn           = document.getElementById("camBtn");
const shareScreenBtn   = document.getElementById("shareScreenBtn");
const leaveBtn         = document.getElementById("leaveBtn");
const toggleChatBtn    = document.getElementById("toggleChatBtn");
const closeChatBtn     = document.getElementById("closeChatBtn");
const raiseHandBtn     = document.getElementById("raiseHandBtn");
const sessionTimerEl   = document.getElementById("sessionTimer");
const participantCount = document.getElementById("participantCount");
const roomCodeEl       = document.getElementById("roomCode");
const chatUnread       = document.getElementById("chatUnread");
const leaveModal       = document.getElementById("leaveModal");
const cancelLeave      = document.getElementById("cancelLeave");
const confirmLeave     = document.getElementById("confirmLeave");
const toastContainer   = document.getElementById("toastContainer");

// --- State ---
let localStream  = null;
let isMicOn      = true;
let isCamOn      = true;
let screenStream = null;
let isHandRaised = false;
let isChatOpen   = false;
let unreadCount  = 0;
let sessionStart = Date.now();
const peers      = {};  // peerId → RTCPeerConnection

// =============================================
// UTILITIES
// =============================================

function toast(msg, type = "info", duration = 3500) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icon = type === "error" ? "❌" : type === "success" ? "✅" : "ℹ️";
  el.innerHTML = `<span>${icon}</span> ${msg}`;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.animation = "toastOut 0.3s ease forwards";
    el.addEventListener("animationend", () => el.remove());
  }, duration);
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function getInitials(name) {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

function updateGridClass() {
  const count = videoGrid.children.length;
  videoGrid.className = "video-grid";
  if      (count === 1)   videoGrid.classList.add("count-1");
  else if (count === 2)   videoGrid.classList.add("count-2");
  else if (count <= 4)    videoGrid.classList.add("count-3");
  else                    videoGrid.classList.add("count-many");
}

// =============================================
// SESSION TIMER
// =============================================
setInterval(() => {
  sessionTimerEl.textContent = formatTime(Date.now() - sessionStart);
}, 1000);

// =============================================
// ROOM CODE DISPLAY
// =============================================
roomCodeEl.textContent = roomId;

// =============================================
// MEDIA
// =============================================
async function getMedia() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream = stream;
    addVideoTile(stream, socket.id, true, userName);
    socket.emit("join-room", { roomId, name: userName });
    return stream;
  } catch (err) {
    console.error("Media error:", err);
    // Join without media (still participate via chat)
    toast("Camera/mic unavailable — joining audio-only", "error");
    localStream = new MediaStream();
    addVideoTile(localStream, socket.id, true, userName, false, false);
    socket.emit("join-room", { roomId, name: userName });
  }
}

// =============================================
// VIDEO TILES
// =============================================
function addVideoTile(stream, id, isLocal = false, displayName = "", micOn = true, camOn = true) {
  if (document.getElementById(`tile-${id}`)) return;

  const tile = document.createElement("div");
  tile.classList.add("video-container");
  tile.id = `tile-${id}`;
  tile.dataset.micOn = String(micOn);
  tile.dataset.camOn = String(camOn);
  tile.dataset.name  = displayName;

  // Video element
  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay   = true;
  video.playsInline = true;
  video.muted      = isLocal;
  tile.appendChild(video);

  // Cam-off placeholder
  const placeholder = document.createElement("div");
  placeholder.classList.add("cam-placeholder");
  placeholder.style.display = camOn ? "none" : "flex";

  const avatar = document.createElement("div");
  avatar.classList.add("avatar-circle");
  avatar.textContent = getInitials(displayName || "?");
  placeholder.appendChild(avatar);
  tile.appendChild(placeholder);

  // Info bar
  const infoBar = document.createElement("div");
  infoBar.classList.add("video-info");

  const nameSpan = document.createElement("span");
  nameSpan.classList.add("name");
  nameSpan.textContent = isLocal ? "You" : (displayName || id.slice(0, 8));
  if (isLocal) {
    const tag = document.createElement("span");
    tag.classList.add("you-tag");
    tag.textContent = "YOU";
    nameSpan.appendChild(tag);
  }

  const mediaIcons = document.createElement("div");
  mediaIcons.classList.add("media-icons");

  const micIcon = document.createElement("span");
  micIcon.classList.add("media-icon");
  micIcon.title = "Mic";
  micIcon.innerHTML = micOn ? "🎤" : "🔇";
  if (!micOn) micIcon.classList.add("off");

  const camIcon = document.createElement("span");
  camIcon.classList.add("media-icon");
  camIcon.title = "Camera";
  camIcon.innerHTML = camOn ? "📷" : "🚫";
  if (!camOn) camIcon.classList.add("off");

  mediaIcons.appendChild(micIcon);
  mediaIcons.appendChild(camIcon);
  infoBar.appendChild(nameSpan);
  infoBar.appendChild(mediaIcons);
  tile.appendChild(infoBar);

  // Store refs
  tile._micIcon     = micIcon;
  tile._camIcon     = camIcon;
  tile._placeholder = placeholder;
  tile._video       = video;

  videoGrid.appendChild(tile);
  updateGridClass();
}

function removeVideoTile(id) {
  const el = document.getElementById(`tile-${id}`);
  if (el) { el.remove(); updateGridClass(); }
}

function updatePeerMedia(id, micOn, camOn) {
  const tile = document.getElementById(`tile-${id}`);
  if (!tile) return;

  tile.dataset.micOn = String(micOn);
  tile.dataset.camOn = String(camOn);

  // Update mic icon
  if (tile._micIcon) {
    tile._micIcon.innerHTML = micOn ? "🎤" : "🔇";
    tile._micIcon.classList.toggle("off", !micOn);
  }
  // Update cam icon + placeholder
  if (tile._camIcon) {
    tile._camIcon.innerHTML = camOn ? "📷" : "🚫";
    tile._camIcon.classList.toggle("off", !camOn);
  }
  if (tile._placeholder) {
    tile._placeholder.style.display = camOn ? "none" : "flex";
  }
}

// Update local tile icons
function syncLocalIcons() {
  const tile = document.getElementById(`tile-${socket.id}`);
  if (!tile) return;
  if (tile._micIcon) {
    tile._micIcon.innerHTML = isMicOn ? "🎤" : "🔇";
    tile._micIcon.classList.toggle("off", !isMicOn);
  }
  if (tile._camIcon) {
    tile._camIcon.innerHTML = isCamOn ? "📷" : "🚫";
    tile._camIcon.classList.toggle("off", !isCamOn);
  }
  if (tile._placeholder) {
    tile._placeholder.style.display = isCamOn ? "none" : "flex";
  }
}

// =============================================
// PEER CONNECTIONS
// =============================================
function createPeer(id, initiator, remoteName) {
  if (peers[id]) { peers[id].close(); }

  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ]
  });
  peers[id] = peer;

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
  }

  // Receive remote track
  peer.ontrack = (e) => {
    const remoteStream = e.streams[0];
    if (document.getElementById(`tile-${id}`)) {
      document.getElementById(`tile-${id}`)._video.srcObject = remoteStream;
    } else {
      addVideoTile(remoteStream, id, false, remoteName || "Peer");
    }
  };

  // ICE candidates
  peer.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit("signal", { to: id, data: { candidate: e.candidate } });
    }
  };

  // Connection state
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
      console.warn(`Peer ${id} connection ${peer.connectionState}`);
    }
  };

  if (initiator) {
    peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      .then(offer => peer.setLocalDescription(offer))
      .then(() => socket.emit("signal", { to: id, data: { sdp: peer.localDescription } }))
      .catch(console.error);
  }

  return peer;
}

// =============================================
// SOCKET EVENTS
// =============================================
socket.on("connect", () => {
  console.log("Connected:", socket.id);
});

socket.on("all-users", (users) => {
  users.forEach(user => {
    addVideoTile(new MediaStream(), user.id, false, user.name);
    createPeer(user.id, true, user.name);
  });
});

socket.on("user-joined", (user) => {
  toast(`${user.name} joined the class`, "success");
  addVideoTile(new MediaStream(), user.id, false, user.name);
  createPeer(user.id, false, user.name);
});

socket.on("signal", async ({ from, data }) => {
  let peer = peers[from];
  if (!peer) {
    const tile = document.getElementById(`tile-${from}`);
    const remoteName = tile ? tile.dataset.name : "Peer";
    peer = createPeer(from, false, remoteName);
  }

  try {
    if (data.sdp) {
      await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === "offer") {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("signal", { to: from, data: { sdp: peer.localDescription } });
      }
    }
    if (data.candidate) {
      await peer.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (err) {
    console.error("Signal error:", err);
  }
});

socket.on("user-left", (id) => {
  const tile = document.getElementById(`tile-${id}`);
  const name = tile ? tile.dataset.name : "A participant";
  toast(`${name} left the class`);
  peers[id]?.close();
  delete peers[id];
  removeVideoTile(id);
});

socket.on("participant-count", (count) => {
  participantCount.textContent = count;
});

socket.on("peer-media-state", ({ id, micOn, camOn }) => {
  updatePeerMedia(id, micOn, camOn);
});

socket.on("peer-raised-hand", ({ id, name }) => {
  toast(`✋ ${name} raised their hand`, "info");
  const tile = document.getElementById(`tile-${id}`);
  if (tile) {
    let badge = tile.querySelector(".hand-badge");
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "hand-badge";
      badge.innerHTML = "✋ Raised hand";
      tile.appendChild(badge);
      setTimeout(() => badge.remove(), 8000);
    }
  }
});

socket.on("chat-message", (msg) => {
  appendChatMessage(msg.sender, msg.message, false, msg.ts);
  if (!isChatOpen) {
    unreadCount++;
    chatUnread.textContent = unreadCount;
    chatUnread.classList.remove("hidden");
  }
});

socket.on("disconnect", () => {
  toast("Disconnected from server", "error");
});

// =============================================
// CHAT
// =============================================
function formatMsgTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function appendChatMessage(sender, message, isSelf = false, ts = Date.now()) {
  // System message
  if (!sender) {
    const el = document.createElement("div");
    el.className = "chat-system";
    el.textContent = message;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = `chat-msg ${isSelf ? "self" : "other"}`;

  if (!isSelf) {
    const senderEl = document.createElement("span");
    senderEl.className = "msg-sender";
    senderEl.textContent = sender;
    wrap.appendChild(senderEl);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.textContent = message;
  wrap.appendChild(bubble);

  const timeEl = document.createElement("span");
  timeEl.className = "msg-time";
  timeEl.textContent = formatMsgTime(ts);
  wrap.appendChild(timeEl);

  chatMessages.appendChild(wrap);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function sendMessage() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  const ts = Date.now();
  socket.emit("chat-message", { roomId, sender: userName, message: msg, ts });
  appendChatMessage(userName, msg, true, ts);
  chatInput.value = "";
}

sendMsgBtn.onclick = sendMessage;
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// =============================================
// CONTROLS
// =============================================

// Mic
micBtn.addEventListener("click", () => {
  isMicOn = !isMicOn;
  if (localStream) {
    localStream.getAudioTracks().forEach(t => t.enabled = isMicOn);
  }
  micBtn.classList.toggle("active", isMicOn);
  micBtn.classList.toggle("muted", !isMicOn);
  micBtn.querySelector(".ctrl-label").textContent = isMicOn ? "Mute" : "Unmute";
  syncLocalIcons();
  socket.emit("media-state", { roomId, micOn: isMicOn, camOn: isCamOn });
});

// Camera
camBtn.addEventListener("click", () => {
  isCamOn = !isCamOn;
  if (localStream) {
    localStream.getVideoTracks().forEach(t => t.enabled = isCamOn);
  }
  camBtn.classList.toggle("active", isCamOn);
  camBtn.classList.toggle("muted", !isCamOn);
  camBtn.querySelector(".ctrl-label").textContent = isCamOn ? "Camera" : "Cam Off";
  syncLocalIcons();
  socket.emit("media-state", { roomId, micOn: isMicOn, camOn: isCamOn });
});

// Chat toggle
function openChat() {
  chatPanel.classList.remove("hidden");
  isChatOpen = true;
  unreadCount = 0;
  chatUnread.classList.add("hidden");
  toggleChatBtn.classList.add("active");
  setTimeout(() => chatInput.focus(), 300);
}

function closeChat() {
  chatPanel.classList.add("hidden");
  isChatOpen = false;
  toggleChatBtn.classList.remove("active");
}

toggleChatBtn.addEventListener("click", () => {
  isChatOpen ? closeChat() : openChat();
});
closeChatBtn.addEventListener("click", closeChat);

// Raise hand
raiseHandBtn.addEventListener("click", () => {
  isHandRaised = !isHandRaised;
  raiseHandBtn.classList.toggle("hand-active", isHandRaised);
  raiseHandBtn.querySelector(".ctrl-label").textContent = isHandRaised ? "Lower" : "Hand";
  if (isHandRaised) {
    socket.emit("raise-hand", { roomId });
    toast("You raised your hand ✋");
    setTimeout(() => {
      if (isHandRaised) {
        isHandRaised = false;
        raiseHandBtn.classList.remove("hand-active");
        raiseHandBtn.querySelector(".ctrl-label").textContent = "Hand";
      }
    }, 30000);
  }
});

// Share Screen
shareScreenBtn.addEventListener("click", () => {
  screenStream ? stopScreenShare() : startScreenShare();
});

async function startScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const screenTrack = screenStream.getVideoTracks()[0];

    // Replace video track in all peers
    Object.values(peers).forEach(peer => {
      const sender = peer.getSenders().find(s => s.track?.kind === "video");
      if (sender) sender.replaceTrack(screenTrack).catch(console.error);
    });

    // Update local tile
    const localTile = document.getElementById(`tile-${socket.id}`);
    if (localTile) localTile._video.srcObject = screenStream;

    shareScreenBtn.classList.add("screen-active");
    shareScreenBtn.querySelector(".ctrl-label").textContent = "Stop";

    screenTrack.addEventListener("ended", stopScreenShare);
    toast("Screen sharing started", "success");
  } catch (err) {
    if (err.name !== "NotAllowedError") {
      toast("Screen share failed: " + err.message, "error");
    }
    screenStream = null;
  }
}

function stopScreenShare() {
  if (!screenStream) return;

  const videoTrack = localStream?.getVideoTracks()[0];
  Object.values(peers).forEach(peer => {
    const sender = peer.getSenders().find(s => s.track?.kind === "video");
    if (sender && videoTrack) sender.replaceTrack(videoTrack).catch(console.error);
  });

  const localTile = document.getElementById(`tile-${socket.id}`);
  if (localTile && localStream) localTile._video.srcObject = localStream;

  screenStream.getTracks().forEach(t => t.stop());
  screenStream = null;

  shareScreenBtn.classList.remove("screen-active");
  shareScreenBtn.querySelector(".ctrl-label").textContent = "Share";
  toast("Screen sharing stopped");
}

// Leave
leaveBtn.addEventListener("click", () => {
  leaveModal.classList.remove("hidden");
});
cancelLeave.addEventListener("click", () => {
  leaveModal.classList.add("hidden");
});
confirmLeave.addEventListener("click", () => {
  cleanupAndLeave();
});

function cleanupAndLeave() {
  Object.values(peers).forEach(p => p.close());
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  socket.disconnect();
  window.location.href = "/";
}

// Warn before tab close
window.addEventListener("beforeunload", () => {
  socket.disconnect();
});

// =============================================
// START
// =============================================
getMedia();
appendChatMessage(null, `You joined as ${userName}`);