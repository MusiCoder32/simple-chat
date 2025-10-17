// 与服务端建立 Socket.IO 连接，io() 会立即尝试连接当前页面对应的 socket.io 端点。
const socket = io();
const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('form');
const messageInputEl = document.getElementById('messageInput');
const sendButtonEl = document.getElementById('sendButton');
const onlineCountEl = document.getElementById('onlineCount');
const emojiPickerEl = document.getElementById('emojiPicker');
const roomId = new URLSearchParams(window.location.search).get('room')?.trim() || 'public';
// roomId 根据地址栏参数决定聊天室，默认回退到公共房间。

const scrollContainerEl = document.querySelector('.chat-content');
const SCROLL_STICKY_THRESHOLD = 80; // 当距离底部不足 80px 时，判定为接近底部并自动滚动

const storageKey = 'simpleChatNickname';
let nickname = localStorage.getItem(storageKey);
// 若本地未缓存昵称，则提示用户输入并持久化到 localStorage。
if (!nickname) {
  const inputName = (prompt('请输入昵称') || '').trim();
  nickname = inputName || `访客${Math.floor(Math.random() * 9000 + 1000)}`;
  localStorage.setItem(storageKey, nickname);
}

let selfSocketId = null;
let lastDividerTime = null;

socket.on('connect', () => {
  // 连接成功后记录自身 socketId，并携带昵称与房间信息加入对应聊天室。
  selfSocketId = socket.id;
  socket.emit('join', { nickname, room: roomId });
  messageInputEl.focus();
});

socket.on('presence:update', ({ count = 0 } = {}) => {
  // 接收房间内最新在线人数，刷新标题展示。
  onlineCountEl.textContent = count;
});

socket.on('chat message', (payload = {}) => {
  // 每当房间广播消息到达时，将其渲染到消息列表。
  appendMessage(payload);
});

socket.on('disconnect', () => {
  onlineCountEl.textContent = '0';
});

formEl.addEventListener('submit', (event) => {
  // 拦截默认提交行为，改为走自定义发送逻辑。
  event.preventDefault();
  const html = prepareOutgoingHtml(); // 序列化当前输入为纯净 HTML。
  if (!html) return; // 空消息（无文字且无图片）直接忽略。
  socket.emit('chat message', { html }); // 将消息发送给服务器。
  messageInputEl.innerHTML = ''; // 清空输入区供下一条使用。
  toggleSendButton(); // 立即刷新发送按钮状态。
});

messageInputEl.addEventListener('input', toggleSendButton);

messageInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});

messageInputEl.addEventListener('paste', (event) => {
  // 拦截粘贴，若包含图片则读取为 dataURL 并插入输入框。
  const items = event.clipboardData?.items || [];
  let handled = false;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        readImageFile(file);
        handled = true;
      }
    }
  }
  if (handled) event.preventDefault();
});

messageInputEl.addEventListener('dragover', (event) => {
  event.preventDefault();
});

messageInputEl.addEventListener('drop', (event) => {
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  files.filter((file) => file.type.startsWith('image/')).forEach(readImageFile);
});

loadEmojis();
toggleSendButton();

function prepareOutgoingHtml() {
  const clone = messageInputEl.cloneNode(true); // 复制输入区用于离线清理，避免直接修改 DOM。
  clone.querySelectorAll('script').forEach((node) => node.remove()); // 删除潜在的 script 注入。
  clone.querySelectorAll('*').forEach((node) => {
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (!src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('/')) {
        node.remove(); // 丢弃未知来源的图片链接。
        return;
      }
      node.removeAttribute('style'); // 去掉粘贴带来的内联样式。
      node.classList.add('inline-image'); // 统一图片样式钩子。
    } else {
      while (node.attributes.length) node.removeAttribute(node.attributes[0].name); // 抹掉其他节点的所有属性。
    }
  });
  const text = clone.textContent.replace(/\u200B/g, '').trim(); // 去除零宽字符并计算纯文本。
  const hasImage = clone.querySelector('img'); // 判断是否包含图片节点。
  if (!text && !hasImage) return ''; // 无文字也无图片则不发送。
  return clone.innerHTML.trim(); // 返回净化后的 HTML 片段。
}

function appendMessage({ senderId, sender, html, timestamp }) {
  if (!html) return;
  const shouldStickToBottom = isNearBottom(scrollContainerEl);
  let createdAt = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(createdAt.getTime())) createdAt = new Date();
  maybeInsertTimeDivider(createdAt, shouldStickToBottom);

  const li = document.createElement('li');
  li.className = `message${senderId === selfSocketId ? ' mine' : ''}`;

  if (senderId !== selfSocketId) {
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = sender || '访客';
    li.appendChild(label);
  }

  const bubble = document.createElement('div');
  bubble.className = `message-bubble${senderId === selfSocketId ? ' mine' : ''}`;

  const body = document.createElement('div');
  body.className = 'message-content';
  body.innerHTML = sanitizeIncomingHtml(html);
  bubble.appendChild(body);

  li.appendChild(bubble);
  messagesEl.appendChild(li);
  if (shouldStickToBottom) scrollToBottom(scrollContainerEl);
}

function maybeInsertTimeDivider(date, shouldStickToBottom) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return;
  let inserted = false;
  if (!lastDividerTime || date.getTime() - lastDividerTime.getTime() >= 5 * 60 * 1000) {
    const divider = document.createElement('li');
    divider.className = 'time-divider';
    divider.textContent = formatDividerTime(date); // 生成“xx-xx xx:xx”样式的时间戳。
    messagesEl.appendChild(divider);
    inserted = true;
  }
  if (inserted && shouldStickToBottom) scrollToBottom(scrollContainerEl);
  lastDividerTime = date;
}

function formatDividerTime(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function sanitizeIncomingHtml(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  const allowedTags = new Set(['DIV', 'SPAN', 'BR', 'IMG']); // 白名单允许的标签集合。
  host.querySelectorAll('*').forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes); // 非白名单标签被展开成纯文本节点。
      return;
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (!src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('/')) {
        node.remove(); // 异常来源的图片直接丢弃。
        return;
      }
      node.removeAttribute('style'); // 清理图片上残留的样式属性。
      node.classList.add('message-img'); // 统一渲染样式。
    } else {
      while (node.attributes.length) node.removeAttribute(node.attributes[0].name); // 其他标签去掉所有属性。
    }
  });
  return host.innerHTML; // 返回安全 HTML 文本。
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function formatTime(isoString) {
  const date = isoString ? new Date(isoString) : new Date();
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date);
}

function insertImage(src, alt = '') {
  const img = document.createElement('img');
  img.src = src;
  if (alt) img.alt = alt;
  img.className = 'inline-image';
  insertNodeAtCaret(img);
  insertNodeAtCaret(document.createTextNode(' '));
  toggleSendButton();
}

function insertNodeAtCaret(node) {
  messageInputEl.focus(); // 确保输入框获得焦点，从而存在选区。
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    messageInputEl.appendChild(node); // 没有选区时直接附加到末尾。
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents(); // 清空当前选区内容。
  range.insertNode(node); // 在光标处插入目标节点。
  range.setStartAfter(node);
  range.setEndAfter(node);
  selection.removeAllRanges();
  selection.addRange(range); // 重建选区，使后续输入紧随插入节点。
}

function readImageFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    const result = event.target?.result;
    if (typeof result === 'string') {
      insertImage(result, file.name); // 将读取到的 DataURL 插入富文本输入框。
    }
  };
  reader.readAsDataURL(file); // 以 base64 DataURL 形式读取粘贴/拖入的图片。
}

async function loadEmojis() {
  // 向后端请求最新表情列表，动态渲染表情按钮。
  try {
    const response = await fetch('/api/emojis');
    if (!response.ok) throw new Error(response.statusText);
    const emojis = await response.json();
    emojiPickerEl.innerHTML = '';
    if (!emojis.length) {
      emojiPickerEl.textContent = '暂无表情';
      return;
    }
    emojis.forEach((url) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'emoji-button';
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'emoji';
      button.appendChild(img);
      button.addEventListener('click', () => {
        insertImage(url, 'emoji');
      });
      emojiPickerEl.appendChild(button);
    });
  } catch (error) {
    console.error('加载表情失败', error);
  }
}

function toggleSendButton() {
  const hasImage = messageInputEl.querySelector('img'); // 检查是否包含图片节点。
  const text = messageInputEl.textContent.replace(/\u200B/g, '').trim(); // 获取纯文本内容。
  sendButtonEl.disabled = !hasImage && !text; // 同时为空才禁用提交按钮。
}

const createRoomButton = document.getElementById('createRoomButton');
if (createRoomButton) {
  createRoomButton.addEventListener('click', () => {
    // 创建唯一房间标识并尝试在新窗口打开，同时复制分享链接。
    const token = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; // 生成近乎唯一的房间标识。
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(token)}`; // 拼接完整分享链接。
    const popup = window.open(url, '_blank', 'noopener,noreferrer'); // 尝试在新标签打开独立会话。
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {}); // 默默将链接复制到剪贴板，失败忽略。
    }
    if (!popup || popup.closed) {
      alert(`新聊天已创建，链接已复制，可分享：\n${url}`); // 若浏览器拦截弹窗，提示用户手动访问。
      return;
    }
    popup.opener = null; // 断开新窗口与当前页的关系，提升安全性。
  });
}

function isNearBottom(container) {
  if (!container) return true;
  const { scrollTop, scrollHeight, clientHeight } = container;
  return scrollHeight - (scrollTop + clientHeight) <= SCROLL_STICKY_THRESHOLD;
}
function scrollToBottom(container) {
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}
