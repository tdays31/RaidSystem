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

  // 직업군 (고정, 변경 불가)
  // - canHeal: 회복 행동 사용 가능 여부
  // - defendOthers: 방어 대상으로 타인 지정 가능 여부
  var JOBS = {
    healer: { label: '힐러', canHeal: true, defendOthers: false },
    dealer: { label: '딜러', canHeal: false, defendOthers: false },
    tank: { label: '탱커', canHeal: false, defendOthers: true }
  };
  var JOB_ORDER = ['healer', 'dealer', 'tank'];

  // 행동 목록
  // - next: 선택 후 다음 단계 (null: 즉시 확정, 'skill': 스킬 선택, 'target': 대상 선택)
  // - 직업별 노출/대상 제한은 isActionAvailable(), getTargets() 참고
  var ACTIONS = [
    { id: 'attack', label: '공격', next: null },
    { id: 'skill', label: '스킬', next: 'skill' },
    { id: 'defend', label: '방어', next: 'target' },
    { id: 'heal', label: '회복', next: 'target' }
  ];

  // 예시 데이터 (추후 서버 연동 시 교체)
  var state = {
    player: {
      id: 'self', name: '플레이어', job: 'tank', status: '정상', hp: 820, hpMax: 1000, atk: 145, def: 98, crit: 12, done: false,
      skills: [
        { id: 'power-strike', name: '강타' },
        { id: 'war-cry', name: '전투의 함성' },
        { id: 'whirlwind', name: '회오리 베기' }
      ]
    },
    party: [
      { id: 'p1', name: '아린', job: 'dealer', status: '정상', hp: 540, hpMax: 640, done: true },
      { id: 'p2', name: '도윤', job: 'tank', status: '방어 중', hp: 1210, hpMax: 1300, done: false },
      { id: 'p3', name: '세라', job: 'healer', status: '정상', hp: 600, hpMax: 600, done: true },
      { id: 'p4', name: '카이', job: 'dealer', status: '출혈', hp: 310, hpMax: 720, done: false }
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

  function jobLabel(jobId) {
    return JOBS[jobId] ? JOBS[jobId].label : '-';
  }

  function playerJob() {
    return JOBS[state.player.job] || JOBS.dealer;
  }

  // 행동완료 표시: 컨테이너 data-done + 표시 요소(스크린리더용 라벨)
  function applyDone(container, marker, done) {
    container.setAttribute('data-done', String(!!done));
    marker.setAttribute('role', 'img');
    marker.setAttribute('aria-label', done ? '행동 완료' : '행동 대기');
    marker.title = done ? '행동 완료' : '행동 대기';
  }

  function renderProfile(p) {
    setText('profile-name', p.name);
    applyDone($('profile'), $('profile-done'), p.done);
    setText('profile-job', jobLabel(p.job));
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
      var name = el('div', 'rs-party__name');
      var marker = el('span', 'rs-done');
      name.appendChild(el('span', null, m.name));
      name.appendChild(marker);
      applyDone(item, marker, m.done);
      info.appendChild(name);
      info.appendChild(el('div', 'rs-party__meta', jobLabel(m.job) + ' · ' + m.status));
      item.appendChild(info);
      item.appendChild(el('div', 'rs-party__hp', m.hp + ' / ' + m.hpMax));
      list.appendChild(item);
    });

    setText('party-count', shown.length + '/' + MAX_PARTY_SIZE);
  }

  var chatLog = $('chat-log');
  var chatForm = $('chat-form');
  var chatText = $('chat-text');

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  // 채팅 시간 요소 (표시: HH:MM, datetime: ISO)
  function createTimeStamp(date) {
    var time = el('time', 'rs-chat-log__time', pad2(date.getHours()) + ':' + pad2(date.getMinutes()));
    time.setAttribute('datetime', date.toISOString());
    return time;
  }

  function appendLog(author, message, isSystem) {
    var item = el('li', 'rs-chat-log__item' + (isSystem ? ' rs-chat-log__item--system' : ''));
    var body = el('span', 'rs-chat-log__body' + (author ? ' rs-chat-log__body--with-author' : ''));
    if (author) body.appendChild(el('span', 'rs-chat-log__author', author));
    body.appendChild(el('span', 'rs-chat-log__text', message));
    item.appendChild(createTimeStamp(new Date()));
    item.appendChild(body);
    chatLog.appendChild(item);

    while (chatLog.children.length > MAX_LOG_ITEMS) {
      chatLog.removeChild(chatLog.firstChild);
    }
    chatLog.parentElement.scrollTop = chatLog.parentElement.scrollHeight;
  }

  // ===== 행동 팝업 =====
  // 흐름: 행동/스킬/대상 선택(선택만 표시) → [확인] 클릭 시 송출
  // 항목은 현재 단계의 menuItems 배열 인덱스로만 처리 (DOM 값 직접 신뢰 안 함)
  var actionToggle = $('action-toggle');
  var actionMenu = $('action-menu');
  var menuItems = [];
  var currentView = null;
  var selection = null; // { key, action, detail }

  // 한글 조사 선택: 마지막 글자 받침 유무로 결정 (예: josa('공격', '을', '를'))
  function josa(word, withFinal, withoutFinal) {
    var code = String(word).charCodeAt(String(word).length - 1) - 0xac00;
    var hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
    return word + (hasFinal ? withFinal : withoutFinal);
  }

  function getMenuButtons() {
    return Array.prototype.slice.call(
      actionMenu.querySelectorAll('[role="menuitemradio"], [data-menu="confirm"]:not(:disabled)')
    );
  }

  // 직업별 행동 노출: 회복은 힐러만
  function isActionAvailable(action) {
    if (action.id === 'heal') return playerJob().canHeal;
    return true;
  }

  // 행동별 대상 목록: 방어는 탱커만 타인 지정 가능
  function getTargets(action) {
    var self = { id: state.player.id, name: state.player.name, self: true };
    if (action.id === 'defend' && !playerJob().defendOthers) return [self];
    return [self].concat(state.party.slice(0, MAX_PARTY_SIZE).map(function (m) {
      return { id: m.id, name: m.name, self: false };
    }));
  }

  function buildMainView() {
    return {
      title: null,
      items: ACTIONS.filter(isActionAvailable).map(function (a) {
        var targets = a.next === 'target' ? getTargets(a) : null;
        // 대상이 자신뿐이면 대상 단계 없이 바로 선택
        var singleTarget = targets && targets.length === 1 ? targets[0] : null;
        var key = singleTarget ? a.id + ':' + singleTarget.id : 'action:' + a.id;
        return {
          key: key,
          label: a.label,
          hasNext: a.next !== null && !singleTarget,
          select: function () {
            if (singleTarget) setSelection(key, a, { target: singleTarget });
            else if (a.next === 'skill') showView(buildSkillView(a));
            else if (a.next === 'target') showView(buildTargetView(a));
            else setSelection(key, a, {});
          }
        };
      })
    };
  }

  function buildSkillView(action) {
    return {
      title: '스킬 선택',
      items: state.player.skills.slice(0, 3).map(function (skill) {
        var key = 'skill:' + skill.id;
        return {
          key: key,
          label: skill.name,
          select: function () { setSelection(key, action, { skill: skill }); }
        };
      })
    };
  }

  function buildTargetView(action) {
    return {
      title: action.label + ' 대상',
      items: getTargets(action).map(function (t) {
        var key = action.id + ':' + t.id;
        return {
          key: key,
          label: t.self ? t.name + ' (나)' : t.name,
          select: function () { setSelection(key, action, { target: t }); }
        };
      })
    };
  }

  function describeSelection(sel) {
    var actor = josa(state.player.name, '이', '가');
    if (sel.detail.skill) {
      return actor + ' 스킬 ' + josa(sel.detail.skill.name, '을', '를') + ' 선택했습니다.';
    }
    if (sel.detail.target) {
      var targetName = sel.detail.target.self ? '자신' : sel.detail.target.name;
      return actor + ' ' + josa(targetName, '을', '를') + ' 대상으로 ' + josa(sel.action.label, '을', '를') + ' 선택했습니다.';
    }
    return actor + ' ' + josa(sel.action.label, '을', '를') + ' 선택했습니다.';
  }

  function summarizeSelection(sel) {
    if (!sel) return '행동을 선택하세요';
    if (sel.detail.skill) return '스킬 · ' + sel.detail.skill.name;
    if (sel.detail.target) {
      return sel.action.label + ' · ' + (sel.detail.target.self ? '자신' : sel.detail.target.name);
    }
    return sel.action.label;
  }

  function renderMenu() {
    menuItems = currentView.items;
    actionMenu.replaceChildren();

    if (currentView.title) {
      var head = el('div', 'rs-action__head');
      var back = el('button', 'rs-action__back', '← 뒤로');
      back.type = 'button';
      back.setAttribute('data-menu', 'back');
      head.appendChild(back);
      head.appendChild(el('span', 'rs-action__title', currentView.title));
      actionMenu.appendChild(head);
    }

    menuItems.forEach(function (item, i) {
      var button = el('button', 'rs-action__item', item.label);
      button.type = 'button';
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', String(!!selection && selection.key === item.key));
      button.setAttribute('data-index', String(i));
      if (item.hasNext) button.setAttribute('aria-haspopup', 'true');
      actionMenu.appendChild(button);
    });

    var foot = el('div', 'rs-action__foot');
    foot.appendChild(el('div', 'rs-action__summary', summarizeSelection(selection)));
    var confirm = el('button', 'rs-btn rs-action__confirm', '확인');
    confirm.type = 'button';
    confirm.setAttribute('data-menu', 'confirm');
    confirm.disabled = !selection;
    foot.appendChild(confirm);
    actionMenu.appendChild(foot);
  }

  function showView(view) {
    currentView = view;
    renderMenu();
    var buttons = getMenuButtons();
    if (buttons.length) buttons[0].focus();
  }

  function setSelection(key, action, detail) {
    selection = { key: key, action: action, detail: detail };
    renderMenu();
    var confirm = actionMenu.querySelector('[data-menu="confirm"]');
    if (confirm) confirm.focus();
  }

  function openActionMenu() {
    selection = null;
    actionMenu.hidden = false;
    actionToggle.setAttribute('aria-expanded', 'true');
    showView(buildMainView());
  }

  function closeActionMenu(restoreFocus) {
    if (actionMenu.hidden) return;
    actionMenu.hidden = true;
    selection = null;
    currentView = null;
    actionToggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) actionToggle.focus();
  }

  // 행동 송출 (추후 서버 전송 지점)
  function submitAction() {
    if (!selection) return;
    var message = describeSelection(selection);
    closeActionMenu(true);
    appendLog(null, message, true);
    state.player.done = true;
    renderProfile(state.player);
  }

  actionToggle.addEventListener('click', function () {
    if (actionMenu.hidden) openActionMenu();
    else closeActionMenu(false);
  });

  actionMenu.addEventListener('click', function (e) {
    if (e.target.closest('[data-menu="back"]')) {
      showView(buildMainView());
      return;
    }
    if (e.target.closest('[data-menu="confirm"]')) {
      submitAction();
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
      if (currentView && currentView.title) showView(buildMainView());
      else closeActionMenu(true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(idx + 1) % buttons.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(idx - 1 + buttons.length) % buttons.length].focus();
    }
  });

  // 팝업 바깥 클릭 시 닫기 (메뉴 재렌더로 분리된 노드는 무시)
  document.addEventListener('click', function (e) {
    if (actionMenu.hidden || !e.target.isConnected) return;
    if (!actionMenu.contains(e.target) && !actionToggle.contains(e.target)) {
      closeActionMenu(false);
    }
  });

  // 포커스가 팝업/행동 버튼 밖으로 나가면 닫기
  actionMenu.addEventListener('focusout', function (e) {
    var next = e.relatedTarget;
    if (next && !actionMenu.contains(next) && next !== actionToggle) closeActionMenu(false);
  });

  // ===== [TEST-ONLY] 직업 변경 (테스트용 임시 기능, 추후 삭제) =====
  // 실제 게임에서 직업은 고정이며 변경 불가. 이 블록과 index.html의 .rs-dev 블록을 함께 삭제할 것.
  var devJobSelect = $('dev-job-select');

  JOB_ORDER.forEach(function (id) {
    var option = el('option', null, JOBS[id].label);
    option.value = id;
    devJobSelect.appendChild(option);
  });
  devJobSelect.value = state.player.job;

  devJobSelect.addEventListener('change', function () {
    var id = devJobSelect.value;
    if (!Object.prototype.hasOwnProperty.call(JOBS, id)) return;
    state.player.job = id;
    closeActionMenu(false);
    renderProfile(state.player);
    appendLog(null, '[TEST] 직업이 ' + josa(JOBS[id].label, '으로', '로') + ' 변경되었습니다.', true);
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
