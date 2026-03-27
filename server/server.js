const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, "../public")));

// Serve index.html for root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// Serve room.html
app.get("/room", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/room.html"));
});

// --- Room state ---
// rooms[roomId] = Map<socketId, { id, name, joinedAt }>
const rooms = new Map();

function getRoomUsers(roomId) {
  return rooms.has(roomId) ? Array.from(rooms.get(roomId).values()) : [];
}

io.on("connection", (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  let currentRoom = null;
  let currentName = null;

  // ---- JOIN ROOM ----
  socket.on("join-room", ({ roomId, name }) => {
    if (!roomId || !name) return;

    currentRoom = roomId;
    currentName = name.trim().slice(0, 32);

    socket.join(roomId);

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    // Send existing users list to the joiner
    const existingUsers = Array.from(room.values());
    socket.emit("all-users", existingUsers);

    // Add self to room map
    room.set(socket.id, { id: socket.id, name: currentName, joinedAt: Date.now() });

    // Notify others
    socket.to(roomId).emit("user-joined", { id: socket.id, name: currentName });

    // Broadcast updated participant count
    io.to(roomId).emit("participant-count", room.size);

    console.log(`[Room ${roomId}] ${currentName} joined (${room.size} users)`);
  });

  // ---- WebRTC SIGNAL ----
  socket.on("signal", ({ to, data }) => {
    if (!to || !data) return;
    socket.to(to).emit("signal", { from: socket.id, data });
  });

  // ---- CHAT MESSAGE ----
  socket.on("chat-message", ({ roomId, sender, message }) => {
    if (!roomId || !message) return;
    const safeMsg = String(message).slice(0, 500);
    const payload = { sender: String(sender).slice(0, 32), message: safeMsg, ts: Date.now() };
    socket.to(roomId).emit("chat-message", payload);
  });

  // ---- MEDIA STATE CHANGE (mic/cam) ----
  socket.on("media-state", ({ roomId, micOn, camOn }) => {
    socket.to(roomId).emit("peer-media-state", { id: socket.id, micOn, camOn });
  });

  // ---- RAISE HAND ----
  socket.on("raise-hand", ({ roomId }) => {
    socket.to(roomId).emit("peer-raised-hand", { id: socket.id, name: currentName });
  });

  // ---- DISCONNECT ----
  socket.on("disconnect", () => {
    console.log(`[-] Disconnected: ${socket.id} (${currentName})`);
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.delete(socket.id);
      if (room.size === 0) {
        rooms.delete(currentRoom);
      } else {
        io.to(currentRoom).emit("user-left", socket.id);
        io.to(currentRoom).emit("participant-count", room.size);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Live Class running at http://localhost:${PORT}`));