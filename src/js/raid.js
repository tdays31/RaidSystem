/*
 * RaidSystem - UI 바인딩
 * - 전역 오염 방지: IIFE
 * - XSS 방지: 모든 출력은 textContent 사용 (innerHTML 금지)
 */
(function () {
  'use strict';

  var root = document.getElementById('raid-system');
  if (!root) return;

  var MAX_MESSAGE_LENGTH = 200;
  var MAX_LOG_ITEMS = 200;
  var MAX_PARTY_SIZE = 5;

  // 행동 목록 (추후 각 항목에 하위 선택지 추가 예정)
  var ACTIONS = [
    { id: 'attack', label: '공격' },
    { id: 'skill', label: '스킬' },
    { id: 'defend', label: '방어' },
    { id: 'heal', label: '회복' }
  ];

  // 예시 데이터 (추후 서버 연동 시 교체)
  var state = {
    player: { name: '플레이어', job: '전사', status: '정상', hp: 820, hpMax: 1000, atk: 145, def: 98, crit: 12 },
    party: [
      { name: '아린', job: '마법사', status: '정상', hp: 540, hpMax: 640 },
      { name: '도윤', job: '성기사', status: '방어 중', hp: 1210, hpMax: 1300 },
      { name: '세라', job: '사제', status: '정상', hp: 600, hpMax: 600 },
      { name: '카이', job: '도적', status: '출혈', hp: 310, hpMax: 720 }
    ]
  };

  function $(key) {
    return root.querySelector('[data-rs="' + key + '"]');
  }

  function setText(key, value) {
    var el = $(key);
    if (el) el.textContent = String(value);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function sanitize(text) {
    return String(text)
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, MAX_MESSAGE_LENGTH);
  }

  function renderProfile(p) {
    setText('profile-name', p.name);
    setText('profile-job', p.job);
    setText('profile-state', p.status);
    setText('profile-hp', p.hp);
    setText('profile-hp-max', p.hpMax);
    setText('profile-atk', p.atk);
    setText('profile-def', p.def);
    setText('profile-crit', p.crit + '%');
  }

  function renderParty(members) {
    var list = $('party-list');
    var shown = members.slice(0, MAX_PARTY_SIZE);
    list.replaceChildren();

    shown.forEach(function (m) {
      var item = el('li', 'rs-party__item');
      var info = el('div');
      info.appendChild(el('div', 'rs-party__name', m.name));
      info.appendChild(el('div', 'rs-party__meta', m.job + ' · ' + m.status));
      item.appendChild(info);
      item.appendChild(el('div', 'rs-party__hp', m.hp + ' / ' + m.hpMax));
      list.appendChild(item);
    });

    setText('party-count', shown.length + '/' + MAX_PARTY_SIZE);
  }

  var chatLog = $('chat-log');
  var chatForm = $('chat-form');
  var chatText = $('chat-text');

  function appendLog(author, message, isSystem) {
    var item = el('li', 'rs-chat-log__item' + (isSystem ? ' rs-chat-log__item--system' : ''));
    if (author) item.appendChild(el('span', 'rs-chat-log__author', author));
    item.appendChild(document.createTextNode(message));
    chatLog.appendChild(item);

    while (chatLog.children.length > MAX_LOG_ITEMS) {
      chatLog.removeChild(chatLog.firstChild);
    }
    chatLog.parentElement.scrollTop = chatLog.parentElement.scrollHeight;
  }

  // ===== 행동 팝업 =====
  var actionToggle = $('action-toggle');
  var actionMenu = $('action-menu');

  function getMenuItems() {
    return Array.prototype.slice.call(actionMenu.querySelectorAll('[role="menuitem"]'));
  }

  function openActionMenu() {
    actionMenu.hidden = false;
    actionToggle.setAttribute('aria-expanded', 'true');
    var items = getMenuItems();
    if (items.length) items[0].focus();
  }

  function closeActionMenu(restoreFocus) {
    if (actionMenu.hidden) return;
    actionMenu.hidden = true;
    actionToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) actionToggle.focus();
  }

  function findAction(id) {
    for (var i = 0; i < ACTIONS.length; i++) {
      if (ACTIONS[i].id === id) return ACTIONS[i];
    }
    return null;
  }

  function onActionSelect(action) {
    // TODO: 행동별 하위 선택 팝업 연결
    appendLog(null, action.label + ' 행동을 선택했습니다.', true);
  }

  function renderActionMenu() {
    actionMenu.replaceChildren();
    ACTIONS.forEach(function (a) {
      var item = el('button', 'rs-action__item', a.label);
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.setAttribute('data-action', a.id);
      actionMenu.appendChild(item);
    });
  }

  actionToggle.addEventListener('click', function () {
    if (actionMenu.hidden) openActionMenu();
    else closeActionMenu(false);
  });

  actionMenu.addEventListener('click', function (e) {
    var target = e.target.closest('[data-action]');
    if (!target) return;
    var action = findAction(target.getAttribute('data-action'));
    if (!action) return;
    closeActionMenu(true);
    onActionSelect(action);
  });

  actionMenu.addEventListener('keydown', function (e) {
    var items = getMenuItems();
    var idx = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      closeActionMenu(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      items[(idx + 1) % items.length].focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length].focus();
    } else if (e.key === 'Tab') {
      closeActionMenu(false);
    }
  });

  // 팝업 바깥 클릭 시 닫기
  document.addEventListener('click', function (e) {
    if (!actionMenu.hidden && !actionMenu.contains(e.target) && !actionToggle.contains(e.target)) {
      closeActionMenu(false);
    }
  });

  // ===== 채팅 =====
  chatForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var message = sanitize(chatText.value);
    if (!message) return;
    appendLog(state.player.name, message, false);
    chatText.value = '';
  });

  renderProfile(state.player);
  renderParty(state.party);
  renderActionMenu();
  appendLog(null, '레이드에 입장했습니다.', true);
})();
