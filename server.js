// backend/server.js
// 獨立運作的後端伺服器：只負責 API + 即時通訊，不放前端網頁檔案
// 前端可以放在完全不同的網址（例如 Vercel/Netlify），透過 CORS 設定允許跨網域連線
// 訊息會存進 MongoDB Atlas，重新整理 / 伺服器重啟後歷史訊息不會消失

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");

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

// ---- MongoDB 連線設定 ----
// MONGODB_URI 環境變數：MongoDB Atlas 的連線字串
// 沒設定的話，訊息就只存在記憶體裡（跟原本行為一樣），伺服器重啟就會消失
const MONGODB_URI = process.env.MONGODB_URI || "";
const DB_NAME = "chatdb";
const COLLECTION_NAME = "messages";
const MAX_HISTORY = 50;

let messagesCollection = null;
let messageHistory = []; // 沒有資料庫時的記憶體備援

async function connectDB() {
  if (!MONGODB_URI) {
    console.log("[資料庫] 未設定 MONGODB_URI，訊息只會存在記憶體中");
    return;
  }
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    messagesCollection = db.collection(COLLECTION_NAME);
    console.log("[資料庫] 已連線到 MongoDB Atlas");
  } catch (err) {
    console.error("[資料庫] 連線失敗，改用記憶體暫存訊息:", err.message);
    messagesCollection = null;
  }
}

async function saveMessage(msg) {
  if (messagesCollection) {
    try {
      await messagesCollection.insertOne(msg);
      return;
    } catch (err) {
      console.error("[資料庫] 寫入失敗:", err.message);
    }
  }
  // 資料庫沒接上或寫入失敗時，退回記憶體暫存
  messageHistory.push(msg);
  if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
}

async function loadHistory() {
  if (messagesCollection) {
    try {
      const docs = await messagesCollection
        .find({}, { projection: { _id: 0 } })
        .sort({ time: -1 })
        .limit(MAX_HISTORY)
        .toArray();
      return docs.reverse();
    } catch (err) {
      console.error("[資料庫] 讀取失敗，改回傳記憶體訊息:", err.message);
      return messageHistory;
    }
  }
  return messageHistory;
}

// 健康檢查路由：用來確認伺服器有沒有正常運作
// 前端也可以先打這支 API 測試「有沒有連到後端」
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "後端伺服器運作正常",
    database: messagesCollection ? "connected" : "not connected",
    time: Date.now(),
  });
});

// ---- 聊天室邏輯 ----
const onlineUsers = {}; // { socketId: 暱稱 }

io.on("connection", (socket) => {
  console.log(`[連線] ${socket.id}`);

  socket.on("join", async (username) => {
    const name = (username || "訪客").toString().trim().slice(0, 20) || "訪客";
    onlineUsers[socket.id] = name;

    const history = await loadHistory();
    socket.emit("history", history);

    const joinMsg = { type: "system", text: `${name} 加入了聊天室`, time: Date.now() };
    await saveMessage(joinMsg);

    io.emit("system message", joinMsg);
    io.emit("online users", Object.values(onlineUsers));
  });

  socket.on("chat message", async (text) => {
    const name = onlineUsers[socket.id] || "訪客";
    const trimmed = (text || "").toString().trim().slice(0, 1000);
    if (!trimmed) return;

    const msg = { type: "chat", user: name, text: trimmed, time: Date.now() };
    await saveMessage(msg);

    io.emit("chat message", msg);
  });

  socket.on("disconnect", async () => {
    const name = onlineUsers[socket.id];
    if (name) {
      delete onlineUsers[socket.id];
      const leaveMsg = { type: "system", text: `${name} 離開了聊天室`, time: Date.now() };
      await saveMessage(leaveMsg);

      io.emit("system message", leaveMsg);
      io.emit("online users", Object.values(onlineUsers));
    }
    console.log(`[離線] ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`後端伺服器啟動，監聽埠號 ${PORT}`);
    console.log(`允許的前端來源 (CLIENT_ORIGIN): ${CLIENT_ORIGIN}`);
  });
});
