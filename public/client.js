const socket = io();
const messagesEl = document.getElementById('messages');
const formEl = document.getElementById('form');
const messageInputEl = document.getElementById('messageInput');
const sendButtonEl = document.getElementById('sendButton');
const onlineCountEl = document.getElementById('onlineCount');
const emojiPickerEl = document.getElementById('emojiPicker');

let selfSocketId = null;
const storageKey = 'simpleChatNickname';
let nickname = localStorage.getItem(storageKey);
if (!nickname) {
  const inputName = (prompt('请输入昵称') || '').trim();
  nickname = inputName || `访客${Math.floor(Math.random() * 9000 + 1000)}`;
  localStorage.setItem(storageKey, nickname);
}
let lastDividerTime = null;

socket.on('connect', () => {
  selfSocketId = socket.id;
  socket.emit('join', nickname);
  messageInputEl.focus();
});

socket.on('presence:update', ({ count = 0 } = {}) => {
  onlineCountEl.textContent = count;
});

socket.on('chat message', (payload = {}) => {
  appendMessage(payload);
});

socket.on('disconnect', () => {
  onlineCountEl.textContent = '0';
});

formEl.addEventListener('submit', (event) => {
  event.preventDefault();
  const html = prepareOutgoingHtml();
  if (!html) return;
  socket.emit('chat message', { html });
  messageInputEl.innerHTML = '';
  toggleSendButton();
});

messageInputEl.addEventListener('input', toggleSendButton);

messageInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});

messageInputEl.addEventListener('paste', (event) => {
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
  const clone = messageInputEl.cloneNode(true);
  clone.querySelectorAll('script').forEach((node) => node.remove());
  clone.querySelectorAll('*').forEach((node) => {
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (!src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('/')) {
        node.remove();
        return;
      }
      node.removeAttribute('style');
      node.classList.add('inline-image');
    } else {
      while (node.attributes.length) node.removeAttribute(node.attributes[0].name);
    }
  });
  const text = clone.textContent.replace(/\u200B/g, '').trim();
  const hasImage = clone.querySelector('img');
  if (!text && !hasImage) return '';
  return clone.innerHTML.trim();
}

function appendMessage({ senderId, sender, html, timestamp }) {
  if (!html) return;
  let createdAt = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(createdAt.getTime())) createdAt = new Date();
  maybeInsertTimeDivider(createdAt);

  const li = document.createElement('li');
  li.className = `message${senderId === selfSocketId ? ' mine' : ''}`;

  if (senderId !== selfSocketId) {
    const header = document.createElement('div');
    header.className = 'message-header';
    header.textContent = sender || '访客';
    li.appendChild(header);
  }

  const body = document.createElement('div');
  body.className = 'message-content';
  body.innerHTML = sanitizeIncomingHtml(html);
  li.appendChild(body);

  messagesEl.appendChild(li);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function maybeInsertTimeDivider(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return;
  if (!lastDividerTime || date.getTime() - lastDividerTime.getTime() >= 5 * 60 * 1000) {
    const divider = document.createElement('li');
    divider.className = 'time-divider';
    divider.textContent = formatDividerTime(date);
    messagesEl.appendChild(divider);
  }
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
  const allowedTags = new Set(['DIV', 'SPAN', 'BR', 'IMG']);
  host.querySelectorAll('*').forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src') || '';
      if (!src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('/')) {
        node.remove();
        return;
      }
      node.removeAttribute('style');
      node.classList.add('message-img');
    } else {
      while (node.attributes.length) node.removeAttribute(node.attributes[0].name);
    }
  });
  return host.innerHTML;
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
  messageInputEl.focus();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    messageInputEl.appendChild(node);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.setEndAfter(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

function readImageFile(file) {
  const reader = new FileReader();
  reader.onload = (event) => {
    const result = event.target?.result;
    if (typeof result === 'string') {
      insertImage(result, file.name);
    }
  };
  reader.readAsDataURL(file);
}

async function loadEmojis() {
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
  const hasImage = messageInputEl.querySelector('img');
  const text = messageInputEl.textContent.replace(/\u200B/g, '').trim();
  sendButtonEl.disabled = !hasImage && !text;
}

const createRoomButton = document.getElementById('createRoomButton');
if (createRoomButton) {
  createRoomButton.addEventListener('click', () => {
    const token = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(token)}`;
    const popup = window.open(url, '_blank', 'noopener,noreferrer');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(() => {});
    }
    if (!popup || popup.closed) {
      alert(`新聊天已创建，链接已复制，可分享：\n${url}`);
      return;
    }
    popup.opener = null;
  });
}
