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
    origin: "*", // allow all for now
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// --- In-memory pairing ---
let waitingUsers = {}; 
let activePairs = {};

// --- Socket.IO Logic ---
io.on("connection", (socket) => {
  console.log("🔌 Connected:", socket.id);

  socket.on("find_partner", (interest) => {
    if (!waitingUsers[interest]) waitingUsers[interest] = [];

    const partnerId = waitingUsers[interest].find(id => id !== socket.id);
    if (partnerId) {
      waitingUsers[interest] = waitingUsers[interest].filter(id => id !== partnerId);

      activePairs[socket.id] = partnerId;
      activePairs[partnerId] = socket.id;

      io.to(socket.id).emit("partner_found", partnerId);
      io.to(partnerId).emit("partner_found", socket.id);

      console.log(`🎯 Matched ${socket.id} ↔ ${partnerId}`);
    } else {
      waitingUsers[interest].push(socket.id);
      io.to(socket.id).emit("waiting", "Waiting for another user...");
    }
  });

  socket.on("send_message", (data) => {
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("receive_message", { sender: "partner", text: data.text });
      io.to(socket.id).emit("receive_message", { sender: "me", text: data.text });
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
    const partnerId = activePairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("partner_disconnected");
      delete activePairs[partnerId];
    }
    for (let interest in waitingUsers) {
      waitingUsers[interest] = waitingUsers[interest].filter(id => id !== socket.id);
    }
    delete activePairs[socket.id];
  });
});

app.get("/", (_, res) => res.send("✅ Omegle backend is live!"));

const PORT = process.env.PORT || 5000;
console.log("🧠 PORT FROM ENV:", process.env.PORT);

server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
