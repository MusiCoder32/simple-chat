const socket = io();

const form = document.getElementById('form');
const input = document.getElementById('input');
const messages = document.getElementById('messages');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPanel = document.getElementById('emoji-panel');
const imgBtn = document.getElementById('img-btn');
const imgInput = document.getElementById('img-input');

// 加载表情图片
const emojiList = [
  '1f600.png','1f602.png','1f609.png','1f60d.png','1f622.png','1f62d.png','1f618.png','1f44d.png','1f44e.png','1f60e.png'
];
emojiList.forEach(name => {
  const img = document.createElement('img');
  img.src = `/emojis/${name}`;
  img.style.width = '32px';
  img.style.cursor = 'pointer';
  img.title = name;
  img.onclick = () => {
    input.value += `<img src='/emojis/${name}' style='width:24px;vertical-align:middle;'/>`;
    emojiPanel.style.display = 'none';
    input.focus();
  };
  emojiPanel.appendChild(img);
});

emojiBtn.onclick = function() {
  emojiPanel.style.display = emojiPanel.style.display === 'none' ? 'block' : 'none';
};

document.addEventListener('click', function(e) {
  if (!emojiPanel.contains(e.target) && e.target !== emojiBtn) {
    emojiPanel.style.display = 'none';
  }
});

imgBtn.onclick = function() {
  imgInput.click();
};

imgInput.onchange = function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(evt) {
    socket.emit('chat message', `<img src='${evt.target.result}' style='max-width:150px;max-height:150px;vertical-align:middle;'/>`);
  };
  reader.readAsDataURL(file);
  imgInput.value = '';
};

form.addEventListener('submit', function(e) {
  e.preventDefault();
  if (input.value) {
    socket.emit('chat message', input.value);
    input.value = '';
  }
});

socket.on('chat message', function(msg) {
  const item = document.createElement('li');
  // 判断是否为图片或带表情的富文本
  if (msg.startsWith('<img') || msg.includes('<img')) {
    item.innerHTML = msg;
  } else {
    item.textContent = msg;
  }
  messages.appendChild(item);
  window.scrollTo(0, document.body.scrollHeight);
});
