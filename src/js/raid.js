/*
 * RaidSystem - 레이아웃 바인딩 (1단계)
 * - 전역 오염 방지: IIFE
 * - XSS 방지: 모든 출력은 textContent 사용 (innerHTML 금지)
 */
(function () {
  'use strict';

  var root = document.getElementById('raid-system');
  if (!root) return;

  var MAX_MESSAGE_LENGTH = 200;
  var MAX_LOG_ITEMS = 200;

  function $(key) {
    return root.querySelector('[data-rs="' + key + '"]');
  }

  var chatLog = $('chat-log');
  var chatForm = $('chat-form');
  var chatText = $('chat-text');

  function sanitize(text) {
    return String(text)
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, MAX_MESSAGE_LENGTH);
  }

  function appendLog(author, message, isSystem) {
    var item = document.createElement('li');
    item.className = 'rs-chat-log__item' + (isSystem ? ' rs-chat-log__item--system' : '');

    if (author) {
      var name = document.createElement('span');
      name.className = 'rs-chat-log__author';
      name.textContent = author;
      item.appendChild(name);
    }
    item.appendChild(document.createTextNode(message));
    chatLog.appendChild(item);

    while (chatLog.children.length > MAX_LOG_ITEMS) {
      chatLog.removeChild(chatLog.firstChild);
    }
    chatLog.parentElement.scrollTop = chatLog.parentElement.scrollHeight;
  }

  chatForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var message = sanitize(chatText.value);
    if (!message) return;
    appendLog($('profile-name').textContent, message, false);
    chatText.value = '';
  });

  appendLog(null, '레이드에 입장했습니다.', true);
})();
