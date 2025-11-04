// server/index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// --- In-memory pairing structures ---
let waitingUsers = {}; // { interest: [socketId, ...] }
let activePairs = {};  // { socketId: partnerSocketId }

// --- Socket.IO Logic ---
io.on("connection", (socket) => {
  console.log("🔌 Connected:", socket.id);

  // Client asks to find a partner for an interest
  socket.on("find_partner", (interest) => {
    if (!interest) interest = "Random";
    if (!waitingUsers[interest]) waitingUsers[interest] = [];

    // try to find partner who is waiting (not same socket)
    const partnerId = waitingUsers[interest].find((id) => id !== socket.id);

    if (partnerId) {
      // remove partner from waiting list
      waitingUsers[interest] = waitingUsers[interest].filter((id) => id !== partnerId);

      // set active pair both ways
      activePairs[socket.id] = partnerId;
      activePairs[partnerId] = socket.id;

      io.to(socket.id).emit("partner_found", partnerId);
      io.to(partnerId).emit("partner_found", socket.id);

      console.log(`🎯 Matched ${socket.id} ↔ ${partnerId}`);
    } else {
      // add to waiting list if not present
      if (!waitingUsers[interest].includes(socket.id)) {
        waitingUsers[interest].push(socket.id);
      }
      io.to(socket.id).emit("waiting", "Waiting for another user...");
    }
  });

  // Text message relay
  socket.on("send_message", (data) => {
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      // send to partner
      io.to(partnerId).emit("receive_message", { sender: "partner", text: data.text });
      // echo back to sender
      io.to(socket.id).emit("receive_message", { sender: "me", text: data.text });
    }
  });

  // --- WebRTC Signaling (offer/answer/ice) ---
  socket.on("offer", ({ offer }) => {
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("offer", { from: socket.id, offer });
    }
  });

  socket.on("answer", ({ to, answer }) => {
    // answer includes { to: partnerSocketId, answer }
    if (to) {
      io.to(to).emit("answer", { from: socket.id, answer });
    }
  });

  socket.on("ice-candidate", ({ candidate }) => {
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("ice-candidate", { from: socket.id, candidate });
    }
  });

  // partner wants to stop video (forward)
  socket.on("stop_video", () => {
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("stop_video");
    }
  });

  // optional: partner left chat
  socket.on("leaveChat", () => {
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("partner_disconnected");
      delete activePairs[partnerId];
    }
    // remove from waiting lists
    for (let interest in waitingUsers) {
      waitingUsers[interest] = waitingUsers[interest].filter((id) => id !== socket.id);
    }
    delete activePairs[socket.id];
  });

  // handle disconnect
  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("partner_disconnected");
      delete activePairs[partnerId];
    }
    for (let interest in waitingUsers) {
      waitingUsers[interest] = waitingUsers[interest].filter((id) => id !== socket.id);
    }
    delete activePairs[socket.id];
  });
});

// simple root route
app.get("/", (_, res) => res.send("✅ Omegle backend is live!"));

// port
const PORT = 5000;
console.log("🧠 PORT FROM ENV:", process.env.PORT);
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
