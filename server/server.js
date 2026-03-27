const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

app.use(express.static("public"));

const rooms = {}; // store room users: { roomId: { socketId: name } }

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", ({ roomId, name }) => {
    if (!rooms[roomId]) rooms[roomId] = {};
    rooms[roomId][socket.id] = name;

    // Join socket.io room
    socket.join(roomId);

    // Send all existing users in room to this new user
    const users = Object.keys(rooms[roomId])
      .filter(id => id !== socket.id)
      .map(id => ({ id, name: rooms[roomId][id] }));

    socket.emit("all-users", users);

    // Notify others that a new user joined
    socket.to(roomId).emit("user-joined", { id: socket.id, name });

    console.log(`User ${name} joined room ${roomId}`);
  });

  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("chat-message", ({ roomId, sender, message }) => {
    // Broadcast to room except sender
    socket.to(roomId).emit("chat-message", { sender, message });
  });

  socket.on("disconnect", () => {
    // Remove user from all rooms
    for (const roomId in rooms) {
      if (rooms[roomId][socket.id]) {
        const name = rooms[roomId][socket.id];
        delete rooms[roomId][socket.id];
        // Notify others
        socket.to(roomId).emit("user-left", socket.id);
        console.log(`User ${name} disconnected from room ${roomId}`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
