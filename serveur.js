import express from "express";
import http from "http";
import { Server as IOServer } from "socket.io";
import mysql from "mysql2/promise";

const PORT = process.env.PORT || 4000;
const DB_URL = process.env.DATABASE_URL; // Render > Environment Variables

// 🔹 Parse URL de connexion MySQL
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

// 🔹 Init DB + créer tables si non existantes
async function initDb() {
  db = await mysql.createConnection(parseDbUrl(DB_URL));
  console.log("✅ Connecté à MySQL");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
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

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: "*" } });

app.use(express.json());

// 🔹 Route HTTP test
app.get("/", (req, res) => {
  res.json({ status: "GamerHubX API + Socket OK 🚀" });
});

// 🔹 Routes API simples
app.post("/api/users", async (req, res) => {
  const { username } = req.body;
  try {
    const [result] = await db.execute("INSERT INTO users (username) VALUES (?)", [username]);
    res.json({ id: result.insertId, username });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/messages/:room", async (req, res) => {
  const { room } = req.params;
  const [rows] = await db.execute(
    "SELECT author, content, created_at FROM messages WHERE room=? ORDER BY created_at ASC LIMIT 50",
    [room]
  );
  res.json(rows);
});

// 🔹 Socket.io logique
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

initDb().then(() => {
  server.listen(PORT, () => console.log(`🚀 Serveur sur http://localhost:${PORT}`));
});
