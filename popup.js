// popup.js

document.addEventListener('DOMContentLoaded', async () => {
  const tabGenerate = document.getElementById('tab-generate');
  const tabHistory = document.getElementById('tab-history');
  const secGenerate = document.getElementById('section-generate');
  const secHistory = document.getElementById('section-history');
  
  const apiStatusBanner = document.getElementById('api-status-banner');
  const resumeSelect = document.getElementById('popup-resume-select');
  const modelSelect = document.getElementById('popup-model-select');
  const vacancyTextarea = document.getElementById('popup-vacancy-text');
  const customPromptTextarea = document.getElementById('popup-custom-prompt');
  const generateBtn = document.getElementById('generate-btn');
  
  const loaderContainer = document.getElementById('generation-loader');
  const resultContainer = document.getElementById('result-container');
  const resultTextarea = document.getElementById('result-text');
  const copyResultBtn = document.getElementById('copy-result-btn');
  const historyList = document.getElementById('history-list');
  const toast = document.getElementById('toast');
  const profileStatusBanner = document.getElementById('profile-status-banner');
  const profileStatusText = document.getElementById('profile-status-text');

  // Load configuration
  const storage = await chrome.storage.local.get(['geminiApiKey', 'resumes', 'preferredModel', 'availableModels', 'profileData']);
  const hasKey = !!storage.geminiApiKey;
  const resumes = storage.resumes || [];
  let preferredModel = storage.preferredModel || 'gemini-2.5-flash';
  let models = storage.availableModels || [];
  const profile = storage.profileData || null;

  // Render Profile status badge
  if (profile) {
    profileStatusBanner.classList.add('linked');
    profileStatusText.textContent = `Профиль: ${profile.name || 'Связан'} (${profile.phone || 'без тел.'}, ${profile.email || 'без email'})`;
  } else {
    profileStatusBanner.classList.remove('linked');
    profileStatusText.textContent = 'Профиль не привязан. Откройте hh.ru/profile/me для связывания.';
  }

  // API key configuration check
  if (hasKey) {
    apiStatusBanner.style.display = 'none';
    generateBtn.disabled = false;
  } else {
    apiStatusBanner.style.display = 'block';
    generateBtn.disabled = true;
  }

  // Populate Resumes
  resumes.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.title;
    resumeSelect.appendChild(opt);
  });

  // Populate Models helper
  function populateModels(modelsList, selectedModel) {
    modelSelect.innerHTML = '';
    const listToRender = modelsList.length > 0 ? modelsList : [
      { name: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
      { name: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }
    ];
    listToRender.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.textContent = m.displayName;
      if (m.name === selectedModel) {
        opt.selected = true;
      }
      modelSelect.appendChild(opt);
    });
  }

  // Render initial models list
  populateModels(models, preferredModel);

  // If availableModels is empty but API key is set, fetch models list dynamically
  if (hasKey && models.length === 0) {
    chrome.runtime.sendMessage({ type: 'FETCH_MODELS', key: storage.geminiApiKey }, (response) => {
      if (response && response.success && response.models && response.models.length > 0) {
        models = response.models;
        populateModels(models, preferredModel);
        chrome.storage.local.set({ availableModels: models });
      }
    });
  }

  // Save selected model on change so it persists
  modelSelect.addEventListener('change', async () => {
    const selectedModel = modelSelect.value;
    await chrome.storage.local.set({ preferredModel: selectedModel });
  });

  // Auto-scrape active tab if it's hh.ru
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && (tab.url.includes('hh.ru') || tab.url.includes('hh.ru/vacancy/'))) {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_VACANCY_DATA' }, (response) => {
        if (response && response.vacancyData) {
          const v = response.vacancyData;
          vacancyTextarea.value = `Вакансия: ${v.title || ''}\nКомпания: ${v.company || ''}\n\nОписание:\n${v.description || ''}`;
        }
      });
    }
  } catch (e) {
    console.error('Error contacting active tab:', e);
  }

  // Tabs Navigation
  tabGenerate.addEventListener('click', () => {
    tabGenerate.classList.add('active');
    tabHistory.classList.remove('active');
    secGenerate.classList.add('active');
    secHistory.classList.remove('active');
  });

  tabHistory.addEventListener('click', async () => {
    tabGenerate.classList.remove('active');
    tabHistory.classList.add('active');
    secGenerate.classList.remove('active');
    secHistory.classList.add('active');
    await loadHistory();
  });

  // Quick tags
  document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tagText = btn.getAttribute('data-text');
      const val = customPromptTextarea.value.trim();
      customPromptTextarea.value = val ? val + ' ' + tagText : tagText;
      customPromptTextarea.focus();
    });
  });

  // Toast helper
  function showToast(message = 'Текст скопирован!') {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  // Copy result action
  copyResultBtn.addEventListener('click', () => {
    resultTextarea.select();
    navigator.clipboard.writeText(resultTextarea.value);
    showToast();
  });

  // Generate action
  generateBtn.addEventListener('click', () => {
    const vacancyText = vacancyTextarea.value.trim();
    if (!vacancyText) {
      alert('Пожалуйста, укажите описание вакансии.');
      return;
    }

    generateBtn.disabled = true;
    loaderContainer.style.display = 'flex';
    resultContainer.style.display = 'none';

    // Get selected resume text
    let selectedResumeText = null;
    if (resumeSelect.value) {
      const selectedResume = resumes.find(r => r.id === resumeSelect.value);
      if (selectedResume) {
        selectedResumeText = selectedResume.text;
      }
    }

    const selectedModel = modelSelect.value;
    const customPrompt = customPromptTextarea.value.trim();

    // Prepare vacancy data structure
    const lines = vacancyText.split('\n');
    const titleLine = lines.find(l => l.startsWith('Вакансия:')) || '';
    const companyLine = lines.find(l => l.startsWith('Компания:')) || '';
    
    const vacancyData = {
      title: titleLine.replace('Вакансия:', '').trim() || 'Вакансия из формы',
      company: companyLine.replace('Компания:', '').trim() || '',
      description: vacancyText
    };

    chrome.runtime.sendMessage({
      type: 'GENERATE_LETTER',
      vacancyData,
      resumeData: selectedResumeText,
      customPrompt,
      model: selectedModel
    }, (response) => {
      generateBtn.disabled = false;
      loaderContainer.style.display = 'none';

      if (response && response.success) {
        resultTextarea.value = response.text;
        resultContainer.style.display = 'block';
        
        // Auto copy to clipboard
        navigator.clipboard.writeText(response.text);
        showToast('Письмо сгенерировано и скопировано!');
      } else {
        alert('Ошибка генерации: ' + (response ? response.error : 'Неизвестная ошибка'));
      }
    });
  });

  // History load
  async function loadHistory() {
    const historyStorage = await chrome.storage.local.get(['generationHistory']);
    const history = historyStorage.generationHistory || [];
    
    historyList.innerHTML = '';
    
    if (history.length === 0) {
      historyList.innerHTML = '<p class="empty-msg">История генераций пуста</p>';
      return;
    }

    history.forEach(item => {
      const card = document.createElement('div');
      card.className = 'history-card';
      
      const dateStr = new Date(item.date).toLocaleDateString() + ' ' + new Date(item.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      card.innerHTML = `
        <div class="history-card-header">
          <h4 class="history-card-title">${item.vacancyTitle} ${item.companyName ? `в ${item.companyName}` : ''}</h4>
          <span class="history-card-date">${dateStr}</span>
        </div>
        <div class="history-card-text">${item.letterText}</div>
        <div class="history-card-actions">
          <button class="btn-small copy-hist-btn" data-id="${item.id}">Скопировать</button>
        </div>
      `;
      
      card.querySelector('.copy-hist-btn').addEventListener('click', () => {
        navigator.clipboard.writeText(item.letterText);
        showToast();
      });
      
      historyList.appendChild(card);
    });
  }
});
