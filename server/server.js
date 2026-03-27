const express = require("express");
const http    = require("http");
const { Server } = require("socket.io");
const path    = require("path");

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: "*" }, pingTimeout: 60000 });

const PUBLIC = path.join(__dirname, "../public");
app.use(express.static(PUBLIC));
app.get("/",     (_, r) => r.sendFile(path.join(PUBLIC, "index.html")));
app.get("/room", (_, r) => r.sendFile(path.join(PUBLIC, "room.html")));

// rooms: Map<roomId, Map<socketId, {id,name,micOn,camOn}>>
const rooms = new Map();

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, new Map());
  return rooms.get(id);
}

io.on("connection", socket => {
  let myRoom = null, myName = null;

  socket.on("join-room", ({ roomId, name }) => {
    if (!roomId || !name) return;
    myRoom = String(roomId).toUpperCase().trim().slice(0, 32);
    myName = String(name).trim().slice(0, 32);
    socket.join(myRoom);
    const rm = getRoom(myRoom);
    socket.emit("all-users", Array.from(rm.values()));
    rm.set(socket.id, { id: socket.id, name: myName, micOn: true, camOn: true });
    socket.to(myRoom).emit("user-joined", { id: socket.id, name: myName });
    io.to(myRoom).emit("room-count", rm.size);
    console.log(`[${myRoom}] +${myName} (${rm.size})`);
  });

  socket.on("signal",            ({ to, data })        => to && data && socket.to(to).emit("signal", { from: socket.id, data }));
  socket.on("chat-msg",          ({ roomId, message }) => socket.to(roomId).emit("chat-msg",  { name: myName, message: String(message).slice(0,1000), ts: Date.now() }));
  socket.on("media-state",       ({ roomId, mic, cam })=> { const rm=rooms.get(roomId); if(rm?.has(socket.id)){const u=rm.get(socket.id);u.micOn=mic;u.camOn=cam;} socket.to(roomId).emit("peer-state",{id:socket.id,mic,cam}); });
  socket.on("speaking",          ({ roomId, on })      => socket.to(roomId).emit("peer-speaking",   { id: socket.id, on }));
  socket.on("screen-on",         ({ roomId })          => socket.to(roomId).emit("peer-screen-on",  { id: socket.id, name: myName }));
  socket.on("screen-off",        ({ roomId })          => socket.to(roomId).emit("peer-screen-off", { id: socket.id }));
  socket.on("raise-hand",        ({ roomId })          => socket.to(roomId).emit("peer-hand",       { id: socket.id, name: myName }));
  socket.on("pin",               ({ roomId, peerId })  => io.to(roomId).emit("do-pin",              { peerId }));
  socket.on("unpin",             ({ roomId })          => io.to(roomId).emit("do-unpin",             {}));

  socket.on("disconnect", () => {
    if (!myRoom || !rooms.has(myRoom)) return;
    const rm = rooms.get(myRoom);
    rm.delete(socket.id);
    if (rm.size === 0) rooms.delete(myRoom);
    else { io.to(myRoom).emit("user-left", socket.id); io.to(myRoom).emit("room-count", rm.size); }
    console.log(`[${myRoom}] -${myName}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀  EduStream → http://localhost:${PORT}`));