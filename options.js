// options.js

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const modelSelect = document.getElementById('model');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const statusDiv = document.getElementById('status');

  // Load existing settings
  const storage = await chrome.storage.local.get(['geminiApiKey', 'preferredModel']);
  if (storage.geminiApiKey) {
    apiKeyInput.value = storage.geminiApiKey;
    // Dynamically load models
    await loadModels(storage.geminiApiKey, storage.preferredModel);
  }

  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status-message ${type}`;
    statusDiv.style.display = 'block';
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 5000);
  }

  async function loadModels(apiKey, selectedModel) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'FETCH_MODELS', key: apiKey }, (response) => {
        if (response && response.success && response.models && response.models.length > 0) {
          // Clear current options
          modelSelect.innerHTML = '';
          
          response.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.name;
            // Beautify names for popular models, fallback to displayName
            let displayName = model.displayName;
            if (model.name.includes('gemini-2.5-flash')) {
              displayName = `${displayName} (Рекомендуется, бесплатно)`;
            } else if (model.name.includes('gemini-2.5-pro')) {
              displayName = `${displayName} (Более умная, бесплатно)`;
            }
            option.textContent = displayName;
            if (model.name === selectedModel) {
              option.selected = true;
            }
            modelSelect.appendChild(option);
          });
        }
        resolve();
      });
    });
  }

  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const model = modelSelect.value;

    if (!apiKey) {
      showStatus('Пожалуйста, введите API-ключ', 'error');
      return;
    }

    await chrome.storage.local.set({
      geminiApiKey: apiKey,
      preferredModel: model
    });

    showStatus('Настройки успешно сохранены!', 'success');
  });

  testBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
      showStatus('Сначала введите API-ключ для проверки', 'error');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = 'Проверка...';

    chrome.runtime.sendMessage({ type: 'TEST_KEY', key: apiKey }, async (response) => {
      testBtn.disabled = false;
      testBtn.textContent = 'Проверить ключ';

      if (response && response.success) {
        showStatus('API-ключ верен и успешно проверен! Загружаем список доступных моделей...', 'success');
        await loadModels(apiKey, modelSelect.value);
      } else {
        const errorMsg = response ? response.error : 'Неизвестная ошибка';
        showStatus(`Ошибка проверки ключа: ${errorMsg}`, 'error');
      }
    });
  });
});
