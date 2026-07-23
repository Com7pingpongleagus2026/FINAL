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

// In-memory rooms
const rooms = {};

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms[code] ? generateCode() : code;
}

function getRoom(code) { return rooms[code] || null; }

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  // Create room
  socket.on("create-room", ({ playerName, settings }) => {
    const code = generateCode();
    rooms[code] = {
      code,
      host: socket.id,
      players: [{ id: socket.id, name: playerName, connected: true }],
      state: "lobby", // lobby, playing, voting, results
      settings: settings || { mode: "normal", timer: 480 },
      game: null,
      votes: {}
    };
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = playerName;
    socket.emit("room-created", { code, players: rooms[code].players });
  });

  // Join room
  socket.on("join-room", ({ code, playerName }) => {
    const room = getRoom(code.toUpperCase());
    if (!room) return socket.emit("error-msg", "ไม่พบห้องนี้");
    if (room.state !== "lobby") return socket.emit("error-msg", "เกมเริ่มแล้ว ไม่สามารถเข้าร่วมได้");
    if (room.players.length >= 12) return socket.emit("error-msg", "ห้องเต็มแล้ว (สูงสุด 12 คน)");
    if (room.players.find(p => p.name === playerName)) return socket.emit("error-msg", "ชื่อนี้ถูกใช้แล้ว");

    room.players.push({ id: socket.id, name: playerName, connected: true });
    socket.join(code.toUpperCase());
    socket.roomCode = code.toUpperCase();
    socket.playerName = playerName;
    socket.emit("room-joined", { code: room.code, players: room.players, host: room.host });
    io.to(room.code).emit("player-list", { players: room.players, host: room.host });
  });

  // Update settings
  socket.on("update-settings", ({ timer, mode }) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    if (timer) room.settings.timer = timer;
    if (mode) room.settings.mode = mode;
    io.to(room.code).emit("settings-updated", room.settings);
  });

  // Start game
  socket.on("start-game", () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 3) return socket.emit("error-msg", "ต้องมีผู้เล่นอย่างน้อย 3 คน");

    // Pick random location
    const loc = locations[Math.floor(Math.random() * locations.length)];
    // Pick spy
    const spyIndex = Math.floor(Math.random() * room.players.length);
    // Assign roles
    const availableRoles = [...loc.roles].sort(() => Math.random() - 0.5);
    
    room.game = {
      location: loc.name,
      spy: room.players[spyIndex].id,
      assignments: {},
      startTime: Date.now(),
      timer: room.settings.timer
    };

    room.players.forEach((p, i) => {
      if (i === spyIndex) {
        room.game.assignments[p.id] = { role: "สายลับ", location: null, isSpy: true };
      } else {
        room.game.assignments[p.id] = { 
          role: availableRoles[i % availableRoles.length], 
          location: loc.name, 
          isSpy: false 
        };
      }
    });

    room.state = "playing";
    room.votes = {};

    // Send each player their card
    room.players.forEach(p => {
      const assignment = room.game.assignments[p.id];
      io.to(p.id).emit("game-started", {
        assignment,
        playerCount: room.players.length,
        timer: room.settings.timer,
        mode: room.settings.mode,
        players: room.players.map(pl => ({ name: pl.name, isHost: pl.id === room.host }))
      });
    });
  });

  // Start vote
  socket.on("start-vote", () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.state !== "playing") return;
    room.state = "voting";
    room.votes = {};
    io.to(room.code).emit("vote-started", { 
      players: room.players.map(p => ({ id: p.id, name: p.name }))
    });
  });

  // Cast vote
  socket.on("cast-vote", ({ targetId }) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.state !== "voting") return;
    room.votes[socket.id] = targetId;
    
    io.to(room.code).emit("vote-update", { 
      votedCount: Object.keys(room.votes).length,
      totalPlayers: room.players.length
    });

    // All voted?
    if (Object.keys(room.votes).length === room.players.length) {
      // Count votes
      const counts = {};
      Object.values(room.votes).forEach(v => { counts[v] = (counts[v] || 0) + 1; });
      const maxVotes = Math.max(...Object.values(counts));
      const accused = Object.keys(counts).find(k => counts[k] === maxVotes);
      const accusedPlayer = room.players.find(p => p.id === accused);
      const isSpy = accused === room.game.spy;
      const spyPlayer = room.players.find(p => p.id === room.game.spy);

      room.state = "results";
      io.to(room.code).emit("vote-results", {
        votes: room.votes,
        accused: { id: accused, name: accusedPlayer ? accusedPlayer.name : "?" },
        isSpy,
        spy: { id: room.game.spy, name: spyPlayer.name },
        location: room.game.location,
        players: room.players.map(p => ({
          id: p.id, name: p.name,
          role: room.game.assignments[p.id].role,
          isSpy: p.id === room.game.spy
        }))
      });
    }
  });

  // Spy guess
  socket.on("spy-guess", ({ location }) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.game.spy !== socket.id) return;
    const correct = location === room.game.location;
    const spyPlayer = room.players.find(p => p.id === room.game.spy);
    
    room.state = "results";
    io.to(room.code).emit("spy-guess-result", {
      spy: { name: spyPlayer.name },
      guessedLocation: location,
      actualLocation: room.game.location,
      correct,
      players: room.players.map(p => ({
        id: p.id, name: p.name,
        role: room.game.assignments[p.id].role,
        isSpy: p.id === room.game.spy
      }))
    });
  });

  // Play again
  socket.on("play-again", () => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    room.state = "lobby";
    room.game = null;
    room.votes = {};
    io.to(room.code).emit("back-to-lobby", { players: room.players, host: room.host });
  });

  // Kick player
  socket.on("kick-player", ({ targetId }) => {
    const room = getRoom(socket.roomCode);
    if (!room || room.host !== socket.id) return;
    room.players = room.players.filter(p => p.id !== targetId);
    io.to(targetId).emit("kicked");
    io.to(room.code).emit("player-list", { players: room.players, host: room.host });
  });

  // Get locations list (for spy guess)
  socket.on("get-locations", () => {
    socket.emit("locations-list", locations.map(l => l.name));
  });

  // Disconnect
  socket.on("disconnect", () => {
    const room = getRoom(socket.roomCode);
    if (!room) return;
    
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.connected = false;

    // If host left
    if (room.host === socket.id) {
      const nextHost = room.players.find(p => p.connected && p.id !== socket.id);
      if (nextHost) {
        room.host = nextHost.id;
        io.to(room.code).emit("host-changed", { newHost: nextHost.name });
      } else {
        delete rooms[room.code];
        return;
      }
    }

    // Remove after 30s if not reconnected
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
    }, 30000);

    io.to(room.code).emit("player-list", { players: room.players, host: room.host });
  });
});

server.listen(PORT, () => console.log(`🕵️ Spyfall Online running on port ${PORT}`));
