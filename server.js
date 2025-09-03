import express from "express";
import http from "http";
import { Server as IOServer } from "socket.io";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import fs from "fs";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import path from "path";

dotenv.config();

const PORT = process.env.PORT || 4000;
const DB_URL = process.env.DATABASE_URL;

// 🔹 Charger clés RSA
const PRIVATE_KEY = Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64, "base64").toString("utf8");
const PUBLIC_KEY = Buffer.from(process.env.JWT_PUBLIC_KEY_BASE64, "base64").toString("utf8");

// 🔹 Parse DB URL
function parseDbUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port,
    user: u.username,
    password: u.password,
    database: u.pathname.substring(1) || "defaultdb",
    ssl: u.searchParams.get("ssl-mode") ? { rejectUnauthorized: false } : undefined
  };
}

let db;

// 🔹 Init DB
async function initDb() {
  db = await mysql.createConnection(parseDbUrl(DB_URL));
  console.log("✅ Connecté à MySQL");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      room VARCHAR(50),
      author VARCHAR(50),
      content TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  console.log("✅ Tables prêtes");
}

// 🔹 Middleware JWT
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Token manquant" });
  const token = header.split(" ")[1];
  try {
    req.user = jwt.verify(token, PUBLIC_KEY, { algorithms: ["RS256"] });
    next();
  } catch (err) {
    res.status(401).json({ error: "Token invalide" });
  }
}

// 🔹 Express + Socket.IO
const app = express();
const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: "*" } });

app.use(express.json());

// 🔹 Routes HTTP test
app.get("/", (req, res) => {
  res.json({ status: "GamerHubX API + Socket OK 🚀" });
});

// 🔹 Auth routes
app.post("/api/auth/register", async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  try {
    const [result] = await db.execute(
      "INSERT INTO users (username, password) VALUES (?, ?)",
      [username, hash]
    );
    const token = jwt.sign({ id: result.insertId, username }, PRIVATE_KEY, { algorithm: "RS256", expiresIn: JWT_EXPIRES_IN });
    res.json({ token, username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const [rows] = await db.execute("SELECT * FROM users WHERE username=?", [username]);
  if (!rows.length) return res.status(400).json({ error: "Utilisateur introuvable" });

  const user = rows[0];
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: "Mot de passe invalide" });

  const token = jwt.sign({ id: user.id, username }, PRIVATE_KEY, { algorithm: "RS256", expiresIn: JWT_EXPIRES_IN });
  res.json({ token, username });
});

// 🔹 Messages routes
app.get("/api/messages/:room", authMiddleware, async (req, res) => {
  const { room } = req.params;
  const [rows] = await db.execute(
    "SELECT author, content, created_at FROM messages WHERE room=? ORDER BY created_at ASC LIMIT 50",
    [room]
  );
  res.json(rows);
});

// 🔹 Socket.IO logic
io.on("connection", (socket) => {
  console.log("🔗 User connecté:", socket.id);

  socket.on("joinRoom", (room) => {
    socket.join(room);
    console.log(`📌 ${socket.id} a rejoint ${room}`);
  });

  socket.on("chatMessage", async ({ room, author, content }) => {
    await db.execute(
      "INSERT INTO messages (room, author, content) VALUES (?, ?, ?)",
      [room, author, content]
    );
    io.to(room).emit("chatMessage", { room, author, content, created_at: new Date() });
  });
});

// 🔹 Lancer serveur
initDb().then(() => {
  server.listen(PORT, () => console.log(`🚀 Serveur sur http://localhost:${PORT}`));
});
