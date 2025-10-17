const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const path = require('path');
const fs = require('fs');

app.use(express.static(path.join(__dirname, 'public')));

const onlineUsers = new Map();

app.get('/api/emojis', (req, res) => {
  res.json(listEmojiUrls());
});

io.on('connection', (socket) => {
  let displayName = `访客${socket.id.slice(-4)}`;
  onlineUsers.set(socket.id, displayName);
  io.emit('presence:update', { count: onlineUsers.size });
  socket.on('join', (nickname) => {
    const nextName = nickname?.trim();
    if (nextName) {
      displayName = nextName;
      onlineUsers.set(socket.id, displayName);
    }
    socket.emit('presence:update', { count: onlineUsers.size });
  });
  socket.on('chat message', (payload = {}) => {
    if (!payload.html || !payload.html.trim()) return;
    const sanitized = sanitizeHtml(payload.html);
    const message = {
      id: `${Date.now()}-${socket.id}`,
      sender: displayName,
      senderId: socket.id,
      html: sanitized,
      timestamp: new Date().toISOString()
    };
    io.emit('chat message', message);
  });
  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('presence:update', { count: onlineUsers.size });
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
