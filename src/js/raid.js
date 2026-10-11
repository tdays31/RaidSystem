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
  var TURN_LIMIT_MS = 10 * 60 * 1000; // 턴 제한 시간 10분
  var EVENT_INTERVAL_MS = 450;        // 턴 결과 이벤트 출력 간격

  // [TEMP] 임시 규칙: 플레이어(나) 한 명만 행동을 완료해도 턴 종료 (추후 삭제)
  // 정식 규칙: 생존자 전원 행동 완료 또는 제한 시간 종료 시 턴 종료
  var TEMP_END_TURN_ON_SELF_DONE = true;

  // 직업군 (고정, 변경 불가)
  // - canHeal: 회복 행동 사용 가능 여부
  // - defendOthers: 방어 대상으로 타인 지정 가능 여부
  var JOBS = {
    healer: { label: '힐러', canHeal: true, defendOthers: false },
    dealer: { label: '딜러', canHeal: false, defendOthers: false },
    tank: { label: '탱커', canHeal: false, defendOthers: true }
  };

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
  // - choice: 이번 턴 선택 { action, skillId?, targetId? } / done: 행동 완료 여부
  var state = {
    turn: 0,
    phase: 'idle', // idle | select | resolving | ended
    endsAt: 0,
    boss: { id: 'boss', name: '레이드 보스', hp: 6000, hpMax: 6000, atk: 140, intent: null },
    player: {
      id: 'self', name: '플레이어', job: 'tank', status: '정상', hp: 820, hpMax: 1000, atk: 145, def: 98, crit: 12,
      done: false, choice: null,
      skills: [
        { id: 'power-strike', name: '강타', power: 1.6 },
        { id: 'war-cry', name: '전투의 함성', power: 1.2 },
        { id: 'whirlwind', name: '회오리 베기', power: 1.4 }
      ]
    },
    party: [
      { id: 'p1', name: '아린', job: 'dealer', status: '정상', hp: 540, hpMax: 640, atk: 165, def: 55, crit: 20, done: false, choice: null,
        skills: [{ id: 'fireball', name: '화염구', power: 1.7 }] },
      { id: 'p2', name: '도윤', job: 'tank', status: '정상', hp: 1210, hpMax: 1300, atk: 95, def: 140, crit: 5, done: false, choice: null,
        skills: [{ id: 'shield-bash', name: '방패 강타', power: 1.3 }] },
      { id: 'p3', name: '세라', job: 'healer', status: '정상', hp: 600, hpMax: 600, atk: 85, def: 70, crit: 8, done: false, choice: null,
        skills: [{ id: 'holy-light', name: '성스러운 빛', power: 1.4 }] },
      { id: 'p4', name: '카이', job: 'dealer', status: '정상', hp: 310, hpMax: 720, atk: 150, def: 50, crit: 25, done: false, choice: null,
        skills: [{ id: 'backstab', name: '기습', power: 1.8 }] }
    ]
  };

  // 보스 패턴: targets = 대상 수 ('all' = 전원)
  var BOSS_PATTERNS = [
    { id: 'tail-swipe', name: '꼬리 휩쓸기', telegraph: '꼬리를 높이 치켜듭니다…', targets: 2, power: 1.0 },
    { id: 'roar', name: '포효', telegraph: '숨을 크게 들이마십니다…', targets: 'all', power: 0.6 },
    { id: 'crush', name: '내려찍기', telegraph: '한 명을 노려봅니다…', targets: 1, power: 1.9 }
  ];

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

  function allMembers() {
    return [state.player].concat(state.party.slice(0, MAX_PARTY_SIZE));
  }

  function findUnit(id) {
    if (id === state.boss.id) return state.boss;
    var list = allMembers();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function unitName(id) {
    var unit = findUnit(id);
    return unit ? unit.name : '?';
  }

  function isAlive(unit) {
    return unit.hp > 0;
  }

  function findSkill(unit, skillId) {
    for (var i = 0; i < unit.skills.length; i++) {
      if (unit.skills[i].id === skillId) return unit.skills[i];
    }
    return null;
  }

  function actionLabel(actionId) {
    for (var i = 0; i < ACTIONS.length; i++) {
      if (ACTIONS[i].id === actionId) return ACTIONS[i].label;
    }
    return actionId;
  }

  // 공개 선택 표시용 짧은 문구 (예: '스킬 · 강타', '방어 → 카이')
  function choiceLabel(unit) {
    var c = unit.choice;
    if (!c) return '';
    if (c.action === 'skill') return '스킬 · ' + (findSkill(unit, c.skillId) || { name: '?' }).name;
    if (c.targetId) return actionLabel(c.action) + ' → ' + (c.targetId === unit.id ? '자신' : unitName(c.targetId));
    return actionLabel(c.action);
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
    setText('profile-choice', p.choice ? '▸ ' + choiceLabel(p) : '');
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
      item.setAttribute('data-job', m.job);

      var info = el('div', 'rs-party__info');
      var name = el('div', 'rs-party__name');
      var marker = el('span', 'rs-done');
      name.appendChild(el('span', null, m.name));
      name.appendChild(marker);
      applyDone(item, marker, m.done);
      info.appendChild(name);

      var meta = el('div', 'rs-party__meta');
      meta.appendChild(el('span', 'rs-party__job', jobLabel(m.job)));
      meta.appendChild(el('span', 'rs-party__status', m.status));
      if (m.choice) meta.appendChild(el('span', 'rs-choice', '▸ ' + choiceLabel(m)));
      info.appendChild(meta);
      item.appendChild(info);

      item.appendChild(el('div', 'rs-party__hp', m.hp + ' / ' + m.hpMax));
      list.appendChild(item);
    });

    setText('party-count', shown.length + '/' + MAX_PARTY_SIZE);
  }

  function renderBoss() {
    var b = state.boss;
    var pct = Math.max(0, Math.round((b.hp / b.hpMax) * 100));
    setText('turn', state.turn || '-');
    setText('boss-name', b.name);
    $('boss-hp-fill').style.width = pct + '%';
    $('boss-hp-bar').setAttribute('aria-valuenow', String(pct));
    setText('boss-hp', b.hp + ' / ' + b.hpMax);
    setText('boss-state', b.intent ? '예고: ' + b.intent.name : (state.phase === 'resolving' ? '행동 중…' : '대기 중'));
  }

  function renderAll() {
    renderBoss();
    renderProfile(state.player);
    renderParty(state.party);
    updateActionToggle();
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

  // variant: null(일반 채팅) | 'system' | 'turn-start' | 'turn-result' | 'result'(행동 결과)
  //          | 'guard'(방어 성공) | 'boss'(보스 행동) | 'intent'(보스 예고)
  // message: 문자열 또는 문자열 배열(배열이면 줄 단위로 출력)
  // (하위 호환: true → 'system')
  function appendLog(author, message, variant) {
    if (variant === true) variant = 'system';
    var item = el('li', 'rs-chat-log__item' + (variant ? ' rs-chat-log__item--' + variant : ''));
    var body = el('span', 'rs-chat-log__body' + (author ? ' rs-chat-log__body--with-author' : ''));
    if (author) body.appendChild(el('span', 'rs-chat-log__author', author));
    if (Array.isArray(message)) {
      var text = el('span', 'rs-chat-log__text');
      message.forEach(function (line) { text.appendChild(el('span', 'rs-chat-log__line', line)); });
      body.appendChild(text);
    } else {
      body.appendChild(el('span', 'rs-chat-log__text', message));
    }
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
    return [self].concat(state.party.slice(0, MAX_PARTY_SIZE).filter(isAlive).map(function (m) {
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

  // 행동 송출 (서버 전송 지점: 현재는 mockServer)
  function submitAction() {
    if (!selection) return;
    var choice = { action: selection.action.id };
    if (selection.detail.skill) choice.skillId = selection.detail.skill.id;
    if (selection.detail.target) choice.targetId = selection.detail.target.id;
    closeActionMenu(true);
    mockServer.submit(state.player.id, choice);
  }

  // 행동 가능 여부: 선택 단계 + 미완료 + 생존
  function updateActionToggle() {
    var p = state.player;
    var enabled = state.phase === 'select' && !p.done && isAlive(p);
    actionToggle.disabled = !enabled;
    if (!enabled) closeActionMenu(false);
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

  // ===== 턴 진행 (서버 메시지 처리) =====
  // 서버 → 클라이언트 메시지 형식: docs/examples/turn-sequence.example.json 참고
  var timerId = null;

  function formatRemain(ms) {
    var sec = Math.max(0, Math.ceil(ms / 1000));
    return pad2(Math.floor(sec / 60)) + ':' + pad2(sec % 60);
  }

  function tickTimer() {
    var remain = state.phase === 'select' ? state.endsAt - Date.now() : 0;
    setText('turn-timer', state.phase === 'select' ? formatRemain(remain) : '--:--');
    $('turn-timer').setAttribute('data-urgent', String(state.phase === 'select' && remain <= 60000));
  }

  function josaName(id, withFinal, withoutFinal) {
    return josa(unitName(id), withFinal, withoutFinal);
  }

  // 이벤트 → 채팅 문구 (서버는 데이터만, 문장은 클라이언트에서 생성)
  function describeEvent(ev) {
    switch (ev.kind) {
      case 'idle':
        return { variant: 'result', text: josaName(ev.actor, '은', '는') + ' 아무것도 하지 않았습니다.' };
      case 'attack':
      case 'skill': {
        var actor = findUnit(ev.actor);
        var what = ev.kind === 'skill' ? (findSkill(actor, ev.skillId) || { name: '스킬' }).name : '공격';
        return {
          variant: 'result',
          text: unitName(ev.actor) + '의 ' + what + '! ' + unitName(ev.target) + '에게 ' + ev.amount + '의 피해' + (ev.crit ? ' (치명타!)' : '') + '.'
        };
      }
      case 'defend':
        return {
          variant: 'result',
          text: ev.target === ev.actor
            ? josaName(ev.actor, '이', '가') + ' 방어 태세를 갖춥니다.'
            : josaName(ev.actor, '이', '가') + ' ' + josaName(ev.target, '을', '를') + ' 보호합니다.'
        };
      case 'heal':
        return {
          variant: 'result',
          text: ev.target === ev.actor
            ? josaName(ev.actor, '이', '가') + ' 자신을 ' + ev.amount + ' 회복했습니다.'
            : josaName(ev.actor, '이', '가') + ' ' + josaName(ev.target, '을', '를') + ' ' + ev.amount + ' 회복시켰습니다.'
        };
      case 'boss_action':
        return { variant: 'boss', text: '⚔ ' + unitName(ev.actor) + '의 ' + ev.name + '!' };
      case 'damage': {
        var lines = [{ variant: 'boss', text: josaName(ev.target, '이', '가') + ' ' + ev.amount + '의 피해를 입었습니다.' }];
        if (ev.blockedBy) {
          lines.push({
            variant: 'guard',
            text: ev.blockedBy === ev.target
              ? josaName(ev.target, '이', '가') + ' 방어로 ' + ev.blocked + '의 피해를 막아냈습니다.'
              : josaName(ev.blockedBy, '이', '가') + ' ' + unitName(ev.target) + '에게 향한 ' + ev.blocked + '의 피해를 막아냈습니다.'
          });
        }
        return lines;
      }
      case 'ko':
        return { variant: 'boss', text: josaName(ev.target, '이', '가') + ' 쓰러졌습니다.' };
      case 'victory':
        return { variant: 'turn-result', text: josaName(ev.target, '을', '를') + ' 쓰러뜨렸습니다! 레이드 승리' };
      case 'defeat':
        return { variant: 'turn-result', text: '파티가 전멸했습니다. 레이드 실패' };
      default:
        return null;
    }
  }

  function onTurnStart(msg) {
    state.turn = msg.turn;
    state.phase = 'select';
    state.endsAt = Date.parse(msg.endsAt);
    state.boss.intent = msg.bossIntent;
    allMembers().forEach(function (m) {
      m.choice = null;
      m.done = !isAlive(m); // 쓰러진 캐릭터는 행동 불가
    });
    renderAll();
    tickTimer();

    appendLog(null, msg.turn + '턴 시작', 'turn-start');
    var intent = msg.bossIntent;
    var targets = intent.all ? '전원' : intent.targets.map(unitName).join(', ');
    appendLog(null, [
      '⚠ ' + josaName(state.boss.id, '이', '가') + ' ' + intent.telegraph,
      '기믹 : ' + intent.name + ' | 대상 : ' + targets
    ], 'intent');
  }

  // 선택 공개 문구 (예: '도윤이 카이를 대상으로 방어를 선택했습니다.')
  function describeChoice(unit) {
    var c = unit.choice;
    var actor = josa(unit.name, '이', '가');
    if (c.action === 'skill') {
      return actor + ' 스킬 ' + josa((findSkill(unit, c.skillId) || { name: '?' }).name, '을', '를') + ' 선택했습니다.';
    }
    if (c.targetId) {
      var target = c.targetId === unit.id ? '자신' : unitName(c.targetId);
      return actor + ' ' + josa(target, '을', '를') + ' 대상으로 ' + josa(actionLabel(c.action), '을', '를') + ' 선택했습니다.';
    }
    return actor + ' ' + josa(actionLabel(c.action), '을', '를') + ' 선택했습니다.';
  }

  // 다른 사람 선택 공개
  function onActionSelected(msg) {
    var unit = findUnit(msg.actor);
    if (!unit || unit === state.boss) return;
    unit.choice = msg.choice;
    unit.done = true;
    renderAll();
    appendLog(null, describeChoice(unit), 'system');
  }

  function applySnapshot(snapshot) {
    state.boss.hp = snapshot.boss.hp;
    snapshot.players.forEach(function (s) {
      var unit = findUnit(s.id);
      if (!unit || unit === state.boss) return;
      unit.hp = s.hp;
      unit.status = s.status;
    });
  }

  function onTurnResult(msg) {
    state.phase = 'resolving';
    state.boss.intent = null;
    renderAll();
    tickTimer();
    appendLog(null, msg.turn + '턴 결과', 'turn-result');

    msg.events.forEach(function (ev, i) {
      setTimeout(function () {
        var lines = describeEvent(ev);
        if (lines) [].concat(lines).forEach(function (line) { appendLog(null, line.text, line.variant); });
        if (i === msg.events.length - 1) {
          applySnapshot(msg.state);
          if (msg.outcome) state.phase = 'ended';
          renderAll();
        }
      }, (i + 1) * EVENT_INTERVAL_MS);
    });
  }

  function receive(msg) {
    if (msg.type === 'turn_start') onTurnStart(msg);
    else if (msg.type === 'action_selected') onActionSelected(msg);
    else if (msg.type === 'action_rejected') appendLog(null, '행동이 거부되었습니다: ' + msg.reason, 'system');
    else if (msg.type === 'turn_result') onTurnResult(msg);
  }

  // ===== [MOCK] 가짜 서버 (서버 연동 시 이 블록 전체 교체) =====
  // 실제 서버 역할: 행동 검증, 파티원 AI(데모), 제한 시간, 결과 계산
  var mockServer = (function () {
    var choices = {};
    var aiTimers = [];
    var deadlineTimer = null;
    var turn = 0;
    var intent = null;

    function rand(min, max) {
      return min + Math.random() * (max - min);
    }

    function pick(list) {
      return list[Math.floor(Math.random() * list.length)];
    }

    function send(msg) {
      // 실제 네트워크처럼 비동기 전달
      setTimeout(function () { receive(msg); }, 0);
    }

    function aliveMembers() {
      return allMembers().filter(isAlive);
    }

    function startTurn() {
      turn += 1;
      choices = {};
      var pattern = pick(BOSS_PATTERNS);
      var alive = aliveMembers().map(function (m) { return m.id; });
      var count = pattern.targets === 'all' ? alive.length : Math.min(pattern.targets, alive.length);
      var picked = alive.slice().sort(function () { return Math.random() - 0.5; }).slice(0, count);
      var targets = alive.filter(function (id) { return picked.indexOf(id) !== -1; }); // 파티 순서 유지
      intent = { pattern: pattern.id, name: pattern.name, telegraph: pattern.telegraph, targets: targets, all: pattern.targets === 'all' };

      send({
        type: 'turn_start',
        turn: turn,
        endsAt: new Date(Date.now() + TURN_LIMIT_MS).toISOString(),
        bossIntent: intent
      });

      deadlineTimer = setTimeout(resolveTurn, TURN_LIMIT_MS);
      scheduleAi();
    }

    // 데모용 파티원 AI: 1.5~6초 사이 75% 확률로 행동
    function scheduleAi() {
      state.party.slice(0, MAX_PARTY_SIZE).filter(isAlive).forEach(function (m) {
        if (Math.random() > 0.75) return;
        aiTimers.push(setTimeout(function () { submit(m.id, aiChoice(m)); }, rand(1500, 6000)));
      });
    }

    function aiChoice(m) {
      var job = JOBS[m.job];
      if (job.canHeal) {
        var hurt = aliveMembers().sort(function (a, b) { return a.hp / a.hpMax - b.hp / b.hpMax; })[0];
        if (hurt.hp / hurt.hpMax < 0.7) return { action: 'heal', targetId: hurt.id };
      }
      if (job.defendOthers && intent.targets.length) {
        return { action: 'defend', targetId: pick(intent.targets) };
      }
      return Math.random() < 0.5 ? { action: 'attack' } : { action: 'skill', skillId: pick(m.skills).id };
    }

    // 행동 검증 (클라이언트 제한과 별개로 서버에서 반드시 재검증)
    function validate(unit, c) {
      if (!unit || !isAlive(unit)) return '행동할 수 없는 상태입니다.';
      if (choices[unit.id]) return '이미 행동을 완료했습니다.';
      var job = JOBS[unit.job];
      if (c.action === 'attack') return null;
      if (c.action === 'skill') return findSkill(unit, c.skillId) ? null : '보유하지 않은 스킬입니다.';
      var target = findUnit(c.targetId);
      if (!target || target === state.boss || !isAlive(target)) return '잘못된 대상입니다.';
      if (c.action === 'defend') return (target === unit || job.defendOthers) ? null : '타인을 방어할 수 없는 직업입니다.';
      if (c.action === 'heal') return job.canHeal ? null : '회복할 수 없는 직업입니다.';
      return '알 수 없는 행동입니다.';
    }

    function submit(actorId, choice) {
      if (!intent) return;
      var unit = findUnit(actorId);
      var error = validate(unit, choice);
      if (error) {
        if (actorId === state.player.id) send({ type: 'action_rejected', reason: error });
        return;
      }
      choices[actorId] = choice;
      send({ type: 'action_selected', actor: actorId, choice: choice });
      checkTurnEnd();
    }

    function checkTurnEnd() {
      if (TEMP_END_TURN_ON_SELF_DONE && choices[state.player.id]) { // [TEMP]
        resolveTurn();
        return;
      }
      var allDone = aliveMembers().every(function (m) { return !!choices[m.id]; });
      if (allDone) resolveTurn();
    }

    // 결과 계산: 플레이어(목록 순서) → 보스
    function resolveTurn() {
      if (!intent) return;
      clearTimeout(deadlineTimer);
      aiTimers.forEach(clearTimeout);
      aiTimers = [];

      var events = [];
      var seq = 0;
      var boss = { hp: state.boss.hp };
      var hp = {};
      var status = {};
      var guards = {}; // targetId → 방어자 id
      allMembers().forEach(function (m) { hp[m.id] = m.hp; status[m.id] = m.status; });

      function push(ev) { seq += 1; ev.seq = seq; events.push(ev); }

      aliveMembers().forEach(function (m) {
        var c = choices[m.id];
        if (!c) { push({ kind: 'idle', actor: m.id }); return; }
        if (boss.hp <= 0) return;
        if (c.action === 'attack' || c.action === 'skill') {
          var power = c.action === 'skill' ? findSkill(m, c.skillId).power : 1;
          var crit = Math.random() * 100 < m.crit;
          var amount = Math.round(m.atk * power * rand(0.9, 1.1) * (crit ? 1.5 : 1));
          boss.hp = Math.max(0, boss.hp - amount);
          var ev = { kind: c.action, actor: m.id, target: state.boss.id, amount: amount, crit: crit };
          if (c.skillId) ev.skillId = c.skillId;
          push(ev);
        } else if (c.action === 'defend') {
          guards[c.targetId] = m.id;
          push({ kind: 'defend', actor: m.id, target: c.targetId });
        } else if (c.action === 'heal') {
          var t = findUnit(c.targetId);
          var heal = Math.min(t.hpMax - hp[t.id], Math.round(m.atk * 1.5 * rand(0.9, 1.1)));
          hp[t.id] += heal;
          push({ kind: 'heal', actor: m.id, target: t.id, amount: heal });
        }
      });

      var outcome = null;
      if (boss.hp <= 0) {
        outcome = 'victory';
        push({ kind: 'victory', target: state.boss.id });
      } else {
        var pattern = BOSS_PATTERNS.filter(function (p) { return p.id === intent.pattern; })[0];
        push({ kind: 'boss_action', actor: state.boss.id, pattern: pattern.id, name: pattern.name, targets: intent.targets });
        intent.targets.forEach(function (id) {
          var t = findUnit(id);
          if (hp[id] <= 0) return;
          var dmg = Math.max(1, Math.round(state.boss.atk * pattern.power * rand(0.9, 1.1) - t.def * 0.3));
          var ev = { kind: 'damage', actor: state.boss.id, target: id, amount: dmg };
          if (guards[id]) {
            ev.amount = Math.round(dmg * 0.5);
            ev.blocked = dmg - ev.amount;
            ev.blockedBy = guards[id];
          }
          hp[id] = Math.max(0, hp[id] - ev.amount);
          push(ev);
          if (hp[id] === 0) {
            status[id] = '쓰러짐';
            push({ kind: 'ko', target: id });
          }
        });
        var anyAlive = allMembers().some(function (m) { return hp[m.id] > 0; });
        if (!anyAlive) {
          outcome = 'defeat';
          push({ kind: 'defeat' });
        }
      }

      send({
        type: 'turn_result',
        turn: turn,
        events: events,
        state: {
          boss: { hp: boss.hp, hpMax: state.boss.hpMax },
          players: allMembers().map(function (m) { return { id: m.id, hp: hp[m.id], status: status[m.id] }; })
        },
        outcome: outcome
      });
      intent = null;

      // 결과 출력이 끝난 뒤 다음 턴 시작
      if (!outcome) setTimeout(startTurn, (events.length + 2) * EVENT_INTERVAL_MS);
    }

    return { start: startTurn, submit: submit };
  })();

  // ===== 채팅 =====
  chatForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var message = sanitize(chatText.value);
    if (!message) return;
    appendLog(state.player.name, message, false);
    chatText.value = '';
  });

  renderAll();
  appendLog(null, '레이드에 입장했습니다.', 'system');
  timerId = setInterval(tickTimer, 1000);
  mockServer.start();
})();
