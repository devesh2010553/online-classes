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

// Serve all static files from /public
app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

app.get("/room", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/room.html"));
});

// rooms[roomId] = Map<socketId, { id, name, joinedAt }>
const rooms = new Map();

io.on("connection", (socket) => {
  console.log("[+] Connected:", socket.id);
  let currentRoom = null;
  let currentName = null;

  socket.on("join-room", ({ roomId, name }) => {
    if (!roomId || !name) return;
    currentRoom = roomId;
    currentName = name.trim().slice(0, 32);
    socket.join(roomId);
    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);
    const existingUsers = Array.from(room.values());
    socket.emit("all-users", existingUsers);
    room.set(socket.id, { id: socket.id, name: currentName, joinedAt: Date.now() });
    socket.to(roomId).emit("user-joined", { id: socket.id, name: currentName });
    io.to(roomId).emit("participant-count", room.size);
    console.log(`[Room ${roomId}] ${currentName} joined (${room.size} users)`);
  });

  socket.on("signal", ({ to, data }) => {
    if (!to || !data) return;
    socket.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("chat-message", ({ roomId, sender, message, ts }) => {
    if (!roomId || !message) return;
    socket.to(roomId).emit("chat-message", {
      sender: String(sender).slice(0, 32),
      message: String(message).slice(0, 500),
      ts: ts || Date.now(),
    });
  });

  socket.on("media-state", ({ roomId, micOn, camOn }) => {
    socket.to(roomId).emit("peer-media-state", { id: socket.id, micOn, camOn });
  });

  socket.on("raise-hand", ({ roomId }) => {
    socket.to(roomId).emit("peer-raised-hand", { id: socket.id, name: currentName });
  });

  socket.on("speaking", ({ roomId, isSpeaking }) => {
    socket.to(roomId).emit("peer-speaking", { id: socket.id, isSpeaking });
  });

  socket.on("screen-share-state", ({ roomId, isSharing }) => {
    socket.to(roomId).emit("peer-screen-share", { id: socket.id, name: currentName, isSharing });
  });

  socket.on("disconnect", () => {
    console.log("[-] Disconnected:", socket.id, currentName);
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
server.listen(PORT, () => console.log(`EduStream running at http://localhost:${PORT}`));