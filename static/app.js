/* ==========================================================================
   Script to Hindi Story - Frontend Client (English Interface)
   ========================================================================== */

const DEFAULT_SYSTEM_PROMPT = `1. Write only in Hindi (Devanagari). Do not skip any important event, fact, name, date or dialogue.
2. Remove speaker labels (Narrator:, Host:), timestamps, [music]/[applause] tags and any "role" labels.
3. No headings, subheadings, bullets or sections (no partitions). Only continuous paragraphs, like a book narrative.
4. Start exactly where the script starts and follow the same sequence. Remove repetition but keep the flow.
5. Do not add any introduction, conclusion, advice or commentary. Output only the story text.`;

const STORAGE_KEYS = {
  KEY_1: 'script_hindi_key_1',
  KEY_2: 'script_hindi_key_2',
  KEY_3: 'script_hindi_key_3',
  MODEL: 'script_hindi_model',
  CHUNK_SIZE: 'script_hindi_chunk_size',
  PROMPT: 'script_hindi_prompt',
  SETTINGS_OPEN: 'script_hindi_settings_open'
};

const state = {
  isGenerating: false,
  abortController: null,
  accumulatedStory: ''
};

// DOM elements cache
const DOM = {
  settingsCard: document.getElementById('settings-card'),
  settingsToggle: document.getElementById('settings-toggle'),
  settingsToggleBtn: document.getElementById('settings-toggle-btn'),
  settingsBody: document.getElementById('settings-body'),
  settingsSummary: document.getElementById('settings-summary'),
  closeSettingsBtn: document.getElementById('close-settings-btn'),
  apiKey1: document.getElementById('api-key-1'),
  apiKey2: document.getElementById('api-key-2'),
  apiKey3: document.getElementById('api-key-3'),
  modelSelect: document.getElementById('model-select'),
  chunkSizeInput: document.getElementById('chunk-size'),
  systemPrompt: document.getElementById('system-prompt'),
  resetPromptBtn: document.getElementById('reset-prompt-btn'),

  scriptInput: document.getElementById('script-input'),
  loadSampleBtn: document.getElementById('load-sample-btn'),
  clearScriptBtn: document.getElementById('clear-script-btn'),
  scriptCharCount: document.getElementById('script-char-count'),
  scriptWordCount: document.getElementById('script-word-count'),
  scriptChunkDivider: document.getElementById('script-chunk-divider'),
  scriptChunksEstimate: document.getElementById('script-chunks-estimate'),
  generateBtn: document.getElementById('generate-btn'),
  stopBtn: document.getElementById('stop-btn'),

  errorBanner: document.getElementById('error-banner'),
  errorMessage: document.getElementById('error-message'),
  errorDismissBtn: document.getElementById('error-dismiss-btn'),
  progressContainer: document.getElementById('progress-container'),
  progressStatusText: document.getElementById('progress-status-text'),
  progressPercentText: document.getElementById('progress-percent-text'),
  progressBarFill: document.getElementById('progress-bar-fill'),
  progressDetailsText: document.getElementById('progress-details-text'),

  resultCard: document.getElementById('result-card'),
  storyOutput: document.getElementById('story-output'),
  copyBtn: document.getElementById('copy-btn'),
  downloadBtn: document.getElementById('download-btn'),
  storyCharCount: document.getElementById('story-char-count'),
  storyWordCount: document.getElementById('story-word-count'),
  storyParagraphsCount: document.getElementById('story-paragraphs-count'),
  copyStatusMsg: document.getElementById('copy-status-msg')
};

function getStored(key, defaultVal) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? v : defaultVal;
  } catch (_) {
    return defaultVal;
  }
}

function setStored(key, val) {
  try {
    localStorage.setItem(key, val);
  } catch (_) {}
}

function countWords(str) {
  if (!str) return 0;
  const t = str.trim();
  return t ? t.split(/\s+/).length : 0;
}

function countParagraphs(str) {
  if (!str) return 0;
  const t = str.trim();
  if (!t) return 0;
  return t.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
}

function getActiveApiKeys() {
  const k1 = (DOM.apiKey1.value || '').trim();
  const k2 = (DOM.apiKey2.value || '').trim();
  const k3 = (DOM.apiKey3.value || '').trim();
  const list = [];
  if (k1) list.push({ id: 1, key: k1 });
  if (k2) list.push({ id: 2, key: k2 });
  if (k3) list.push({ id: 3, key: k3 });
  return list;
}

function updateSettingsSummary() {
  const keys = getActiveApiKeys();
  const model = DOM.modelSelect.value || 'gemini-2.5-flash';
  const chunkSize = parseInt(DOM.chunkSizeInput.value, 10) || 12000;
  const keyStatus = keys.length === 0
    ? 'No API keys configured'
    : `${keys.length} active key(s) (Key ${keys.map(k => k.id).join(', ')})`;
  DOM.settingsSummary.textContent = `Model: ${model} | ${keyStatus} | Chunk: ${chunkSize.toLocaleString('en-US')} chars`;
}

function showError(msg) {
  DOM.errorMessage.textContent = msg;
  DOM.errorBanner.hidden = false;
  DOM.errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function hideError() {
  DOM.errorBanner.hidden = true;
  DOM.errorMessage.textContent = '';
}

function updateScriptCounts() {
  const text = DOM.scriptInput.value || '';
  const charLen = text.length;
  const words = countWords(text);
  const chunkSize = parseInt(DOM.chunkSizeInput.value, 10) || 12000;

  DOM.scriptCharCount.textContent = `Characters: ${charLen.toLocaleString('en-US')}`;
  DOM.scriptWordCount.textContent = `Words: ${words.toLocaleString('en-US')}`;

  if (charLen > 0) {
    const est = Math.max(1, Math.ceil(charLen / chunkSize));
    DOM.scriptChunksEstimate.textContent = `Estimated Chunks: ${est}`;
    DOM.scriptChunksEstimate.hidden = false;
    DOM.scriptChunkDivider.hidden = false;
  } else {
    DOM.scriptChunksEstimate.hidden = true;
    DOM.scriptChunkDivider.hidden = true;
  }
}

function updateStoryCounts() {
  const text = state.accumulatedStory || '';
  const charLen = text.length;
  const words = countWords(text);
  const paragraphs = countParagraphs(text);

  DOM.storyCharCount.textContent = `Characters: ${charLen.toLocaleString('en-US')}`;
  DOM.storyWordCount.textContent = `Words: ${words.toLocaleString('en-US')}`;
  DOM.storyParagraphsCount.textContent = `Paragraphs: ${paragraphs}`;

  const hasContent = charLen > 0;
  DOM.copyBtn.disabled = !hasContent || state.isGenerating;
  DOM.downloadBtn.disabled = !hasContent || state.isGenerating;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderStoryOutput() {
  if (!state.accumulatedStory.trim()) {
    DOM.storyOutput.innerHTML = '<p class="placeholder-text">Your generated Hindi story will appear here. Paste a script above and click "Generate Hindi Story".</p>';
    updateStoryCounts();
    return;
  }

  const rawParagraphs = state.accumulatedStory.split(/\n\s*\n/);
  const html = rawParagraphs
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${escapeHtml(p)}</p>`)
    .join('');

  DOM.storyOutput.innerHTML = html || `<p>${escapeHtml(state.accumulatedStory)}</p>`;
  updateStoryCounts();
}

function openSettings() {
  DOM.settingsBody.hidden = false;
  DOM.settingsToggle.setAttribute('aria-expanded', 'true');
  DOM.settingsToggleBtn.textContent = 'Close Settings';
  setStored(STORAGE_KEYS.SETTINGS_OPEN, 'true');
}

function closeSettings() {
  DOM.settingsBody.hidden = true;
  DOM.settingsToggle.setAttribute('aria-expanded', 'false');
  DOM.settingsToggleBtn.textContent = 'Open Settings';
  setStored(STORAGE_KEYS.SETTINGS_OPEN, 'false');
}

function toggleSettings() {
  if (DOM.settingsBody.hidden) {
    openSettings();
  } else {
    closeSettings();
  }
}

// Generate Story via Python Server-Sent Events Endpoint
async function startStoryGeneration() {
  hideError();

  const scriptText = DOM.scriptInput.value.trim();
  if (!scriptText) {
    showError('Please enter a video script or transcript to convert.');
    DOM.scriptInput.focus();
    return;
  }

  const keys = getActiveApiKeys();
  if (keys.length === 0) {
    showError('Please enter at least one valid Gemini API key in Settings.');
    openSettings();
    DOM.apiKey1.focus();
    return;
  }

  const model = DOM.modelSelect.value || 'gemini-2.5-flash';
  const chunkSize = parseInt(DOM.chunkSizeInput.value, 10) || 12000;
  const systemPrompt = DOM.systemPrompt.value.trim() || DEFAULT_SYSTEM_PROMPT;

  // Prepare UI state
  state.isGenerating = true;
  state.accumulatedStory = '';
  state.abortController = new AbortController();

  DOM.generateBtn.disabled = true;
  DOM.stopBtn.disabled = false;
  DOM.copyBtn.disabled = true;
  DOM.downloadBtn.disabled = true;
  DOM.progressContainer.hidden = false;
  DOM.progressBarFill.style.width = '0%';
  DOM.progressPercentText.textContent = '0%';
  DOM.progressStatusText.textContent = 'Initializing process...';
  DOM.progressDetailsText.textContent = '';
  renderStoryOutput();

  try {
    const response = await fetch('/api/generate_story', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        script: scriptText,
        keys: keys,
        model: model,
        chunk_size: chunkSize,
        system_prompt: systemPrompt
      }),
      signal: state.abortController.signal
    });

    if (!response.ok) {
      let errText = `Server error: HTTP ${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson && (errJson.error || errJson.message)) {
          errText = errJson.error || errJson.message;
        }
      } catch (_) {}
      throw new Error(errText);
    }

    // Stream SSE Response
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop(); // keep last incomplete line

      for (const block of lines) {
        const trimmed = block.trim();
        if (!trimmed.startsWith('data:')) continue;
        const jsonStr = trimmed.replace(/^data:\s*/, '').trim();
        if (!jsonStr) continue;

        try {
          const evt = JSON.parse(jsonStr);

          if (evt.type === 'init') {
            DOM.progressStatusText.textContent = `Generating ${evt.total_chunks} parts...`;
          } else if (evt.type === 'status') {
            DOM.progressStatusText.textContent = evt.text;
            if (evt.details) DOM.progressDetailsText.textContent = evt.details;
            if (evt.percent !== undefined) {
              DOM.progressBarFill.style.width = `${evt.percent}%`;
              DOM.progressPercentText.textContent = `${evt.percent}%`;
            }
          } else if (evt.type === 'chunk') {
            // Append chunk
            if (state.accumulatedStory) {
              state.accumulatedStory += '\n\n' + evt.text;
            } else {
              state.accumulatedStory = evt.text;
            }
            renderStoryOutput();

            if (evt.percent !== undefined) {
              DOM.progressBarFill.style.width = `${evt.percent}%`;
              DOM.progressPercentText.textContent = `${evt.percent}%`;
            }

            // Scroll result into view on first chunk
            if (evt.chunk_index === 0) {
              DOM.resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          } else if (evt.type === 'error') {
            throw new Error(evt.message);
          } else if (evt.type === 'done') {
            DOM.progressBarFill.style.width = '100%';
            DOM.progressPercentText.textContent = '100%';
            DOM.progressStatusText.textContent = `Story generated successfully! (${evt.total_chunks} parts total)`;
            DOM.progressDetailsText.textContent = 'All paragraphs formatted seamlessly in book narrative style.';
          }
        } catch (parseErr) {
          if (parseErr.message && !parseErr.message.includes('JSON')) {
            throw parseErr;
          }
        }
      }
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      DOM.progressStatusText.textContent = 'Process stopped by user.';
      DOM.progressDetailsText.textContent = 'Story generated so far is preserved below.';
    } else {
      showError(err.message || 'An unexpected error occurred while generating story.');
      DOM.progressStatusText.textContent = 'Generation encountered an error.';
      DOM.progressDetailsText.textContent = 'Please check the error notification above.';
    }
  } finally {
    state.isGenerating = false;
    state.abortController = null;
    DOM.generateBtn.disabled = false;
    DOM.stopBtn.disabled = true;
    updateStoryCounts();
  }
}

function stopStoryGeneration() {
  if (state.abortController) {
    state.abortController.abort();
  }
}

async function copyStoryToClipboard() {
  const story = state.accumulatedStory.trim();
  if (!story) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(story);
    } else {
      const ta = document.createElement('textarea');
      ta.value = story;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }

    const orig = DOM.copyBtn.textContent;
    DOM.copyBtn.textContent = 'Copied!';
    DOM.copyStatusMsg.textContent = 'Story copied to clipboard!';

    setTimeout(() => {
      DOM.copyBtn.textContent = orig;
      DOM.copyStatusMsg.textContent = '';
    }, 2500);
  } catch (err) {
    showError('Failed to copy to clipboard: ' + err.message);
  }
}

function downloadStoryFile() {
  const story = state.accumulatedStory.trim();
  if (!story) return;

  try {
    const blob = new Blob([story], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hindi_story.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    showError('Error downloading file: ' + err.message);
  }
}

async function loadSampleScript() {
  try {
    const res = await fetch('/api/sample_script');
    if (res.ok) {
      const data = await res.json();
      DOM.scriptInput.value = data.script || '';
      updateScriptCounts();
      hideError();
    }
  } catch (err) {
    showError('Failed to load sample script: ' + err.message);
  }
}

function initApp() {
  // Restore persisted values from localStorage
  DOM.apiKey1.value = getStored(STORAGE_KEYS.KEY_1, '');
  DOM.apiKey2.value = getStored(STORAGE_KEYS.KEY_2, '');
  DOM.apiKey3.value = getStored(STORAGE_KEYS.KEY_3, '');
  DOM.modelSelect.value = getStored(STORAGE_KEYS.MODEL, 'gemini-2.5-flash');
  DOM.chunkSizeInput.value = getStored(STORAGE_KEYS.CHUNK_SIZE, '12000');
  DOM.systemPrompt.value = getStored(STORAGE_KEYS.PROMPT, DEFAULT_SYSTEM_PROMPT);

  const keys = getActiveApiKeys();
  const settingsOpenStored = getStored(STORAGE_KEYS.SETTINGS_OPEN, null);
  if (settingsOpenStored === 'true' || (settingsOpenStored === null && keys.length === 0)) {
    openSettings();
  } else {
    closeSettings();
  }

  updateSettingsSummary();
  updateScriptCounts();
  updateStoryCounts();

  // Storage bindings
  DOM.apiKey1.addEventListener('input', () => {
    setStored(STORAGE_KEYS.KEY_1, DOM.apiKey1.value);
    updateSettingsSummary();
  });
  DOM.apiKey2.addEventListener('input', () => {
    setStored(STORAGE_KEYS.KEY_2, DOM.apiKey2.value);
    updateSettingsSummary();
  });
  DOM.apiKey3.addEventListener('input', () => {
    setStored(STORAGE_KEYS.KEY_3, DOM.apiKey3.value);
    updateSettingsSummary();
  });
  DOM.modelSelect.addEventListener('change', () => {
    setStored(STORAGE_KEYS.MODEL, DOM.modelSelect.value);
    updateSettingsSummary();
  });
  DOM.chunkSizeInput.addEventListener('input', () => {
    const val = parseInt(DOM.chunkSizeInput.value, 10);
    if (!isNaN(val) && val >= 1000) {
      setStored(STORAGE_KEYS.CHUNK_SIZE, String(val));
    }
    updateSettingsSummary();
    updateScriptCounts();
  });
  DOM.systemPrompt.addEventListener('input', () => {
    setStored(STORAGE_KEYS.PROMPT, DOM.systemPrompt.value);
  });

  // Settings Accordion
  DOM.settingsToggle.addEventListener('click', (e) => {
    if (e.target === DOM.settingsToggleBtn) return;
    toggleSettings();
  });
  DOM.settingsToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleSettings();
    }
  });
  DOM.settingsToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSettings();
  });
  DOM.closeSettingsBtn.addEventListener('click', () => {
    closeSettings();
  });

  // Password visibility
  document.querySelectorAll('[data-toggle-visibility]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-toggle-visibility');
      const input = document.getElementById(targetId);
      if (input) {
        if (input.type === 'password') {
          input.type = 'text';
          btn.textContent = 'Hide';
        } else {
          input.type = 'password';
          btn.textContent = 'Show';
        }
      }
    });
  });

  // Reset Prompt
  DOM.resetPromptBtn.addEventListener('click', () => {
    DOM.systemPrompt.value = DEFAULT_SYSTEM_PROMPT;
    setStored(STORAGE_KEYS.PROMPT, DEFAULT_SYSTEM_PROMPT);
  });

  // Script input
  DOM.scriptInput.addEventListener('input', () => {
    updateScriptCounts();
    hideError();
  });
  DOM.loadSampleBtn.addEventListener('click', loadSampleScript);
  DOM.clearScriptBtn.addEventListener('click', () => {
    DOM.scriptInput.value = '';
    updateScriptCounts();
  });
  DOM.errorDismissBtn.addEventListener('click', hideError);

  // Actions
  DOM.generateBtn.addEventListener('click', startStoryGeneration);
  DOM.stopBtn.addEventListener('click', stopStoryGeneration);
  DOM.copyBtn.addEventListener('click', copyStoryToClipboard);
  DOM.downloadBtn.addEventListener('click', downloadStoryFile);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
