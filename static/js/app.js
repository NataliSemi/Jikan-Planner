/* ================================================================
   時間 JIKAN PLANNER — Frontend App Logic
   ================================================================ */

const API = '';  // same-origin

// ── State ──────────────────────────────────────────────────────
const mood = { energy: null, focus: null, mood: null };
let pendingTaskProposal = null;
const taskCache = new Map();
let activeEditTaskId = null;
const reminderState = {
  interval: null,
  notified: new Set(),
  storageKey: 'jikan-reminder-history',
};

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setTodayDate();
  loadTodayTasks();
  prefillDate();
  loadTodayMood();
  hydrateReminderHistory();
  requestNotificationPermission();
  startReminderLoop();
});

function setTodayDate() {
  const el = document.getElementById('today-date');
  if (!el) return;
  const now = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  el.textContent = now.toLocaleDateString('en-GB', opts);
}

function prefillDate() {
  const d = document.getElementById('task-date');
  if (d) d.value = todayISO();
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

// ── Panel Routing ───────────────────────────────────────────────
function showPanel(name, btn) {
  document.querySelectorAll('.panel').forEach(p => {
    p.classList.remove('panel--active');
    p.style.display = '';
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const panel = document.getElementById(`panel-${name}`);
  if (panel) { panel.style.display = 'flex'; panel.classList.add('panel--active'); }
  if (btn) btn.classList.add('active');

  // Lazy load data on panel switch
  if (name === 'tasks') loadAllTasks();
  if (name === 'stats') loadStats();
}

// ── TODAY TASKS ─────────────────────────────────────────────────
async function loadTodayTasks() {
  const container = document.getElementById('today-timeline');
  container.innerHTML = '<div class="loading-scroll">読み込み中...</div>';
  try {
    const res = await fetch(`${API}/api/tasks/today`);
    const tasks = await res.json();
    renderTimeline(tasks, container);
  } catch (e) {
    container.innerHTML = '<div class="loading-scroll">エラーが発生しました</div>';
  }
}

function renderTimeline(tasks, container) {
  if (!tasks.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__kanji">無</div>
        <p>No tasks for today — a blank canvas awaits</p>
        <p style="margin-top:8px;font-family:'Noto Sans JP';font-size:12px;color:var(--ink-faint)">今日の予定はありません</p>
      </div>`;
    return;
  }

  // Sort by scheduled time
  tasks.sort((a, b) => (a.scheduled_time || '99:99').localeCompare(b.scheduled_time || '99:99'));
  tasks.forEach(t => taskCache.set(t.id, t));

  container.innerHTML = tasks.map(t => `
    <div class="timeline-item ${t.completed ? 'completed' : ''}" data-type="${t.activity_type}">
      <div class="tl-time">${t.scheduled_time || '—'}</div>
      <div class="tl-body">
        <div class="tl-title">${escHtml(t.title)}</div>
        <div class="tl-meta">
          <span class="tl-badge badge-${t.activity_type}">${typeLabel(t.activity_type)}</span>
          <span>${t.duration_minutes} min</span>
          ${t.recurrence?.weekdays?.length ? `<span>· ↻ ${t.recurrence.weekdays.join(', ')}</span>` : ''}
          ${t.notes ? `<span>· ${escHtml(t.notes)}</span>` : ''}
        </div>
        ${renderChecklist(t)}
      </div>
      <div class="tl-actions">
        ${!t.completed ? `<button class="tl-btn tl-btn--done" onclick="markDone('${t.id}', '${t.instance_date || ''}')">完了</button>` : '<span style="font-size:11px;color:var(--col-reading)">✓ Done</span>'}
        <button class="tl-btn" onclick="openEditTask('${t.id}')">編集</button>
        <button class="tl-btn tl-btn--del" onclick="deleteTask('${t.id}', true)">削除</button>
      </div>
    </div>
  `).join('');
}

// ── ALL TASKS ───────────────────────────────────────────────────
async function loadAllTasks() {
  const container = document.getElementById('all-tasks-list');
  container.innerHTML = '<div class="loading-scroll">読み込み中...</div>';

  const dateVal = document.getElementById('filter-date')?.value || '';
  const typeVal = document.getElementById('filter-type')?.value || '';

  let url = `${API}/api/tasks/`;
  if (dateVal) url += `?date=${dateVal}`;

  try {
    const res = await fetch(url);
    let tasks = await res.json();
    if (typeVal) tasks = tasks.filter(t => t.activity_type === typeVal);
    renderAllTasks(tasks, container);
  } catch (e) {
    container.innerHTML = '<div class="loading-scroll">エラーが発生しました</div>';
  }
}

function renderAllTasks(tasks, container) {
  if (!tasks.length) {
    container.innerHTML = '<div class="loading-scroll">タスクが見つかりません</div>';
    return;
  }

  tasks.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  tasks.forEach(t => taskCache.set(t.id, t));

  container.innerHTML = `<div class="task-list">${tasks.map(t => `
    <div class="task-row ${t.completed ? 'completed' : ''}" data-type="${t.activity_type}">
      <div>
        <div class="task-row__title">${escHtml(t.title)}</div>
        <div style="display:flex;gap:10px;margin-top:4px;">
          <span class="tl-badge badge-${t.activity_type}">${typeLabel(t.activity_type)}</span>
          <span class="task-row__date">${t.scheduled_date || ''} ${t.scheduled_time || ''} · ${t.duration_minutes}min</span>
          ${t.recurrence?.weekdays?.length ? `<span class="task-row__date">↻ ${t.recurrence.weekdays.join(', ')}</span>` : ''}
        </div>
        ${renderChecklist(t)}
      </div>
      <span style="font-size:12px;color:var(--ink-faint);font-family:'Noto Sans JP'">${t.completed ? '✓ 完了' : '未完'}</span>
      ${!t.completed ? `<button class="tl-btn tl-btn--done" onclick="markDone('${t.id}', '${t.instance_date || ''}')">完了</button>` : '<span></span>'}
      <button class="tl-btn" onclick="openEditTask('${t.id}')">編集</button>
      <button class="tl-btn tl-btn--del" onclick="deleteTask('${t.id}', false)">削除</button>
    </div>
  `).join('')}</div>`;
}

// ── CREATE TASK ─────────────────────────────────────────────────
async function createTask() {
  const title    = document.getElementById('task-title').value.trim();
  const type     = document.getElementById('task-type').value;
  const duration = parseInt(document.getElementById('task-duration').value);
  const date     = document.getElementById('task-date').value;
  const time     = document.getElementById('task-time').value;
  const notes    = document.getElementById('task-notes').value.trim();
  const checklistRaw = document.getElementById('task-checklist').value.trim();
  const recurrenceDays = [...document.querySelectorAll('.recurring-day:checked')].map(el => el.value);
  const fb       = document.getElementById('add-feedback');

  if (!title) { setFeedback(fb, 'タイトルを入力してください', 'err'); return; }

  const payload = { title, activity_type: type, duration_minutes: duration };
  if (date) payload.scheduled_date = date;
  if (time) payload.scheduled_time = time;
  if (notes) payload.notes = notes;
  if (checklistRaw) {
    payload.checklist = checklistRaw.split('\n').map(i => i.trim()).filter(Boolean).map(text => ({ text, completed: false }));
  }
  if (recurrenceDays.length) {
    payload.recurrence = { frequency: 'weekly', weekdays: recurrenceDays };
  }

  try {
    const res = await fetch(`${API}/api/tasks/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      setFeedback(fb, '✓ 登録しました · Task added', 'ok');
      zenSound('task_created');
      document.getElementById('task-title').value = '';
      document.getElementById('task-notes').value = '';
      document.getElementById('task-checklist').value = '';
      document.getElementById('task-time').value = '';
      document.querySelectorAll('.recurring-day').forEach(el => { el.checked = false; });
    } else {
      setFeedback(fb, 'エラーが発生しました', 'err');
    }
  } catch (e) {
    setFeedback(fb, 'ネットワークエラー', 'err');
  }
}

// ── MARK DONE / DELETE ──────────────────────────────────────────
async function markDone(id, instanceDate = '') {
  const payload = { completed: true };
  if (instanceDate) payload.instance_date = instanceDate;
  await fetch(`${API}/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  zenSound('task_done'); // 完了の鈴 — soft descending chime
  loadTodayTasks();
}

async function deleteTask(id, isToday) {
  if (!confirm('このタスクを削除しますか？')) return;
  await fetch(`${API}/api/tasks/${id}`, { method: 'DELETE' });
  if (isToday) loadTodayTasks(); else loadAllTasks();
}

function openEditTask(id) {
  const task = taskCache.get(id);
  if (!task) return alert('Task details not loaded yet. Please refresh and try again.');
  activeEditTaskId = id;
  const modal = document.getElementById('edit-task-modal');
  if (!modal) return;

  document.getElementById('edit-task-title').value = task.title || '';
  document.getElementById('edit-task-type').value = task.activity_type || 'learning';
  document.getElementById('edit-task-duration').value = task.duration_minutes || 30;
  document.getElementById('edit-task-date').value = task.scheduled_date || '';
  document.getElementById('edit-task-time').value = task.scheduled_time || '';
  document.getElementById('edit-task-notes').value = task.notes || '';
  document.getElementById('edit-task-checklist').value = checklistToLines(task.checklist || []);
  document.querySelectorAll('.edit-recurring-day').forEach(el => { el.checked = false; });
  const days = task.recurrence?.weekdays || [];
  days.forEach(day => {
    const checkbox = document.querySelector(`.edit-recurring-day[value="${day}"]`);
    if (checkbox) checkbox.checked = true;
  });
  modal.style.display = 'flex';
}
window.openEditTask = openEditTask;

async function submitEditTask() {
  if (!activeEditTaskId) return;
  const task = taskCache.get(activeEditTaskId) || {};
  const title = document.getElementById('edit-task-title').value.trim();
  if (!title) return alert('Title is required');
  const duration = parseInt(document.getElementById('edit-task-duration').value, 10);
  if (!Number.isFinite(duration) || duration <= 0) return alert('Duration must be a positive number');

  const recurrenceDays = [...document.querySelectorAll('.edit-recurring-day:checked')].map(el => el.value);
  const payload = {
    title,
    activity_type: document.getElementById('edit-task-type').value,
    duration_minutes: duration,
    scheduled_date: document.getElementById('edit-task-date').value || null,
    scheduled_time: document.getElementById('edit-task-time').value || null,
    notes: document.getElementById('edit-task-notes').value.trim() || null,
    checklist: linesToChecklist(document.getElementById('edit-task-checklist').value),
    recurrence: recurrenceDays.length ? { frequency: 'weekly', weekdays: recurrenceDays } : null,
  };

  if (task.instance_date) payload.instance_date = task.instance_date;

  await fetch(`${API}/api/tasks/${activeEditTaskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  closeEditTaskModal();
  loadTodayTasks();
  loadAllTasks();
}
window.submitEditTask = submitEditTask;

function closeEditTaskModal() {
  const modal = document.getElementById('edit-task-modal');
  if (modal) modal.style.display = 'none';
  activeEditTaskId = null;
}
window.closeEditTaskModal = closeEditTaskModal;

// ── MOOD ────────────────────────────────────────────────────────
function setMood(field, val, btn) {
  mood[field] = val;
  const dots = btn.closest('.mood-dots').querySelectorAll('.mdot');
  const levels = ['low', 'medium', 'high'];
  const clickedIdx = levels.indexOf(val);
  dots.forEach((d, i) => d.classList.toggle('active', i <= clickedIdx));
}

async function saveMood() {
  if (!mood.energy || !mood.focus || !mood.mood) {
    alert('全ての項目を選んでください · Please select all mood levels'); return;
  }
  await fetch(`${API}/api/ai/mood`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mood)
  });
  alert('気分を記録しました · Mood saved');
}

async function loadTodayMood() {
  try {
    const res = await fetch(`${API}/api/ai/mood/today`);
    const data = await res.json();
    if (!data.mood) return;
    const m = data.mood;
    ['energy', 'focus', 'mood'].forEach(field => {
      if (!m[field]) return;
      const container = document.querySelector(`.mood-dots[data-field="${field}"]`);
      if (!container) return;
      const levels = ['low', 'medium', 'high'];
      const idx = levels.indexOf(m[field]);
      container.querySelectorAll('.mdot').forEach((d, i) => {
        d.classList.toggle('active', i <= idx);
      });
      mood[field] = m[field];
    });
  } catch (e) { /* silent */ }
}

// ── AI SENSEI ───────────────────────────────────────────────────
async function fetchAI(type) {
  zenSound('sensei');
  const responseEl = document.getElementById('sensei-response');
  const endpoints = { schedule: '/api/ai/schedule', suggest: '/api/ai/suggest', remind: '/api/ai/remind' };
  const typeLabels = { schedule: '予定の知恵 · Schedule Wisdom', suggest: '提案 · Suggestion', remind: '励まし · Encouragement' };

  responseEl.innerHTML = `
    <div class="sensei-loading">
      <div class="sensei-loading__brush">筆</div>
      <p>先生が考えています · Sensei is reflecting...</p>
    </div>`;

  try {
    const res = await fetch(`${API}${endpoints[type]}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    const data = await res.json();
    responseEl.innerHTML = `
      <div class="sensei-message">
        <div class="sensei-message__header">◆ ${typeLabels[type]}</div>
        ${escHtml(data.advice)}
      </div>`;
  } catch (e) {
    responseEl.innerHTML = `<div class="sensei-message" style="color:var(--cinnabar)">エラーが発生しました · An error occurred</div>`;
  }
}

async function chatWithSensei() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  zenSound('sensei');

  const responseEl = document.getElementById('sensei-response');
  responseEl.innerHTML = `
    <div class="sensei-loading">
      <div class="sensei-loading__brush">筆</div>
      <p>先生が答えています · Sensei is answering...</p>
    </div>`;

  try {
    const res = await fetch(`${API}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg })
    });
    const data = await res.json();
    responseEl.innerHTML = `
      <div class="sensei-message">
        <div class="sensei-message__header">◆ 先生の返答 · Sensei's Reply</div>
        <p style="color:var(--ink-light);font-size:13px;margin-bottom:12px;">あなた: ${escHtml(msg)}</p>
        ${escHtml(data.advice)}
      </div>`;
    input.value = '';
  } catch (e) {
    responseEl.innerHTML = `<div class="sensei-message" style="color:var(--cinnabar)">エラーが発生しました</div>`;
  }
}

async function createTasksWithSensei() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  zenSound('sensei');
  const responseEl = document.getElementById('sensei-response');
  responseEl.innerHTML = `<div class="sensei-loading"><div class="sensei-loading__brush">筆</div><p>先生が計画を作成中 · Sensei is creating tasks...</p></div>`;
  try {
    const res = await fetch(`${API}/api/ai/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, dry_run: true })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Could not generate plan');
    pendingTaskProposal = data.proposal || [];
    responseEl.innerHTML = `
      <div class="sensei-message">
        <div class="sensei-message__header">◆ 提案プラン · Proposed Plan</div>
        ${pendingTaskProposal.length ? pendingTaskProposal.map(t => `・${escHtml(t.title)} (${escHtml(String(t.duration_minutes))} min)`).join('<br>') : 'No valid tasks were generated.'}
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-ink btn-ink--sm" id="confirm-task-plan-btn">同意して作成 · Agree & Create</button>
          <button class="btn-ink btn-ink--sm" id="revise-task-plan-btn">変更したい · Make Changes</button>
        </div>
      </div>`;
    const confirmBtn = document.getElementById('confirm-task-plan-btn');
    const reviseBtn = document.getElementById('revise-task-plan-btn');
    if (confirmBtn) confirmBtn.addEventListener('click', confirmTaskProposal);
    if (reviseBtn) reviseBtn.addEventListener('click', () => {
      pendingTaskProposal = null;
      responseEl.innerHTML = `<div class="sensei-message">了解です。変更したい点をチャットで教えてください · Got it—tell me what to change, and I’ll propose a new plan.</div>`;
    });
  } catch (e) {
    responseEl.innerHTML = `<div class="sensei-message" style="color:var(--cinnabar)">作成失敗 · ${escHtml(String(e.message || e))}</div>`;
  }
}

async function confirmTaskProposal() {
  if (!pendingTaskProposal || !pendingTaskProposal.length) return;
  const responseEl = document.getElementById('sensei-response');
  responseEl.innerHTML = `<div class="sensei-loading"><div class="sensei-loading__brush">筆</div><p>提案を保存しています · Saving approved plan...</p></div>`;
  try {
    const res = await fetch(`${API}/api/ai/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proposed_tasks: pendingTaskProposal })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Could not create tasks');
    responseEl.innerHTML = `
      <div class="sensei-message">
        <div class="sensei-message__header">◆ 作成完了 · Tasks Created</div>
        Created ${data.count} task(s).<br>
        ${data.created.map(t => `・${escHtml(t.title)}`).join('<br>')}
      </div>`;
    pendingTaskProposal = null;
    document.getElementById('chat-input').value = '';
    loadTodayTasks();
  } catch (e) {
    responseEl.innerHTML = `<div class="sensei-message" style="color:var(--cinnabar)">保存失敗 · ${escHtml(String(e.message || e))}</div>`;
  }
}

function renderChecklist(task) {
  if (!task.checklist || !task.checklist.length) return '';
  const checklistItems = normalizeChecklist(task.checklist);

  if (!checklistItems.length) return '';
  return `<ul style="margin:6px 0 0 16px;padding:0;font-size:12px;color:var(--ink-light);">
    ${checklistItems.map((item, idx) => `<li>
      <label style="display:flex;gap:6px;align-items:flex-start;">
        <input type="checkbox" ${item.completed ? 'checked' : ''} onchange="toggleChecklistItem('${task.id}', ${idx}, this.checked)">
        <span>${escHtml(item.text || '')}</span>
      </label>
    </li>`).join('')}
  </ul>`;
}

function normalizeChecklist(checklist) {
  return (checklist || []).map((item) => {
    if (typeof item === 'string') {
      return parseChecklistText(item);
    }
    if (item && typeof item === 'object' && typeof item.text === 'object') {
      return {
        text: String(item.text.text || ''),
        completed: Boolean(item.completed || item.text.completed)
      };
    }
    const parsed = parseChecklistText(item?.text || '');
    return { text: parsed.text, completed: Boolean(item?.completed || parsed.completed) };
  }).filter(i => i.text);
}

function parseChecklistText(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return { text: '', completed: false };
  if (text.startsWith('{') && text.endsWith('}')) {
    const asJson = text
      .replace(/'/g, '"')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false');
    try {
      const parsed = JSON.parse(asJson);
      if (parsed && typeof parsed === 'object') {
        return {
          text: String(parsed.text || '').trim(),
          completed: Boolean(parsed.completed)
        };
      }
    } catch (e) { /* fall through */ }
  }
  return { text, completed: false };
}

async function toggleChecklistItem(taskId, index, checked) {
  const task = taskCache.get(taskId);
  if (!task) return;
  const checklist = normalizeChecklist(task.checklist);
  if (!checklist[index]) return;
  checklist[index].completed = checked;
  task.checklist = checklist;
  const payload = { checklist };
  if (task.instance_date) payload.instance_date = task.instance_date;
  await fetch(`${API}/api/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  loadTodayTasks();
  const allTasksPanel = document.getElementById('panel-tasks');
  if (allTasksPanel && allTasksPanel.classList.contains('panel--active')) {
    loadAllTasks();
  }
}
window.toggleChecklistItem = toggleChecklistItem;

function checklistToLines(checklist) {
  return normalizeChecklist(checklist).map(item => `${item.completed ? '[x]' : '[ ]'} ${item.text}`).join('\n');
}

function linesToChecklist(text) {
  return String(text || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const completed = /^\[x\]/i.test(line);
      const cleaned = line.replace(/^\[(x| )\]\s*/i, '').trim();
      return { text: cleaned || line, completed };
    });
}

// Enter key for chat
document.addEventListener('DOMContentLoaded', () => {
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') chatWithSensei(); });
  }
  const createBtn = document.getElementById('sensei-create-btn');
  if (createBtn) {
    createBtn.addEventListener('click', createTasksWithSensei);
  }
});

// ── STATS ───────────────────────────────────────────────────────
async function loadStats() {
  const container = document.getElementById('stats-content');
  container.innerHTML = '<div class="loading-scroll">読み込み中...</div>';
  try {
    const res = await fetch(`${API}/api/tasks/stats`);
    const stats = await res.json();
    renderStats(stats, container);
  } catch (e) {
    container.innerHTML = '<div class="loading-scroll">エラーが発生しました</div>';
  }
}

function renderStats(stats, container) {
  const mbt = stats.minutes_by_type || {};
  const maxMins = Math.max(...Object.values(mbt), 1);
  const typeColors = {
    learning: 'var(--col-learning)', reading: 'var(--col-reading)', playing: 'var(--col-playing)',
    exercise: 'var(--col-exercise)', rest: 'var(--col-rest)', creative: 'var(--col-creative)', social: 'var(--col-social)'
  };

  const actBars = Object.entries(mbt).map(([t, mins]) => `
    <div class="activity-bar">
      <div class="activity-bar__label">${typeLabel(t)}</div>
      <div class="activity-bar__track">
        <div class="activity-bar__fill" style="width:${Math.round(mins/maxMins*100)}%;background:${typeColors[t]||'var(--ink-faint)'}"></div>
      </div>
      <div class="activity-bar__mins">${mins}m</div>
    </div>
  `).join('') || '<p style="color:var(--ink-faint);font-size:13px">活動データなし</p>';

  container.innerHTML = `
    <div class="stat-card">
      <div class="stat-card__number">${stats.total_tasks}</div>
      <div class="stat-card__label">Total Tasks</div>
      <div class="stat-card__sub">全タスク</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__number">${stats.completed_tasks}</div>
      <div class="stat-card__label">Completed</div>
      <div class="stat-card__sub">完了したタスク</div>
    </div>
    <div class="stat-card">
      <div class="stat-card__number">${stats.completion_rate}%</div>
      <div class="stat-card__label">Completion Rate</div>
      <div class="stat-card__sub">完了率</div>
    </div>
    <div class="stat-card" style="grid-column: 1/-1">
      <div style="text-align:left">
        <div style="font-family:'Shippori Mincho',serif;font-size:16px;font-weight:600;margin-bottom:16px;color:var(--ink)">
          活動別時間 · Time by Activity
        </div>
        ${actBars}
      </div>
    </div>`;
}

// ── HELPERS ─────────────────────────────────────────────────────
function typeLabel(type) {
  const map = {
    learning: '学習', reading: '読書', playing: '遊び',
    exercise: '運動', rest: '休息', creative: '創造', social: '交流'
  };
  return map[type] || type;
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function setFeedback(el, msg, cls) {
  el.textContent = msg;
  el.className = `feedback-msg ${cls}`;
  setTimeout(() => { el.textContent = ''; el.className = 'feedback-msg'; }, 4000);
}

// ── REMINDERS / NOTIFICATIONS ───────────────────────────────────
function hydrateReminderHistory() {
  try {
    const raw = localStorage.getItem(reminderState.storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    reminderState.notified = new Set(parsed);
  } catch (e) {
    reminderState.notified = new Set();
  }
}

function persistReminderHistory() {
  try {
    const recent = [...reminderState.notified].slice(-200);
    localStorage.setItem(reminderState.storageKey, JSON.stringify(recent));
  } catch (e) { /* ignore storage failures */ }
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function startReminderLoop() {
  if (reminderState.interval) clearInterval(reminderState.interval);
  runReminderCheck(); // immediate
  reminderState.interval = setInterval(runReminderCheck, 30 * 1000);
}

async function runReminderCheck() {
  const now = new Date();
  const today = todayISO();
  let tasks = [];
  try {
    const res = await fetch(`${API}/api/tasks/today`);
    tasks = await res.json();
  } catch (e) {
    return;
  }

  tasks.forEach(task => {
    if (!task || task.completed || !task.scheduled_time) return;
    const taskDate = task.instance_date || task.scheduled_date || today;
    if (taskDate !== today) return;
    const [hoursStr, minsStr] = String(task.scheduled_time).split(':');
    const hours = Number(hoursStr);
    const mins = Number(minsStr);
    if (!Number.isFinite(hours) || !Number.isFinite(mins)) return;

    const dueAt = new Date(now);
    dueAt.setHours(hours, mins, 0, 0);
    const deltaMs = now.getTime() - dueAt.getTime();
    // Notify once, from due time up to 59s after.
    if (deltaMs < 0 || deltaMs > 59 * 1000) return;

    const reminderId = `${task.id}|${taskDate}|${task.scheduled_time}`;
    if (reminderState.notified.has(reminderId)) return;
    reminderState.notified.add(reminderId);
    persistReminderHistory();
    showTaskReminder(task, taskDate);
  });
}

function showTaskReminder(task, taskDate) {
  const when = `${taskDate} ${task.scheduled_time}`;
  const body = `${task.title} · ${task.duration_minutes || '?'} min`;
  zenSound('warning');

  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('⏰ Task reminder', { body: `${body}\n${when}`, tag: `jikan-${task.id}` });
    } catch (e) { /* ignore */ }
  }

  const containerId = 'jikan-toast-stack';
  let stack = document.getElementById(containerId);
  if (!stack) {
    stack = document.createElement('div');
    stack.id = containerId;
    stack.className = 'toast-stack';
    document.body.appendChild(stack);
  }

  const toast = document.createElement('div');
  toast.className = 'task-toast';
  toast.innerHTML = `
    <div class="task-toast__title">⏰ Reminder</div>
    <div class="task-toast__body">${escHtml(task.title)}</div>
    <div class="task-toast__meta">${escHtml(when)}</div>
  `;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    setTimeout(() => toast.remove(), 280);
  }, 5000);
}

/* ================================================================
   POMODORO TIMER — 集中
   ================================================================ */

const POMO = {
  // Settings
  durations: { focus: 25, short: 5, long: 15 },
  sessionsUntilLong: 4,
  soundEnabled: true,
  autoStart: false,

  // State
  mode: 'focus',        // 'focus' | 'short' | 'long'
  sessionCount: 0,      // completed focus sessions
  timeLeft: 25 * 60,    // seconds
  totalTime: 25 * 60,
  running: false,
  interval: null,
  log: [],
};

// ── Init ────────────────────────────────────────────────────────
function pomoInit() {
  POMO.timeLeft = POMO.durations.focus * 60;
  POMO.totalTime = POMO.timeLeft;
  pomoRenderTime();
  pomoRenderRing();
  pomoRenderLog();
}

// ── Start / Pause ────────────────────────────────────────────────
function pomoToggle() {
  if (POMO.running) {
    pomoPause();
  } else {
    pomoStart();
  }
}

function pomoStart() {
  POMO.running = true;
  zenSound('timer_start');
  const btn = document.getElementById('pomo-start-btn');
  const lbl = document.getElementById('pomo-start-label');
  btn.classList.add('running');
  lbl.textContent = '一時停止 · Pause';
  document.getElementById('pomo-time').classList.add('ticking');

  startTicking(); // 木魚 tick + 60s warning

  POMO.interval = setInterval(() => {
    POMO.timeLeft--;
    pomoRenderTime();
    pomoRenderRing();
    if (POMO.timeLeft <= 0) pomoComplete();
  }, 1000);
}

function pomoPause() {
  POMO.running = false;
  zenSound('timer_stop');
  clearInterval(POMO.interval);
  stopTicking();
  const btn = document.getElementById('pomo-start-btn');
  const lbl = document.getElementById('pomo-start-label');
  btn.classList.remove('running');
  lbl.textContent = '再開 · Resume';
  document.getElementById('pomo-time').classList.remove('ticking');
}

function pomoReset() {
  pomoPause(); // also calls stopTicking()
  _warningFired = false;
  POMO.timeLeft = POMO.durations[POMO.mode] * 60;
  POMO.totalTime = POMO.timeLeft;
  document.getElementById('pomo-start-label').textContent = '始める · Start';
  document.getElementById('pomo-time').classList.remove('ticking');
  pomoRenderTime();
  pomoRenderRing();
}

function pomoSkip() {
  pomoPause();
  pomoComplete(true);
}

// ── Complete a session ───────────────────────────────────────────
function pomoComplete(skipped = false) {
  clearInterval(POMO.interval);
  stopTicking();
  POMO.running = false;
  document.getElementById('pomo-time').classList.remove('ticking');

  // Log entry
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const modeLabels = { focus: '集中 Focus', short: '短休憩 Short Break', long: '長休憩 Long Break' };
  POMO.log.unshift({
    mode: POMO.mode,
    label: modeLabels[POMO.mode],
    time: timeStr,
    skipped,
    mins: POMO.durations[POMO.mode],
  });

  // Play completion sound based on what just finished
  if (POMO.soundEnabled && !skipped) {
    if (POMO.mode === 'focus') {
      soundKane(); // deep temple bell — focus session done
    } else if (POMO.mode === 'long') {
      soundFocusStart(); // three ascending pings — ready to work again
    } else {
      soundRin(); // soft rin — short break done
    }
  }

  // Determine next mode
  if (POMO.mode === 'focus') {
    POMO.sessionCount++;
    if (POMO.sessionCount % POMO.sessionsUntilLong === 0) {
      pomoSetMode('long');
    } else {
      pomoSetMode('short');
    }
  } else {
    pomoSetMode('focus');
  }

  pomoRenderLog();

  if (POMO.autoStart) {
    setTimeout(() => pomoStart(), 1500);
  } else {
    const lbl = document.getElementById('pomo-start-label');
    lbl.textContent = '始める · Start';
    const btn = document.getElementById('pomo-start-btn');
    btn.classList.remove('running');
  }
}

// ── Mode switching ───────────────────────────────────────────────
function pomoSetMode(mode, btn) {
  const wasManual = !!btn; // user clicked directly vs auto-transition
  POMO.mode = mode;
  POMO.timeLeft = POMO.durations[mode] * 60;
  POMO.totalTime = POMO.timeLeft;
  _warningFired = false;

  // Play sound on manual switch
  if (wasManual && POMO.soundEnabled) {
    if (mode === 'focus')      soundFocusStart();
    else if (mode === 'long')  soundDaisho();
    else                       soundRin();
  }

  // Update active button
  document.querySelectorAll('.pomo-mode-btn').forEach(b => {
    b.classList.remove('active', 'break-mode');
  });
  const activeBtn = btn || document.getElementById(`mode-btn-${mode}`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    if (mode !== 'focus') activeBtn.classList.add('break-mode');
  }

  // Ring colour
  const ring = document.getElementById('pomo-ring-fill');
  if (mode === 'focus') {
    ring.classList.remove('break-mode');
    ring.style.stroke = '#c0392b';
  } else {
    ring.classList.add('break-mode');
    ring.style.stroke = '#2c4a6e';
  }

  // Mode label
  const modeLabels = {
    focus: '集中 · Focus',
    short: '短い休憩 · Short Break',
    long:  '長い休憩 · Long Break',
  };
  document.getElementById('pomo-mode-label').textContent = modeLabels[mode];

  pomoRenderTime();
  pomoRenderRing();

  const startLbl = document.getElementById('pomo-start-label');
  if (startLbl) startLbl.textContent = '始める · Start';
  const startBtn = document.getElementById('pomo-start-btn');
  if (startBtn) startBtn.classList.remove('running');
  document.getElementById('pomo-time').classList.remove('ticking');
}

// ── Settings ─────────────────────────────────────────────────────
function pomoApplySettings() {
  POMO.durations.focus  = parseInt(document.getElementById('set-focus').value)   || 25;
  POMO.durations.short  = parseInt(document.getElementById('set-short').value)   || 5;
  POMO.durations.long   = parseInt(document.getElementById('set-long').value)    || 15;
  POMO.sessionsUntilLong = parseInt(document.getElementById('set-sessions').value) || 4;
  POMO.soundEnabled     = document.getElementById('set-sound').checked;
  POMO.autoStart        = document.getElementById('set-autostart').checked;

  // Update labels on mode buttons
  document.getElementById('pomo-focus-mins').textContent = `${POMO.durations.focus} min`;
  document.getElementById('pomo-short-mins').textContent = `${POMO.durations.short} min`;
  document.getElementById('pomo-long-mins').textContent  = `${POMO.durations.long} min`;

  // Reset current timer to new duration if not running
  if (!POMO.running) {
    POMO.timeLeft = POMO.durations[POMO.mode] * 60;
    POMO.totalTime = POMO.timeLeft;
    pomoRenderTime();
    pomoRenderRing();
  }
}

// ── Render helpers ────────────────────────────────────────────────
function pomoRenderTime() {
  const m = Math.floor(POMO.timeLeft / 60).toString().padStart(2, '0');
  const s = (POMO.timeLeft % 60).toString().padStart(2, '0');
  document.getElementById('pomo-time').textContent = `${m}:${s}`;

  const focusDone = POMO.sessionCount;
  document.getElementById('pomo-session').textContent =
    `第 ${focusDone + 1} 回 · Session ${focusDone + 1}`;
}

function pomoRenderRing() {
  const circumference = 553; // 2π × 88
  const progress = POMO.totalTime > 0 ? POMO.timeLeft / POMO.totalTime : 0;
  const offset = circumference * (1 - progress);
  document.getElementById('pomo-ring-fill').style.strokeDashoffset = offset;
}

function pomoRenderLog() {
  const el = document.getElementById('pomo-log');
  if (!el) return;
  if (!POMO.log.length) {
    el.innerHTML = '<div class="pomo-log-empty">まだ記録なし · No sessions yet</div>';
    return;
  }
  el.innerHTML = POMO.log.slice(0, 20).map(e => `
    <div class="pomo-log-entry">
      <div class="pomo-log-entry__dot ${e.mode === 'focus' ? 'focus' : 'break'}"></div>
      <span>${e.label}${e.skipped ? ' <em style="color:var(--ink-faint)">(skipped)</em>' : ''}</span>
      <span class="pomo-log-entry__time">${e.time}</span>
    </div>
  `).join('');
}

// ================================================================
//  禅の音 ZEN SOUND ENGINE — Web Audio API, no files required
//  All sounds synthesised from sine/triangle waves with
//  careful envelope shaping to mimic Japanese instruments.
// ================================================================

let _audioCtx = null;

function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browser autoplay policy)
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

// ── Core synthesiser helpers ─────────────────────────────────────

/**
 * Play a single damped tone — basis for all bowl/bell sounds.
 * @param {AudioContext} ctx
 * @param {number} freq      - fundamental frequency in Hz
 * @param {number} gain      - peak amplitude (0–1)
 * @param {number} attack    - attack time in seconds
 * @param {number} decay     - decay time in seconds (long = bowl-like)
 * @param {number} startAt   - ctx.currentTime offset
 * @param {string} type      - oscillator type
 */
function playTone(ctx, freq, gain, attack, decay, startAt, type = 'sine') {
  const osc  = ctx.createOscillator();
  const env  = ctx.createGain();
  // Slight high-frequency shimmer layer for bowl realism
  const osc2 = ctx.createOscillator();
  const env2 = ctx.createGain();

  osc.type      = type;
  osc.frequency.value = freq;
  osc2.type     = 'sine';
  osc2.frequency.value = freq * 2.756; // inharmonic partial — bowl characteristic

  env.gain.setValueAtTime(0, startAt);
  env.gain.linearRampToValueAtTime(gain, startAt + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay);

  env2.gain.setValueAtTime(0, startAt);
  env2.gain.linearRampToValueAtTime(gain * 0.18, startAt + attack);
  env2.gain.exponentialRampToValueAtTime(0.0001, startAt + attack + decay * 0.4);

  osc.connect(env);   env.connect(ctx.destination);
  osc2.connect(env2); env2.connect(ctx.destination);

  osc.start(startAt);  osc.stop(startAt + attack + decay + 0.1);
  osc2.start(startAt); osc2.stop(startAt + attack + decay * 0.4 + 0.1);
}

/**
 * Soft click/tick — subtle wooden clap (mokugyo-like)
 */
function playTick(ctx, startAt) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
  }
  const src  = ctx.createBufferSource();
  const filt = ctx.createBiquadFilter();
  const env  = ctx.createGain();
  filt.type = 'bandpass';
  filt.frequency.value = 900;
  filt.Q.value = 0.8;
  env.gain.setValueAtTime(0.18, startAt);
  env.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.04);
  src.buffer = buf;
  src.connect(filt); filt.connect(env); env.connect(ctx.destination);
  src.start(startAt); src.stop(startAt + 0.05);
}

// ── Named sounds ─────────────────────────────────────────────────

/**
 * 鐘 Kane — deep temple bell strike.
 * Used when a focus session ends.
 */
function soundKane() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    // Deep fundamental
    playTone(ctx, 110, 0.55, 0.005, 6.0, t, 'sine');
    // Second harmonic
    playTone(ctx, 220, 0.30, 0.005, 4.5, t, 'sine');
    // High shimmer
    playTone(ctx, 349, 0.12, 0.005, 2.5, t, 'sine');
    // Slight delay echo
    playTone(ctx, 110, 0.18, 0.005, 5.0, t + 0.08, 'sine');
  } catch(e) {}
}

/**
 * 木魚 Mokugyo — short hollow wooden knock.
 * Used for the focus session tick every second.
 */
function soundMokugyo() {
  try {
    const ctx = getAudioCtx();
    playTick(ctx, ctx.currentTime);
  } catch(e) {}
}

/**
 * 鈴 Rin — bright singing bowl tap, lighter than kane.
 * Used when a short break starts.
 */
function soundRin() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    playTone(ctx, 528,  0.35, 0.003, 3.2, t, 'sine');
    playTone(ctx, 1056, 0.12, 0.003, 1.8, t, 'sine');
    playTone(ctx, 792,  0.08, 0.003, 2.0, t + 0.01, 'sine');
  } catch(e) {}
}

/**
 * 大鐘 Daishō — double deep gong, majestic.
 * Used when a long break starts.
 */
function soundDaisho() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    // First strike
    playTone(ctx,  82, 0.60, 0.006, 7.0, t,      'sine');
    playTone(ctx, 164, 0.28, 0.006, 5.0, t,      'sine');
    playTone(ctx, 246, 0.10, 0.006, 3.0, t,      'sine');
    // Second strike — slightly higher, half a second later
    playTone(ctx,  98, 0.45, 0.006, 6.0, t + 0.55, 'sine');
    playTone(ctx, 196, 0.20, 0.006, 4.0, t + 0.55, 'sine');
  } catch(e) {}
}

/**
 * 三連鈴 Sanrenrin — three quick ascending bowl pings.
 * Used when a focus session begins (return from break).
 */
function soundFocusStart() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    playTone(ctx, 396, 0.28, 0.003, 2.0, t,        'sine');
    playTone(ctx, 528, 0.28, 0.003, 2.0, t + 0.22, 'sine');
    playTone(ctx, 660, 0.28, 0.003, 2.0, t + 0.44, 'sine');
  } catch(e) {}
}

/**
 * 完了の鈴 Kanryō — soft descending double tone.
 * Used when user marks a task 完了 (done).
 */
function soundTaskDone() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    playTone(ctx, 660, 0.25, 0.003, 1.8, t,        'sine');
    playTone(ctx, 528, 0.20, 0.003, 2.2, t + 0.28, 'sine');
  } catch(e) {}
}

/**
 * 作成の鈴 Sakusei — warm upward two-tone cue.
 * Used when a new task is created successfully.
 */
function soundTaskCreated() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    playTone(ctx, 494, 0.22, 0.003, 1.2, t, 'sine');
    playTone(ctx, 622, 0.25, 0.003, 1.6, t + 0.16, 'sine');
  } catch(e) {}
}

/**
 * 先生の合図 Sensei cue — light contemplative chime.
 * Used when asking AI Sensei for guidance.
 */
function soundSenseiCue() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    playTone(ctx, 432, 0.16, 0.002, 1.2, t, 'sine');
    playTone(ctx, 576, 0.14, 0.002, 1.0, t + 0.12, 'triangle');
  } catch(e) {}
}

/**
 * タイマー停止 Timer stop — short muted click+tone.
 * Used when pausing the Pomodoro timer.
 */
function soundTimerStop() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    playTick(ctx, t);
    playTone(ctx, 320, 0.08, 0.001, 0.35, t, 'sine');
  } catch(e) {}
}

/**
 * 警告の鐘 Keikoku — three urgent soft pings rising in pitch.
 * Used at 60-second warning before session ends.
 */
function soundWarning() {
  try {
    const ctx = getAudioCtx();
    const t = ctx.currentTime;
    [0, 0.30, 0.60].forEach((delay, i) => {
      playTone(ctx, 440 + i * 110, 0.22, 0.003, 1.0, t + delay, 'sine');
    });
  } catch(e) {}
}

// ── Ticking state ────────────────────────────────────────────────
let _tickInterval = null;
let _warningFired = false;

function startTicking() {
  stopTicking();
  _warningFired = false;
  if (!POMO.soundEnabled) return;
  _tickInterval = setInterval(() => {
    if (!POMO.soundEnabled) return;
    // Warning at exactly 60 seconds left (fire once)
    if (POMO.timeLeft === 60 && !_warningFired) {
      _warningFired = true;
      soundWarning();
      return; // skip tick this second
    }
    // Soft tick only during focus mode
    if (POMO.mode === 'focus') {
      soundMokugyo();
    }
  }, 1000);
}

function stopTicking() {
  if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
}

// ── Central dispatcher called throughout the app ─────────────────

/**
 * Play a named zen sound if sound is enabled.
 * Names: 'kane' | 'rin' | 'daisho' | 'focus_start' | 'task_done' | 'task_created' | 'sensei' | 'timer_start' | 'timer_stop' | 'warning'
 */
function zenSound(name) {
  if (!POMO.soundEnabled) return;
  const map = {
    kane:        soundKane,
    rin:         soundRin,
    daisho:      soundDaisho,
    focus_start: soundFocusStart,
    timer_start: soundFocusStart,
    timer_stop:  soundTimerStop,
    task_done:   soundTaskDone,
    task_created: soundTaskCreated,
    sensei:      soundSenseiCue,
    warning:     soundWarning,
  };
  if (map[name]) map[name]();
}

// Keep old name working (called in pomoComplete)
function pomoPlaySound() { soundKane(); }

// ── Initialise when Pomodoro panel is first opened ────────────────
const _origShowPanel = showPanel;
// Override showPanel to init Pomodoro lazily
window.showPanel = function(name, btn) {
  _origShowPanel(name, btn);
  if (name === 'pomodoro') pomoInit();
};

/* ================================================================
   WOOD THEME SWITCHER — 木のテーマ切替
   ================================================================ */

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('jikan-theme', theme);

  // Update active state on buttons
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`theme-${theme}-btn`);
  if (btn) btn.classList.add('active');

  // Update Pomodoro ring colour to match theme accent
  const ring = document.getElementById('pomo-ring-fill');
  if (ring && POMO.mode !== 'focus') {
    ring.style.stroke = getComputedStyle(document.documentElement)
      .getPropertyValue('--indigo').trim();
  }
}

// Load saved theme on startup (default: dark walnut)
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('jikan-theme') || 'dark';
  setTheme(saved);
});
