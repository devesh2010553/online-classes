const socket = io();

// --- Get room ID and name from URL ---
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const userName = params.get("name") || "Anonymous";

if (!roomId) {
  alert("No class code found!");
  throw new Error("No class code provided");
}

// --- DOM Elements ---
const videoGrid = document.getElementById("videoGrid");
const chatPanel = document.getElementById("chatPanel");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");

const micBtn = document.getElementById("micBtn");
const camBtn = document.getElementById("camBtn");
const shareScreenBtn = document.getElementById("shareScreenBtn");
const leaveBtn = document.getElementById("leaveBtn");
const toggleChatBtn = document.getElementById("toggleChatBtn");
const sendMsgBtn = document.getElementById("sendMsgBtn");

// --- State ---
let localStream;
let isMicOn = true;
let isCamOn = true;
let screenStream = null;
const peers = {};

// ---------------- MEDIA ----------------
async function getMedia() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream = stream;
    addVideo(localStream, socket.id, true, userName);
    socket.emit("join-room", { roomId, name: userName });
    return stream;
  } catch (err) {
    alert("Could not access camera/microphone: " + err.message);
  }
}

// ---------------- VIDEO HANDLING ----------------
function addVideo(stream, id, isLocal = false, displayName) {
  if (document.getElementById(id)) return;

  const container = document.createElement("div");
  container.classList.add("video-container");
  container.id = id;

  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = isLocal;

  container.appendChild(video);

  const infoBar = document.createElement("div");
  infoBar.classList.add("video-info");

  const nameSpan = document.createElement("span");
  nameSpan.classList.add("name");
  nameSpan.textContent = isLocal ? "You" : displayName || id.slice(0, 6);

  const icons = document.createElement("div");
  icons.classList.add("icons");

  const micIcon = document.createElement("span");
  micIcon.innerHTML = "🎤 ";
  const camIcon = document.createElement("span");
  camIcon.innerHTML = "📷";

  icons.appendChild(micIcon);
  icons.appendChild(camIcon);

  infoBar.appendChild(nameSpan);
  infoBar.appendChild(icons);
  container.appendChild(infoBar);

  container.dataset.micOn = "true";
  container.dataset.camOn = "true";
  container.micIcon = micIcon;
  container.camIcon = camIcon;

  videoGrid.appendChild(container);
}

function removeVideo(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// ---------------- PEER CONNECTION ----------------
function createPeer(id, initiator, remoteName) {
  const peer = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  peers[id] = peer;

  // Add local tracks
  localStream.getTracks().forEach(track => peer.addTrack(track, localStream));

  peer.ontrack = e => {
    addVideo(e.streams[0], id, false, remoteName);
  };

  peer.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("signal", { to: id, data: { candidate: e.candidate } });
    }
  };

  if (initiator) {
    peer.createOffer()
      .then(offer => peer.setLocalDescription(offer))
      .then(() => socket.emit("signal", { to: id, data: { sdp: peer.localDescription } }));
  }

  return peer;
}

// ---------------- SOCKET EVENTS ----------------
socket.on("all-users", users => {
  users.forEach(user => createPeer(user.id, true, user.name));
});

socket.on("user-joined", user => createPeer(user.id, false, user.name));

socket.on("signal", async ({ from, data }) => {
  let peer = peers[from];
  if (!peer) peer = createPeer(from, false);

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
});

socket.on("user-left", id => {
  peers[id]?.close();
  delete peers[id];
  removeVideo(id);
});

// ---------------- CHAT ----------------
function appendMessage({ sender, message }) {
  const p = document.createElement("p");
  p.textContent = message;

  if (sender === userName || sender === "You") {
    p.classList.add("self"); // Right side bubble
  } else {
    p.classList.add("other"); // Left side bubble
    p.textContent = `${sender}: ${message}`;
  }

  chatMessages.appendChild(p);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

sendMsgBtn.onclick = sendMessage;
toggleChatBtn.onclick = () => chatPanel.classList.toggle("hidden");

function sendMessage() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit("chat-message", { roomId, sender: userName, message: msg });
  appendMessage({ sender: "You", message: msg });
  chatInput.value = "";
}

socket.on("chat-message", msg => appendMessage(msg));

// ---------------- CONTROLS ----------------
micBtn.onclick = () => {
  isMicOn = !isMicOn;
  localStream.getAudioTracks().forEach(track => track.enabled = isMicOn);
  micBtn.textContent = isMicOn ? "🎤 Mute " : "🔇 Unmute ";
};

camBtn.onclick = () => {
  isCamOn = !isCamOn;
  localStream.getVideoTracks().forEach(track => track.enabled = isCamOn);
  camBtn.textContent = isCamOn ? "📷 Off" : "🚫 on ";
};

leaveBtn.onclick = () => {
  Object.values(peers).forEach(p => p.close());
  socket.disconnect();
  window.location.href = "/";
};

// ---------------- SCREEN SHARE ----------------
shareScreenBtn.onclick = async () => {
  if (screenStream) stopScreenShare();
  else startScreenShare();
};

async function startScreenShare() {
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];

    Object.values(peers).forEach(peer => {
      const sender = peer.getSenders().find(s => s.track && s.track.kind === "video");
      if (sender) sender.replaceTrack(screenTrack);
    });

    const localVideoEl = document.getElementById(socket.id).querySelector("video");
    localVideoEl.srcObject = screenStream;

    screenTrack.onended = stopScreenShare;
    shareScreenBtn.textContent = "🛑 Stop Share";
  } catch (err) {
    console.error("Screen share error:", err);
    alert("Screen share failed: " + err.message);
  }
}

function stopScreenShare() {
  if (!screenStream) return;

  const videoTrack = localStream.getVideoTracks()[0];

  Object.values(peers).forEach(peer => {
    const sender = peer.getSenders().find(s => s.track && s.track.kind === "video");
    if (sender) sender.replaceTrack(videoTrack);
  });

  const localVideoEl = document.getElementById(socket.id).querySelector("video");
  localVideoEl.srcObject = localStream;

  screenStream.getTracks().forEach(track => track.stop());
  screenStream = null;
  shareScreenBtn.textContent = "🖥️ Share Screen";
}

// ---------------- START ----------------
getMedia();
