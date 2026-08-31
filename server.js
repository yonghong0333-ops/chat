// backend/server.js
// 獨立運作的後端伺服器：只負責 API + 即時通訊，不放前端網頁檔案
// 前端可以放在完全不同的網址（例如 Vercel/Netlify），透過 CORS 設定允許跨網域連線

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

// ---- 跨域設定 (CORS) ----
// CLIENT_ORIGIN 環境變數可以指定「只允許哪個前端網址」連進來，比較安全
// 本機測試 / 還沒決定前端網址時，先用 "*" 允許全部來源
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

// 健康檢查路由：用來確認伺服器有沒有正常運作
// 前端也可以先打這支 API 測試「有沒有連到後端」
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "後端伺服器運作正常", time: Date.now() });
});

// ---- 聊天室邏輯 ----
const onlineUsers = {}; // { socketId: 暱稱 }
const MAX_HISTORY = 50;
let messageHistory = [];

io.on("connection", (socket) => {
  console.log(`[連線] ${socket.id}`);

  socket.on("join", (username) => {
    const name = (username || "訪客").toString().trim().slice(0, 20) || "訪客";
    onlineUsers[socket.id] = name;

    socket.emit("history", messageHistory);

    const joinMsg = { type: "system", text: `${name} 加入了聊天室`, time: Date.now() };
    messageHistory.push(joinMsg);
    if (messageHistory.length > MAX_HISTORY) messageHistory.shift();

    io.emit("system message", joinMsg);
    io.emit("online users", Object.values(onlineUsers));
  });

  socket.on("chat message", (text) => {
    const name = onlineUsers[socket.id] || "訪客";
    const trimmed = (text || "").toString().trim().slice(0, 1000);
    if (!trimmed) return;

    const msg = { type: "chat", user: name, text: trimmed, time: Date.now() };
    messageHistory.push(msg);
    if (messageHistory.length > MAX_HISTORY) messageHistory.shift();

    io.emit("chat message", msg);
  });

  socket.on("disconnect", () => {
    const name = onlineUsers[socket.id];
    if (name) {
      delete onlineUsers[socket.id];
      const leaveMsg = { type: "system", text: `${name} 離開了聊天室`, time: Date.now() };
      messageHistory.push(leaveMsg);
      if (messageHistory.length > MAX_HISTORY) messageHistory.shift();

      io.emit("system message", leaveMsg);
      io.emit("online users", Object.values(onlineUsers));
    }
    console.log(`[離線] ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`後端伺服器啟動，監聽埠號 ${PORT}`);
  console.log(`允許的前端來源 (CLIENT_ORIGIN): ${CLIENT_ORIGIN}`);
});
