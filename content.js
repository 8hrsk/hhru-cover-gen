// content.js

// Keep track of parsed vacancy data
let currentVacancyData = null;

// Parse vacancy data if we are on a vacancy page
function parseVacancy() {
  if (!window.location.pathname.includes('/vacancy/')) return null;

  const titleEl = document.querySelector('[data-qa="vacancy-title"]') || document.querySelector('h1');
  const companyEl = document.querySelector('[data-qa="vacancy-company-name"]') || document.querySelector('.vacancy-company-name');
  const descEl = document.querySelector('[data-qa="vacancy-description"]') || document.querySelector('.vacancy-description');

  if (!titleEl) return null;

  const title = titleEl.innerText.trim();
  const company = companyEl ? companyEl.innerText.trim() : '';
  const description = descEl ? descEl.innerText.trim() : '';

  // Store in session storage of the page so it can be accessed during apply flow on the same tab
  const data = { title, company, description, url: window.location.href };
  sessionStorage.setItem('currentVacancyData', JSON.stringify(data));
  currentVacancyData = data;
  return data;
}

// Parse resume if we are on a resume page and save to chrome.storage
async function parseAndSaveResume() {
  if (!window.location.pathname.includes('/resume/')) return;

  const match = window.location.pathname.match(/\/resume\/([a-f0-9]+)/);
  const resumeId = match ? match[1] : null;
  if (!resumeId) return;

  // HH resume pages usually have a wrapper around the resume
  const resumeContainer = document.querySelector('.resume-wrapper') || document.querySelector('#HH-React-Root') || document.body;
  if (!resumeContainer) return;

  // We extract text, clean up triple-newlines/redundant whitespace to save space
  const rawText = resumeContainer.innerText;
  const cleanedText = rawText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n');

  // Simple validation to ensure it looks like a resume page
  if (cleanedText.includes('Резюме') || cleanedText.includes('Опыт работы')) {
    const titleEl = document.querySelector('[data-qa="resume-block-title-position"]') || 
                    document.querySelector('[data-qa="resume-title"]') || 
                    document.querySelector('h1') || 
                    document.querySelector('h2');
    const title = titleEl ? titleEl.innerText.trim() : 'Без названия';

    const storage = await chrome.storage.local.get(['resumes']);
    let resumes = storage.resumes || [];
    
    // Find index of existing resume with same ID
    const existingIndex = resumes.findIndex(r => r.id === resumeId);
    const newResume = {
      id: resumeId,
      title: title,
      text: cleanedText,
      updatedAt: new Date().toISOString()
    };

    if (existingIndex !== -1) {
      resumes[existingIndex] = newResume;
    } else {
      resumes.push(newResume);
    }

    await chrome.storage.local.set({ 
      resumes: resumes,
      lastParsedResume: cleanedText, // keeping for backward compatibility
      lastParsedResumeDate: new Date().toISOString() 
    });

    showResumeSavedNotification(title);
  }
}

function showResumeSavedNotification(resumeTitle) {
  // Check if notification already exists
  if (document.getElementById('gemini-resume-toast')) return;

  const toast = document.createElement('div');
  toast.id = 'gemini-resume-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: #10b981;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-family: sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 999999;
    transition: opacity 0.3s;
  `;
  toast.textContent = `✨ Резюме «${resumeTitle}» успешно сохранено!`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Check if we need to retrieve vacancy data from sessionStorage
function getVacancyData() {
  if (currentVacancyData) return currentVacancyData;
  const stored = sessionStorage.getItem('currentVacancyData');
  if (stored) {
    try {
      currentVacancyData = JSON.parse(stored);
      return currentVacancyData;
    } catch (e) {
      console.error(e);
    }
  }
  return null;
}

// Heuristically find the cover letter textarea
function findCoverLetterTextarea() {
  const selectors = [
    '[data-qa="vacancy-response-letter-input"]',
    'textarea[name="letter"]',
    'textarea.vacancy-response-letter-input',
    'textarea[placeholder*="сопроводительное"]',
    'textarea[placeholder*="Сопроводительное"]',
    'textarea[placeholder*="письмо"]'
  ];
  
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  
  // Heuristic search over all textareas
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    const name = (ta.getAttribute('name') || '').toLowerCase();
    const placeholder = (ta.getAttribute('placeholder') || '').toLowerCase();
    const qa = (ta.getAttribute('data-qa') || '').toLowerCase();
    const id = (ta.id || '').toLowerCase();
    const className = (ta.className || '').toLowerCase();
    
    if (name.includes('letter') || 
        name.includes('message') || 
        placeholder.includes('сопроводительн') || 
        qa.includes('letter') || 
        qa.includes('response') ||
        id.includes('letter') ||
        className.includes('letter')) {
      return ta;
    }
  }
  
  return null;
}

// Heuristically find the toggle button to open the cover letter input
function findToggleLetterButton() {
  const selectors = [
    '[data-qa="vacancy-response-letter-toggle"]',
    '.vacancy-response-letter-toggle'
  ];
  
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  
  // Heuristic search by text
  const buttons = document.querySelectorAll('button, span, a');
  for (const btn of buttons) {
    const text = btn.innerText.toLowerCase();
    if (text.includes('сопроводительное') && (text.includes('написать') || text.includes('добавить') || text.includes('составить'))) {
      return btn;
    }
  }
  return null;
}

// Inject button into hh.ru UI near the cover letter input area or the toggle button
function injectGeminiButton() {
  const textarea = findCoverLetterTextarea();
  
  if (textarea) {
    // If textarea exists, make sure we inject button next to it
    if (textarea.parentElement.querySelector('.gemini-btn-inject')) return;

    const button = createInjectButton();
    button.addEventListener('click', (e) => {
      e.preventDefault();
      openGenerationModal(textarea);
    });
    textarea.parentNode.insertBefore(button, textarea);
    return;
  }

  // If textarea is not visible, check for the toggle button
  const toggleBtn = findToggleLetterButton();
  if (toggleBtn) {
    if (toggleBtn.parentElement.querySelector('.gemini-btn-inject')) return;

    const button = createInjectButton();
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      // Click the toggle button to mount the textarea
      toggleBtn.click();
      
      // Wait for the textarea to be rendered in the DOM
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const newTextarea = findCoverLetterTextarea();
        if (newTextarea) {
          openGenerationModal(newTextarea);
          return;
        }
      }
      
      // If we couldn't find the textarea after clicking, try opening modal anyway
      openGenerationModal(null);
    });
    toggleBtn.parentNode.insertBefore(button, toggleBtn.nextSibling);
  }
}

function createInjectButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'gemini-btn-inject';
  button.innerHTML = `
    <svg viewBox="0 0 24 24">
      <path d="M12 2L14.85 9.15L22 12L14.85 14.85L12 22L9.15 14.85L2 12L9.15 9.15L12 2Z" />
    </svg>
    Составить сопроводительное с Gemini
  `;
  return button;
}

// Modal dialog creation and management
async function openGenerationModal(textareaEl) {
  // Remove existing modal if any
  const oldModal = document.getElementById('gemini-gen-modal');
  if (oldModal) oldModal.remove();

  const vacancy = getVacancyData() || { title: 'выбранную вакансию', company: '' };
  const storage = await chrome.storage.local.get(['resumes', 'geminiApiKey', 'preferredModel', 'availableModels']);

  const hasKey = !!storage.geminiApiKey;
  const resumes = storage.resumes || [];
  const models = storage.availableModels || [
    { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
    { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }
  ];
  const preferredModel = storage.preferredModel || 'gemini-2.5-flash';

  const overlay = document.createElement('div');
  overlay.id = 'gemini-gen-modal';
  overlay.className = 'gemini-modal-overlay';

  // Build Resume dropdown HTML
  let resumeSelectHTML = '';
  if (resumes.length > 0) {
    resumeSelectHTML = `
      <div class="gemini-field-group">
        <label for="gemini-resume-select">Выберите резюме</label>
        <select id="gemini-resume-select">
          ${resumes.map(r => `<option value="${r.id}">${r.title} (обновлено ${new Date(r.updatedAt).toLocaleDateString()})</option>`).join('')}
        </select>
      </div>
    `;
  } else {
    resumeSelectHTML = `
      <div class="gemini-resume-status" style="background: rgba(245, 158, 11, 0.1); border: 1px solid #f59e0b; padding: 10px; border-radius: 8px; font-size: 12px; color: #fbbf24; line-height: 1.4;">
        ⚠️ Резюме не найдено в памяти. Рекомендуется открыть ваше резюме на hh.ru, чтобы расширение его запомнило. Вы также можете сгенерировать письмо без резюме.
      </div>
    `;
  }

  // Build Model dropdown HTML
  const modelSelectHTML = `
    <div class="gemini-field-group">
      <label for="gemini-model-select">Модель ИИ</label>
      <select id="gemini-model-select">
        ${models.map(m => `<option value="${m.name}" ${m.name === preferredModel ? 'selected' : ''}>${m.displayName}</option>`).join('')}
      </select>
    </div>
  `;

  overlay.innerHTML = `
    <div class="gemini-modal-container">
      <div class="gemini-modal-header">
        <h3 class="gemini-modal-title">Генератор сопроводительных писем</h3>
        <button class="gemini-modal-close" id="gemini-close-btn">&times;</button>
      </div>

      <div class="gemini-error-banner" id="gemini-error-banner"></div>

      <div class="gemini-modal-body">
        <p style="margin: 0; font-size: 13px; color: #94a3b8; line-height: 1.4;">
          Создание письма для вакансии: <strong>${vacancy.title}</strong> ${vacancy.company ? `в компании <strong>${vacancy.company}</strong>` : ''}
        </p>

        ${!hasKey ? `
          <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; padding: 12px; border-radius: 8px; font-size: 13px; color: #f87171;">
            ⚠️ Вы не указали Gemini API Key в настройках расширения. 
            Пожалуйста, перейдите в параметры расширения и сохраните рабочий API-ключ.
          </div>
        ` : ''}

        ${resumeSelectHTML}
        ${modelSelectHTML}

        <div class="gemini-field-group">
          <label for="gemini-custom-prompt">Дополнительные пожелания к письму</label>
          <textarea id="gemini-custom-prompt" placeholder="Например: 'сделай упор на мой опыт с Python и Django', 'не пиши слишком официально', 'укажи, что готов к релокации'"></textarea>
          
          <div class="gemini-quick-tags">
            <button type="button" class="gemini-tag-btn" data-text="Сделай упор на мой стек технологий и практический опыт с ними.">🔥 Стек</button>
            <button type="button" class="gemini-tag-btn" data-text="Напиши очень кратко и лаконично (не более 3-4 предложений).">⚡ Кратко</button>
            <button type="button" class="gemini-tag-btn" data-text="Напиши сопроводительное письмо в строгом деловом стиле.">💼 Официально</button>
            <button type="button" class="gemini-tag-btn" data-text="Напиши сопроводительное письмо в дружелюбном, открытом стиле.">🤝 Дружелюбно</button>
          </div>
        </div>
      </div>

      <div class="gemini-modal-footer">
        <button class="gemini-modal-btn gemini-btn-cancel" id="gemini-cancel-btn">Отмена</button>
        <button class="gemini-modal-btn gemini-btn-submit" id="gemini-submit-btn" ${!hasKey ? 'disabled' : ''}>
          Сгенерировать письмо
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Close handlers
  const closeBtn = overlay.querySelector('#gemini-close-btn');
  const cancelBtn = overlay.querySelector('#gemini-cancel-btn');
  const submitBtn = overlay.querySelector('#gemini-submit-btn');
  const errorBanner = overlay.querySelector('#gemini-error-banner');
  const customPromptInput = overlay.querySelector('#gemini-custom-prompt');

  const closeModal = () => overlay.remove();

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });

  // Quick tags wiring
  overlay.querySelectorAll('.gemini-tag-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const textToAppend = btn.getAttribute('data-text');
      const currentValue = customPromptInput.value;
      if (currentValue) {
        customPromptInput.value = currentValue.trim() + ' ' + textToAppend;
      } else {
        customPromptInput.value = textToAppend;
      }
      customPromptInput.focus();
    });
  });

  // Form submit handler
  submitBtn.addEventListener('click', () => {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="gemini-loader"></span>Генерация...';
    errorBanner.style.display = 'none';

    const customPrompt = customPromptInput.value.trim();

    // Get selected resume text
    let selectedResumeText = null;
    const resumeSelect = overlay.querySelector('#gemini-resume-select');
    if (resumeSelect && resumes.length > 0) {
      const selectedId = resumeSelect.value;
      const foundResume = resumes.find(r => r.id === selectedId);
      if (foundResume) {
        selectedResumeText = foundResume.text;
      }
    }

    // Get selected model
    const modelSelect = overlay.querySelector('#gemini-model-select');
    const selectedModel = modelSelect ? modelSelect.value : preferredModel;

    chrome.runtime.sendMessage({
      type: 'GENERATE_LETTER',
      vacancyData: vacancy,
      resumeData: selectedResumeText,
      customPrompt: customPrompt,
      model: selectedModel
    }, (response) => {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Сгенерировать письмо';

      if (response && response.success) {
        console.log('Received text from background script, length:', response.text.length);
        console.log('Received text content:', response.text);
        const targetTextarea = textareaEl || findCoverLetterTextarea();
        if (targetTextarea) {
          try {
            // Bypass React state tracking
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            nativeSetter.call(targetTextarea, response.text);
            console.log('Bypassed React state tracking and set value. Textarea value length:', targetTextarea.value.length);
          } catch (e) {
            // Fallback for standard DOM
            targetTextarea.value = response.text;
            console.log('Fallback setter used. Textarea value length:', targetTextarea.value.length);
          }
          targetTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          // If we somehow still can't find a textarea, copy to clipboard as fallback
          navigator.clipboard.writeText(response.text);
          alert('Сопроводительное письмо скопировано в буфер обмена (поле ввода на странице не найдено).');
        }
        closeModal();
      } else {
        const errorMsg = response ? response.error : 'Неизвестная ошибка во время генерации';
        errorBanner.textContent = `Ошибка: ${errorMsg}`;
        errorBanner.style.display = 'block';
      }
    });
  });
}

// Listen for DOM changes to inject button
function observeDOM() {
  const observer = new MutationObserver(() => {
    injectGeminiButton();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Run once initially
  injectGeminiButton();
}

// Initialise
function init() {
  parseVacancy();
  parseAndSaveResume();
  observeDOM();
}

init();
// Also trigger parse on pushstate/popstate/SPA navigation changes
window.addEventListener('popstate', init);
// Observe location changes for SPA navigation
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    setTimeout(init, 1000); // Give DOM a moment to render
  }
}).observe(document, {subtree: true, childList: true});

// Listen to messages from the popup script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_VACANCY_DATA') {
    sendResponse({ vacancyData: getVacancyData() });
  }
  return true;
});

