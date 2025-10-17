const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const path = require('path');
const fs = require('fs');

app.use(express.static(path.join(__dirname, 'public')));

const roomMembers = new Map();

app.get('/api/emojis', (req, res) => {
  res.json(listEmojiUrls());
});

io.on('connection', (socket) => {
  socket.data.displayName = `访客${socket.id.slice(-4)}`;
  socket.data.roomId = null;

  joinRoom(socket);
  socket.on('join', (payload) => {
    joinRoom(socket, payload);
  });
  socket.on('chat message', (payload = {}) => {
    handleMessage(socket, payload);
  });
  socket.on('disconnect', () => {
    handleDisconnect(socket);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});

function listEmojiUrls() {
  const emojiDir = path.join(__dirname, 'public', 'emojis');
  try {
    return fs.readdirSync(emojiDir)
      .filter((file) => /\.(gif|png|jpe?g|webp|svg)$/i.test(file))
      .map((file) => `/emojis/${file}`);
  } catch {
    return [];
  }
}
function sanitizeHtml(html) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\s(on\w+)=["'][^"']*["']/gi, '');
}
function joinRoom(socket, payload = {}) {
  const nextRoom = normalizeRoom(payload.room);
  const currentRoom = socket.data.roomId;
  const resolvedName = payload.nickname?.trim() || socket.data.displayName;

  if (currentRoom === nextRoom) {
    socket.data.displayName = resolvedName;
    ensureRoom(nextRoom).set(socket.id, resolvedName);
    emitPresence(nextRoom);
    return;
  }
  if (currentRoom) {
    removeFromRoom(currentRoom, socket.id);
    socket.leave(currentRoom);
  }

  socket.data.roomId = nextRoom;
  socket.data.displayName = resolvedName;
  ensureRoom(nextRoom).set(socket.id, resolvedName);
  socket.join(nextRoom);
  emitPresence(nextRoom);
}
function handleMessage(socket, payload) {
  const roomId = socket.data.roomId;
  if (!roomId || !payload.html || !payload.html.trim()) return;
  const sanitized = sanitizeHtml(payload.html);
  const message = {
    id: `${Date.now()}-${socket.id}`,
    sender: socket.data.displayName,
    senderId: socket.id,
    html: sanitized,
    timestamp: new Date().toISOString()
  };
  io.to(roomId).emit('chat message', message);
}
function handleDisconnect(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  removeFromRoom(roomId, socket.id);
  socket.leave(roomId);
}
function ensureRoom(roomId) {
  if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Map());
  return roomMembers.get(roomId);
}
function removeFromRoom(roomId, socketId) {
  const members = roomMembers.get(roomId);
  if (!members) return;
  members.delete(socketId);
  if (!members.size) {
    roomMembers.delete(roomId);
  } else {
    emitPresence(roomId);
  }
}
function emitPresence(roomId) {
  const members = roomMembers.get(roomId);
  if (!members) return;
  io.to(roomId).emit('presence:update', { count: members.size });
}
function normalizeRoom(candidate) {
  const value = typeof candidate === 'string' ? candidate.trim() : '';
  return value || 'public';
}
