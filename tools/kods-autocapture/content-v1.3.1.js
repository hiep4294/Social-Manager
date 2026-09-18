(() => {
  const VERSION = '1.3.1';
  const EXEC_PREFIX = 'KODS_AUTORUN';
  const baseline = new Set();
  const executed = new Set();
  const candidates = new Map();
  const resultQueue = [];
  let processing = false;
  let initialized = false;
  let currentUrl = location.href;
  let lastUserActivityAt = 0;
  let resultPumpRunning = false;
  const STABLE_MS = 900;
  const RESULT_IDLE_MS = 1600;

  function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
    return (h >>> 0).toString(16);
  }

  function parseCommand(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
    if (!normalized.startsWith(EXEC_PREFIX)) return null;
    const lines = normalized.split('\n');
    const header = lines.shift().trim();
    const parts = header.split(/\s+/);
    if (parts[0] !== EXEC_PREFIX) return null;
    const runId = String(parts[2] || '').trim();
    let shell = (parts[1] || 'powershell').toLowerCase();
    if (shell === 'ps' || shell === 'pwsh') shell = 'powershell';
    if (!['powershell', 'cmd'].includes(shell)) return null;
    const command = lines.join('\n').trim();
    if (!command) return null;
    if (/^[<\[][^^\r\n]{1,120}[>\]]$/.test(command)) return null;
    if (/^(?:YOUR_COMMAND_HERE|COMMAND_HERE|LENH_O_DAY|LỆNH_Ở_ĐÂY)$/i.test(command)) return null;
    return { shell, command, runId };
  }

  function messageKey(message, index) {
    const explicit =
      message.getAttribute('data-message-id') ||
      message.getAttribute('data-testid') ||
      message.id;
    return explicit ? 'id:' + explicit : 'idx:' + index;
  }

  function isChatGenerating() {
    return Boolean(
      document.querySelector('button[data-testid="stop-button"]') ||
      document.querySelector('button[aria-label*="Stop generating"]') ||
      document.querySelector('button[aria-label*="Dừng tạo"]') ||
      document.querySelector('button[aria-label*="Dừng"]')
    );
  }

  function truncate(text, max) {
    text = String(text || '');
    if (text.length <= max) return text;
    const head = Math.floor(max * 0.7);
    const tail = max - head;
    return text.slice(0, head) + '\n\n...[TRUNCATED BY KODS PC CONTROL]...\n\n' + text.slice(-tail);
  }

  function showToast(message, isError = false) {
    let box = document.getElementById('kods-pc-control-toast');
    if (!box) {
      box = document.createElement('div');
      box.id = 'kods-pc-control-toast';
      Object.assign(box.style, {
        position: 'fixed', right: '18px', bottom: '18px', zIndex: 2147483647,
        maxWidth: '520px', padding: '10px 14px', borderRadius: '8px',
        font: '13px/1.4 system-ui, sans-serif', boxShadow: '0 4px 20px rgba(0,0,0,.25)'
      });
      document.documentElement.appendChild(box);
    }
    box.style.background = isError ? '#7f1d1d' : '#111827';
    box.style.color = '#fff';
    box.textContent = message;
    box.style.display = 'block';
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { box.style.display = 'none'; }, 5000);
  }

  function isEditableElement(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.matches && el.matches('input, textarea, select, [contenteditable="true"]')) return true;
    return Boolean(el.closest && el.closest('input, textarea, select, [contenteditable="true"]'));
  }

  function getComposerText(composer) {
    if (!composer) return '';
    if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') return composer.value || '';
    return composer.innerText || composer.textContent || '';
  }

  function canReturnResultNow() {
    if (isChatGenerating()) return false;
    const composer = document.querySelector('#prompt-textarea');
    if (!composer) return false;
    if (getComposerText(composer).trim()) return false;
    if (document.hasFocus() && (Date.now() - lastUserActivityAt) < RESULT_IDLE_MS) return false;
    const active = document.activeElement;
    if (document.hasFocus() && active && active !== composer && isEditableElement(active)) return false;
    return true;
  }

  function rememberFocus() {
    const active = document.activeElement;
    const state = { active };
    try {
      if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
        state.selectionStart = active.selectionStart;
        state.selectionEnd = active.selectionEnd;
      } else if (active && active.isContentEditable) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount) state.range = sel.getRangeAt(0).cloneRange();
      }
    } catch {}
    return state;
  }

  function restoreFocus(state) {
    if (!state || !state.active || !state.active.isConnected) return;
    try {
      state.active.focus({ preventScroll: true });
      if (typeof state.selectionStart === 'number' && state.active.setSelectionRange) {
        state.active.setSelectionRange(state.selectionStart, state.selectionEnd);
      } else if (state.range && state.active.isContentEditable) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(state.range);
      }
    } catch {}
  }

  async function setComposerText(text) {
    const composer = document.querySelector('#prompt-textarea');
    if (!composer || getComposerText(composer).trim()) return null;
    const focusState = rememberFocus();

    if (composer.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(composer, text); else composer.value = text;
      composer.dispatchEvent(new Event('input', { bubbles: true }));
      return focusState;
    }

    composer.textContent = text;
    composer.dispatchEvent(new InputEvent('input', {
      bubbles: true, inputType: 'insertText', data: text
    }));
    return focusState;
  }

  async function trySendToChat(text) {
    if (!canReturnResultNow()) return false;
    const focusState = await setComposerText(text);
    if (!focusState) return false;
    await new Promise(r => setTimeout(r, 180));

    let sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                  document.querySelector('button[aria-label*="Send"]') ||
                  document.querySelector('button[aria-label*="Gửi"]');

    if (!sendBtn || sendBtn.disabled) {
      const composer = document.querySelector('#prompt-textarea');
      if (!composer || getComposerText(composer).trim() !== text.trim()) {
        restoreFocus(focusState);
        return false;
      }
      try {
        composer.focus({ preventScroll: true });
        composer.dispatchEvent(new InputEvent('input', {
          bubbles: true, inputType: 'insertText', data: text
        }));
      } catch {}
      await new Promise(r => setTimeout(r, 120));
      sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                document.querySelector('button[aria-label*="Send"]') ||
                document.querySelector('button[aria-label*="Gửi"]');
    }

    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click();
      setTimeout(() => restoreFocus(focusState), 50);
      return true;
    }

    const composer = document.querySelector('#prompt-textarea');
    if (composer && getComposerText(composer).trim() === text.trim()) {
      if (composer.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        if (setter) setter.call(composer, ''); else composer.value = '';
      } else {
        composer.textContent = '';
      }
      composer.dispatchEvent(new Event('input', { bubbles: true }));
    }
    restoreFocus(focusState);
    return false;
  }

  async function pumpResultQueue() {
    if (resultPumpRunning) return;
    resultPumpRunning = true;
    try {
      while (resultQueue.length) {
        if (!canReturnResultNow()) {
          await new Promise(r => setTimeout(r, 650));
          continue;
        }
        const item = resultQueue[0];
        const sent = await trySendToChat(item.text);
        if (sent) {
          resultQueue.shift();
          showToast('KODS PC Control: result returned to ChatGPT.');
        } else {
          await new Promise(r => setTimeout(r, 850));
        }
      }
    } finally {
      resultPumpRunning = false;
    }
  }

  function queueResultForChat(text) {
    resultQueue.push({ text, queuedAt: Date.now() });
    showToast('KODS PC Control: command finished; returning result...');
    pumpResultQueue();
  }

  function formatResult(id, shell, response) {
    const data = response && response.data ? response.data : null;
    if (!response || !response.ok || !data) {
      return `[KODS_RESULT ${id}]\nSTATUS: TRANSPORT_ERROR\nSHELL: ${shell}\nERROR: ${response && response.error ? response.error : 'Unknown extension/agent error'}`;
    }
    if (data.blocked) {
      return `[KODS_RESULT ${id}]\nSTATUS: BLOCKED\nSHELL: ${shell}\nERROR: ${data.error || 'BLOCKED'}\nREASON: ${data.reason || ''}`;
    }
    return `[KODS_RESULT ${id}]\nSTATUS: ${data.ok ? 'OK' : 'ERROR'}\nHOST: ${data.host || ''}\nUSER: ${data.user || ''}\nSHELL: ${shell}\nEXIT_CODE: ${data.exitCode}\nDURATION_MS: ${data.durationMs}\nTIMED_OUT: ${Boolean(data.timedOut)}\nSTDOUT:\n${truncate(data.stdout || '', 9500)}\nSTDERR:\n${truncate(data.stderr || '', 4000)}`;
  }

  async function executeParsed(code, parsed, executionKey, resultId) {
    executed.add(executionKey);
    sessionStorage.setItem('kods_exec_' + hashString(executionKey), '1');
    try { code.dataset.kodsExecuted = '1'; } catch {}
    showToast(`KODS PC Control ${VERSION}: running ${parsed.shell}...`);

    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'KODS_EXEC',
        shell: parsed.shell,
        command: parsed.command,
        timeoutMs: 120000
      });
    } catch (error) {
      response = { ok: false, error: String(error?.message || error) };
    }

    queueResultForChat(formatResult(resultId, parsed.shell, response));
  }

  function collectExecutable(message, index) {
    const blocks = Array.from(message.querySelectorAll('pre code'));
    const runnable = [];
    for (const code of blocks) {
      const text = (code.innerText || code.textContent || '').trim();
      if (!text.startsWith(EXEC_PREFIX)) continue;
      const parsed = parseCommand(text);
      if (parsed) runnable.push({ code, text, parsed });
    }
    return { key: messageKey(message, index), runnable };
  }

  function baselineExisting() {
    const messages = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
    messages.forEach((message, index) => {
      const item = collectExecutable(message, index);
      for (const run of item.runnable) {
        const commandHash = hashString(run.parsed.shell + '\n' + run.parsed.command);
        const replayKey = run.parsed.runId ? ('run:' + run.parsed.runId) : ('cmd:' + commandHash);
        baseline.add(replayKey);
      }
    });
  }

  async function scan() {
    if (processing) return;
    processing = true;
    try {
      if (!initialized) {
        baselineExisting();
        initialized = true;
        showToast(`KODS PC Control ${VERSION}: AutoRun ready.`);
        return;
      }

      const now = Date.now();
      const messages = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]'));
      const activeCandidateKeys = new Set();

      for (let index = 0; index < messages.length; index++) {
        const item = collectExecutable(messages[index], index);
        if (!item.runnable.length) continue;

        if (item.runnable.length > 1) {
          showToast('KODS PC Control: multiple executable blocks in one assistant message; nothing was run.', true);
          candidates.delete(item.key);
          continue;
        }

        const run = item.runnable[0];
        const commandHash = hashString(run.parsed.shell + '\n' + run.parsed.command);
        const replayKey = run.parsed.runId ? ('run:' + run.parsed.runId) : ('cmd:' + commandHash);
        const executionKey = replayKey;
        const sessionKey = 'kods_exec_' + hashString(replayKey);
        activeCandidateKeys.add(item.key);

        if (baseline.has(replayKey)) continue;
        if (executed.has(replayKey) || sessionStorage.getItem(sessionKey) === '1') continue;

        const previous = candidates.get(item.key);
        if (!previous || previous.commandHash !== commandHash || previous.text !== run.text) {
          candidates.set(item.key, {
            commandHash,
            text: run.text,
            since: now,
            code: run.code,
            parsed: run.parsed,
            executionKey,
            replayKey
          });
          continue;
        }

        if ((now - previous.since) < STABLE_MS) continue;
        if (isChatGenerating()) continue;

        candidates.delete(item.key);
        const resultId = run.parsed.runId || hashString(executionKey + ':' + Date.now());
        await executeParsed(run.code, run.parsed, executionKey, resultId);
      }

      for (const key of Array.from(candidates.keys())) {
        if (!activeCandidateKeys.has(key)) candidates.delete(key);
      }
    } finally {
      processing = false;
    }
  }

  document.addEventListener('pointerdown', event => {
    if (event.isTrusted) lastUserActivityAt = Date.now();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.isTrusted) lastUserActivityAt = Date.now();
  }, true);
  document.addEventListener('input', event => {
    if (event.isTrusted) lastUserActivityAt = Date.now();
  }, true);

  const observer = new MutationObserver(() => {
    clearTimeout(observer._timer);
    observer._timer = setTimeout(scan, 180);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  setTimeout(scan, 500);
  setInterval(() => {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      initialized = false;
      baseline.clear();
      candidates.clear();
    }
    scan();
  }, 700);
})();