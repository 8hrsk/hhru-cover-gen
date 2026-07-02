// background.js
importScripts('prompts.js');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GENERATE_LETTER') {
    generateCoverLetter(message.vacancyData, message.resumeData, message.customPrompt, message.model)
      .then(result => sendResponse({ success: true, text: result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'TEST_KEY') {
    testApiKey(message.key)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'FETCH_MODELS') {
    fetchModels(message.key)
      .then(models => sendResponse({ success: true, models }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function testApiKey(key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Hello" }] }]
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
  }
}

async function generateCoverLetter(vacancyData, resumeData, customPrompt, selectedModel) {
  const storage = await chrome.storage.local.get(['geminiApiKey', 'preferredModel', 'candidateName']);
  const apiKey = storage.geminiApiKey;
  const model = selectedModel || storage.preferredModel || 'gemini-2.5-flash';
  const candidateName = storage.candidateName || '';

  if (!apiKey) {
    throw new Error('API key is not configured. Please set it in extension options.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const prompt = `
Данные о вакансии:
- Название: ${vacancyData.title || 'Не указано'}
- Компания: ${vacancyData.company || 'Не указана'}
- Описание/Требования: ${vacancyData.description || 'Не указано'}

Данные о резюме кандидата:
${resumeData ? `- Текст резюме: ${resumeData}` : 'Резюме не предоставлено. Напиши общее вежливое сопроводительное письмо на основе вакансии.'}

Имя кандидата для подписи в письме (если указано, используй его для подписи в конце): ${candidateName || 'Не указано'}

Дополнительные пожелания пользователя:
${customPrompt || 'Нет дополнительных пожеланий.'}

Напиши сопроводительное письмо. Верни ТОЛЬКО текст письма, без каких-либо вводных фраз вроде "Вот ваше сопроводительное письмо:" или оформления разметки markdown (пиши обычным текстом с абзацами).
`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [{ text: MASTER_SYSTEM_INSTRUCTION }]
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 8192
      }
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  console.log('Gemini API Response Status:', response.status);
  console.log('Gemini API Full Candidate Data:', JSON.stringify(data.candidates?.[0]));
  
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error('No response content from Gemini API. Check console for details.');
  }
  const text = parts.map(p => p.text || '').join('');
  console.log('Merged generated text length:', text.length);
  console.log('Merged generated text content:', text);
  
  const trimmedText = text.trim();

  // Save to generation history (max 5 items)
  try {
    const historyStorage = await chrome.storage.local.get(['generationHistory']);
    let history = historyStorage.generationHistory || [];
    history.unshift({
      id: Date.now().toString(),
      vacancyTitle: vacancyData.title || 'Неизвестная вакансия',
      companyName: vacancyData.company || '',
      letterText: trimmedText,
      date: new Date().toISOString()
    });
    if (history.length > 5) {
      history = history.slice(0, 5);
    }
    await chrome.storage.local.set({ generationHistory: history });
  } catch (e) {
    console.error('Error saving history:', e);
  }

  return trimmedText;
}

async function fetchModels(key) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
  const response = await fetch(url);
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
  }
  const data = await response.json();
  // Filter models that support generateContent and are user-facing text models (like Gemini)
  return (data.models || [])
    .filter(m => m.supportedGenerationMethods.includes('generateContent') && m.name.includes('gemini'))
    .map(m => ({
      name: m.name.replace('models/', ''),
      displayName: m.displayName || m.name
    }));
}

