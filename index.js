// 简易聊天服务器：提供静态资源、动态表情 API，并通过 Socket.IO 按房间转发消息。

const express = require('express');
const app = express();
const http = require('http').createServer(app);
const { Server } = require('socket.io');
const io = new Server(http);
const path = require('path');
const fs = require('fs');

app.use(express.static(path.join(__dirname, 'public')));

const roomMembers = new Map(); // roomId -> Map<socketId, displayName>，维护每个房间的在线成员

app.get('/api/emojis', (req, res) => {
  res.json(listEmojiUrls());
});

io.on('connection', (socket) => {
  // 初始昵称基于 socketId 生成，房间待 join 时确认
  socket.data.displayName = `访客${socket.id.slice(-4)}`;
  socket.data.roomId = null;

  joinRoom(socket); // 默认房间 + 初始化成员表
  socket.on('join', (payload) => {
    // 客户端请求切换房间或更新昵称时进入此流程
    joinRoom(socket, payload);
  });
  socket.on('chat message', (payload = {}) => {
    // 收到消息后交给房间广播逻辑处理
    handleMessage(socket, payload);
  });
  socket.on('disconnect', () => {
    // 连接断开，释放房间占用并刷新在线人数
    handleDisconnect(socket);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`listening on *:${PORT}`);
});

function listEmojiUrls() {
  // 从 public/emojis 目录读取文件并生成可供前端展示的相对路径列表
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
  // 极简净化：移除 script 标签与常见事件属性，降低 XSS 风险
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\s(on\w+)=["'][^"']*["']/gi, '');
}
function joinRoom(socket, payload = {}) {
  const nextRoom = normalizeRoom(payload.room); // 解析目标房间 ID
  const currentRoom = socket.data.roomId;       // 记录当前所在房间
  const resolvedName = payload.nickname?.trim() || socket.data.displayName; // 计算最新昵称

  if (currentRoom === nextRoom) {
    // 已经在目标房间：仅更新昵称并覆盖成员表中的记录
    socket.data.displayName = resolvedName;
    ensureRoom(nextRoom).set(socket.id, resolvedName);
    emitPresence(nextRoom); // 通知房间内其他人在线人数变化
    return;
  }
  if (currentRoom) {
    // 正在离开旧房间：从成员表移除并通过 socket.leave 退出房间
    removeFromRoom(currentRoom, socket.id);
    socket.leave(currentRoom);
  }

  // 更新 socket 上的房间与昵称，并确保房间成员表存在
  socket.data.roomId = nextRoom;
  socket.data.displayName = resolvedName;
  ensureRoom(nextRoom).set(socket.id, resolvedName);
  socket.join(nextRoom);     // 让 Socket.IO 在服务端层面加入房间
  emitPresence(nextRoom);    // 广播当前房间在线人数
}
function handleMessage(socket, payload) {
  const roomId = socket.data.roomId; // 当前 socket 所在房间
  if (!roomId || !payload.html || !payload.html.trim()) return; // 无房间或内容为空时直接丢弃

  const sanitized = sanitizeHtml(payload.html); // 过滤潜在危险 HTML
  const message = {
    id: `${Date.now()}-${socket.id}`,             // 简单的全局唯一消息 ID
    sender: socket.data.displayName,              // 消息展示昵称
    senderId: socket.id,                          // 发送者 socketId，方便前端判断是否本人
    html: sanitized,
    timestamp: new Date().toISOString()           // 统一使用 ISO 字符串
  };
  io.to(roomId).emit('chat message', message);    // 向房间内所有成员广播消息
}
function handleDisconnect(socket) {
  const roomId = socket.data.roomId; // 找到用户离线前所在的房间
  if (!roomId) return;
  removeFromRoom(roomId, socket.id); // 从成员表中删除并在需要时更新在线人数
  socket.leave(roomId);              // 确保 Socket.IO 层面移除房间关联
}
function ensureRoom(roomId) {
  if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Map()); // 首次访问时初始化成员 Map
  return roomMembers.get(roomId);                                   // 始终返回可写的成员表
}
function removeFromRoom(roomId, socketId) {
  const members = roomMembers.get(roomId); // 获取房间成员列表
  if (!members) return;
  members.delete(socketId);               // 移除指定 socket
  if (!members.size) {
    roomMembers.delete(roomId);           // 房间无人时直接清理
  } else {
    emitPresence(roomId);                 // 房间仍有人，需刷新在线人数
  }
}
function emitPresence(roomId) {
  const members = roomMembers.get(roomId); // 获取房间当前成员 Map
  if (!members) return;
  io.to(roomId).emit('presence:update', { count: members.size }); // 仅向该房间广播人数
}
function normalizeRoom(candidate) {
  const value = typeof candidate === 'string' ? candidate.trim() : ''; // 兼容空值或非字符串
  return value || 'public';                                            // 默认回退公共房间
}
