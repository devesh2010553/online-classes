"use strict";
const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");
const path    = require("path");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: "*" },
  pingTimeout:  60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6,
});

app.use(express.static(path.join(__dirname, "../public")));
app.get("/",     (_, res) => res.sendFile(path.join(__dirname, "../public/index.html")));
app.get("/room", (_, res) => res.sendFile(path.join(__dirname, "../public/room.html")));

// ── Room registry ──────────────────────────────────────────────────────────
// rooms[roomId] = Map<socketId, UserRecord>
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

io.on("connection", (socket) => {
  let currentRoom = null;
  let currentName = null;
  console.log("[+]", socket.id);

  // ── JOIN ────────────────────────────────────────────────────────────────
  socket.on("join-room", ({ roomId, name }) => {
    if (!roomId || !name) return;
    currentRoom = String(roomId).trim().toUpperCase().slice(0, 32);
    currentName = String(name).trim().slice(0, 32);

    socket.join(currentRoom);
    const room = getRoom(currentRoom);

    // Send existing peers to joiner
    socket.emit("all-users", Array.from(room.values()));

    // Register self
    room.set(socket.id, {
      id:        socket.id,
      name:      currentName,
      joinedAt:  Date.now(),
      micOn:     true,
      camOn:     true,
      isSharing: false,
    });

    // Notify others
    socket.to(currentRoom).emit("user-joined", { id: socket.id, name: currentName });
    io.to(currentRoom).emit("participant-count", room.size);
    console.log(`[${currentRoom}] ${currentName} joined (${room.size})`);
  });

  // ── WebRTC SIGNAL ───────────────────────────────────────────────────────
  socket.on("signal", ({ to, data }) => {
    if (!to || !data) return;
    socket.to(to).emit("signal", { from: socket.id, data });
  });

  // ── CHAT ────────────────────────────────────────────────────────────────
  socket.on("chat-message", ({ roomId, sender, message, ts }) => {
    if (!roomId || !message) return;
    socket.to(roomId).emit("chat-message", {
      sender:  String(sender).slice(0, 32),
      message: String(message).slice(0, 500),
      ts:      ts || Date.now(),
    });
  });

  // ── MEDIA STATE ─────────────────────────────────────────────────────────
  socket.on("media-state", ({ roomId, micOn, camOn }) => {
    const room = rooms.get(roomId);
    if (room && room.has(socket.id)) {
      const u = room.get(socket.id);
      u.micOn = micOn; u.camOn = camOn;
    }
    socket.to(roomId).emit("peer-media-state", { id: socket.id, micOn, camOn });
  });

  // ── RAISE HAND ──────────────────────────────────────────────────────────
  socket.on("raise-hand", ({ roomId }) => {
    socket.to(roomId).emit("peer-raised-hand", { id: socket.id, name: currentName });
  });

  // ── SPEAKING ────────────────────────────────────────────────────────────
  socket.on("speaking", ({ roomId, isSpeaking }) => {
    socket.to(roomId).emit("peer-speaking", { id: socket.id, isSpeaking });
  });

  // ── SCREEN SHARE STATE ──────────────────────────────────────────────────
  socket.on("screen-share-state", ({ roomId, isSharing, mode }) => {
    const room = rooms.get(roomId);
    if (room && room.has(socket.id)) room.get(socket.id).isSharing = isSharing;
    socket.to(roomId).emit("peer-screen-share", {
      id: socket.id, name: currentName, isSharing, mode,
    });
  });

  // ── MOBILE CAM-SHARE (camera used as document cam) ──────────────────────
  socket.on("mobile-cam-share", ({ roomId, isSharing }) => {
    socket.to(roomId).emit("peer-mobile-cam-share", {
      id: socket.id, name: currentName, isSharing,
    });
  });

  // ── DISCONNECT ──────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    console.log("[-]", socket.id, currentName);
    if (!currentRoom || !rooms.has(currentRoom)) return;
    const room = rooms.get(currentRoom);
    room.delete(socket.id);
    if (room.size === 0) {
      rooms.delete(currentRoom);
    } else {
      io.to(currentRoom).emit("user-left", socket.id);
      io.to(currentRoom).emit("participant-count", room.size);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`\n  EduStream 4K  →  http://localhost:${PORT}\n`));