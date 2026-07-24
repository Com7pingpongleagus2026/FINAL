const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Load locations
let locations = [];
try {
  locations = JSON.parse(fs.readFileSync(path.join(__dirname, "public", "locations.json"), "utf8"));
} catch (e) { console.error("Failed to load locations:", e); }

// Avatars
const AVATARS = ["🦊","🐱","🐶","🐸","🦁","🐼","🐨","🐯","🐰","🦄","🐵","🐲"];
const COLORS = ["#6366f1","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#8b5cf6","#06b6d4","#f97316","#14b8a6","#e11d48","#7c3aed"];

// In-memory rooms
const rooms = {};

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms[code] ? generateCode() : code;
}

function getRoom(code) { return rooms[code] || null; }

function assignAvatar(room) {
  const used = room.players.map(p => p.avatar);
  for (let a of AVATARS) { if (!used.includes(a)) return a; }
  return AVATARS[Math.floor(Math.random() * AVATARS.length)];
}

function assignColor(idx) {
  return COLORS[idx % COLORS.length];
}

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Create room
  socket.on("create-room", ({ playerName, settings }) => {
    const code = generateCode();
    const avatar = AVATARS[0];
    const color = COLORS[0];
    rooms[code] = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name: playerName, connected: true, avatar, color }],
      state: "lobby",
      settings: settings || { timer: 480 },
      game: null
    };
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = playerName;
    socket.emit("room-created", { code, players: rooms[code].players, host: socket.id });
  });

  // Join room
  socket.on("join-room", ({ code, playerName }) => {
    const room = getRoom(code.toUpperCase());
    if (!room) return socket.emit("error-msg", "ไม่พบห้องนี้");
    if (room.state !== "lobby") return socket.emit("error-msg", "เกมเริ่มแล้ว ไม่สามารถเข้าร่วมได้");
    if (room.players.length >= 12) return socket.emit("error-msg", "ห้องเต็มแล้ว (สูงสุด 12 คน)");
    if (room.players.find(p => p.name === playerName)) return socket.emit("error-msg", "ชื่อนี้ถูกใช้แล้ว");

    const avatar = assignAvatar(room);
    const color = assignColor(room.players.length);
    room.players.push({ id: socket.id, name: playerName, connected: true, avatar, color });
    socket.join(code.toUpperCase());
    socket.roomCode = code.toUpperCase();
    socket.playerName = playerName;
    socket.emit("room-joined", { code: room.code, players: room.players, host: room.host });
    io.to(room.code).emit("player-list", { players: room.players, host: room.host });
  });

  // Update settings
  socket.on("update-settings", ({ timer }) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    if (timer) room.settings.timer = parseInt(timer);
    io.to(room.code).emit("settings-updated", room.settings);
  });

  // Start game
  socket.on("start-game", () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 3) return socket.emit("error-msg", "ต้องมีผู้เล่นอย่างน้อย 3 คน");

    // Pick random location
    const loc = locations[Math.floor(Math.random() * locations.length)];
    // Pick spy (random)
    const spyIndex = Math.floor(Math.random() * room.players.length);
    // Assign roles
    const availableRoles = [...loc.roles].sort(() => Math.random() - 0.5);

    room.game = {
      location: loc.name,
      spy: room.players[spyIndex].id,
      spyName: room.players[spyIndex].name,
      assignments: {},
      startTime: Date.now(),
      timer: room.settings.timer
    };

    room.players.forEach((p, i) => {
      if (i === spyIndex) {
        room.game.assignments[p.id] = { role: "🕵️ สายลับ", location: null, isSpy: true };
      } else {
        room.game.assignments[p.id] = {
          role: availableRoles[i % availableRoles.length],
          location: loc.name,
          isSpy: false
        };
      }
    });

    room.state = "playing";

    // Send each player their card
    room.players.forEach(p => {
      const assignment = room.game.assignments[p.id];
      io.to(p.id).emit("game-started", {
        assignment,
        timer: room.settings.timer,
        players: room.players.map(pl => ({ id: pl.id, name: pl.name, avatar: pl.avatar, color: pl.color, isHost: pl.id === room.host })),
        locationCount: locations.length
      });
    });
  });

  // End round (Host reveals)
  socket.on("end-round", () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id || room.state !== "playing") return;

    room.state = "reveal";
    const revealData = {
      spy: { name: room.game.spyName, id: room.game.spy },
      location: room.game.location,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        role: room.game.assignments[p.id].role,
        isSpy: p.id === room.game.spy
      }))
    };
    io.to(room.code).emit("round-reveal", revealData);
  });

  // Play again (back to lobby)
  socket.on("play-again", () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    room.state = "lobby";
    room.game = null;
    io.to(room.code).emit("back-to-lobby", { players: room.players, host: room.host });
  });

  // Kick player
  socket.on("kick-player", ({ targetId }) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    const kicked = room.players.find(p => p.id === targetId);
    room.players = room.players.filter(p => p.id !== targetId);
    io.to(targetId).emit("kicked");
    io.to(room.code).emit("player-list", { players: room.players, host: room.host });
    if (kicked) io.to(room.code).emit("toast-msg", `${kicked.name} ถูกเตะออก`);
  });

  // Get locations list
  socket.on("get-locations", () => {
    socket.emit("locations-list", locations.map(l => l.name));
  });

  // Disconnect
  socket.on("disconnect", () => {
    const room = getRoom(socket.roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player) player.connected = false;

    // If host left, transfer
    if (room.host === socket.id) {
      const nextHost = room.players.find(p => p.connected && p.id !== socket.id);
      if (nextHost) {
        room.host = nextHost.id;
        io.to(room.code).emit("host-changed", { newHost: nextHost.name, hostId: nextHost.id });
      } else {
        delete rooms[room.code];
        return;
      }
    }

    // Remove after 60s if not reconnected
    setTimeout(() => {
      const r = getRoom(socket.roomCode);
      if (r && player && !player.connected) {
        r.players = r.players.filter(p => p.id !== socket.id);
        if (r.players.length === 0) {
          delete rooms[r.code];
        } else {
          io.to(r.code).emit("player-list", { players: r.players, host: r.host });
        }
      }
    }, 60000);

    io.to(room.code).emit("player-list", { players: room.players, host: room.host });
  });
});

server.listen(PORT, () => console.log(`🕵️ Spyfall Online running on port ${PORT}`));
