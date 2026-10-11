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

  // 행동 목록
  // - next: 선택 후 다음 단계 (null: 즉시 확정, 'skill': 스킬 선택, 'target': 대상 선택)
  var ACTIONS = [
    { id: 'attack', label: '공격', next: null },
    { id: 'skill', label: '스킬', next: 'skill' },
    { id: 'defend', label: '방어', next: 'target' },
    { id: 'heal', label: '회복', next: 'target' }
  ];

  // 예시 데이터 (추후 서버 연동 시 교체)
  var state = {
    player: {
      id: 'self', name: '플레이어', job: '전사', status: '정상', hp: 820, hpMax: 1000, atk: 145, def: 98, crit: 12,
      skills: [
        { id: 'power-strike', name: '강타' },
        { id: 'war-cry', name: '전투의 함성' },
        { id: 'whirlwind', name: '회오리 베기' }
      ]
    },
    party: [
      { id: 'p1', name: '아린', job: '마법사', status: '정상', hp: 540, hpMax: 640 },
      { id: 'p2', name: '도윤', job: '성기사', status: '방어 중', hp: 1210, hpMax: 1300 },
      { id: 'p3', name: '세라', job: '사제', status: '정상', hp: 600, hpMax: 600 },
      { id: 'p4', name: '카이', job: '도적', status: '출혈', hp: 310, hpMax: 720 }
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
  // 단계: main(행동) → skill(스킬 목록) | target(대상 목록) → 확정
  // 항목은 현재 단계의 menuItems 배열 인덱스로만 처리 (DOM 값 직접 신뢰 안 함)
  var actionToggle = $('action-toggle');
  var actionMenu = $('action-menu');
  var menuItems = [];
  var pendingAction = null;

  function getMenuButtons() {
    return Array.prototype.slice.call(actionMenu.querySelectorAll('[role="menuitem"]'));
  }

  function focusFirstItem() {
    var buttons = getMenuButtons();
    if (buttons.length) buttons[0].focus();
  }

  function buildMainView() {
    return {
      title: null,
      items: ACTIONS.map(function (a) {
        return { label: a.label, select: function () { selectAction(a); } };
      })
    };
  }

  function buildSkillView(action) {
    return {
      title: '스킬 선택',
      items: state.player.skills.slice(0, 3).map(function (skill) {
        return {
          label: skill.name,
          select: function () { confirmAction(action, { skill: skill }); }
        };
      })
    };
  }

  function buildTargetView(action) {
    var targets = [{ id: state.player.id, name: state.player.name, self: true }]
      .concat(state.party.slice(0, MAX_PARTY_SIZE).map(function (m) {
        return { id: m.id, name: m.name, self: false };
      }));
    return {
      title: action.label + ' 대상',
      items: targets.map(function (t) {
        return {
          label: t.self ? t.name + ' (나)' : t.name,
          select: function () { confirmAction(action, { target: t }); }
        };
      })
    };
  }

  function renderMenu(view) {
    menuItems = view.items;
    actionMenu.replaceChildren();

    if (view.title) {
      var head = el('div', 'rs-action__head');
      var back = el('button', 'rs-action__back', '← 뒤로');
      back.type = 'button';
      back.setAttribute('data-menu', 'back');
      head.appendChild(back);
      head.appendChild(el('span', 'rs-action__title', view.title));
      actionMenu.appendChild(head);
    }

    menuItems.forEach(function (item, i) {
      var button = el('button', 'rs-action__item', item.label);
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('data-index', String(i));
      actionMenu.appendChild(button);
    });
  }

  function showMainMenu() {
    pendingAction = null;
    renderMenu(buildMainView());
    focusFirstItem();
  }

  function openActionMenu() {
    actionMenu.hidden = false;
    actionToggle.setAttribute('aria-expanded', 'true');
    showMainMenu();
  }

  function closeActionMenu(restoreFocus) {
    if (actionMenu.hidden) return;
    actionMenu.hidden = true;
    pendingAction = null;
    actionToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) actionToggle.focus();
  }

  function selectAction(action) {
    if (action.next === 'skill') {
      pendingAction = action;
      renderMenu(buildSkillView(action));
      focusFirstItem();
    } else if (action.next === 'target') {
      pendingAction = action;
      renderMenu(buildTargetView(action));
      focusFirstItem();
    } else {
      confirmAction(action, {});
    }
  }

  // 한글 조사 선택: 마지막 글자 받침 유무로 결정 (예: josa('공격', '을', '를'))
  function josa(word, withFinal, withoutFinal) {
    var code = String(word).charCodeAt(String(word).length - 1) - 0xac00;
    var hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
    return word + (hasFinal ? withFinal : withoutFinal);
  }

  // 행동 확정 (추후 서버 전송 지점)
  function confirmAction(action, detail) {
    closeActionMenu(true);
    var actor = josa(state.player.name, '이', '가');
    var message;

    if (detail.skill) {
      message = actor + ' 스킬 ' + josa(detail.skill.name, '을', '를') + ' 선택했습니다.';
    } else if (detail.target) {
      var targetName = detail.target.self ? '자신' : detail.target.name;
      message = actor + ' ' + josa(targetName, '을', '를') + ' 대상으로 ' + josa(action.label, '을', '를') + ' 선택했습니다.';
    } else {
      message = actor + ' ' + josa(action.label, '을', '를') + ' 선택했습니다.';
    }
    appendLog(null, message, true);
  }

  actionToggle.addEventListener('click', function () {
    if (actionMenu.hidden) openActionMenu();
    else closeActionMenu(false);
  });

  actionMenu.addEventListener('click', function (e) {
    if (e.target.closest('[data-menu="back"]')) {
      showMainMenu();
      return;
    }
    var button = e.target.closest('[data-index]');
    if (!button) return;
    var item = menuItems[Number(button.getAttribute('data-index'))];
    if (item) item.select();
  });

  actionMenu.addEventListener('keydown', function (e) {
    var buttons = getMenuButtons();
    var idx = buttons.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      if (pendingAction) showMainMenu();
      else closeActionMenu(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(idx + 1) % buttons.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(idx - 1 + buttons.length) % buttons.length].focus();
    } else if (e.key === 'Tab') {
      closeActionMenu(false);
    }
  });

  // 팝업 바깥 클릭 시 닫기 (메뉴 재렌더로 분리된 노드는 무시)
  document.addEventListener('click', function (e) {
    if (actionMenu.hidden || !e.target.isConnected) return;
    if (!actionMenu.contains(e.target) && !actionToggle.contains(e.target)) {
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
  appendLog(null, '레이드에 입장했습니다.', true);
})();
