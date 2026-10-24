/**
 * Voice Dictation API for speech-to-text functionality
 */

export interface DictationOptions {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: Error) => void;
  onStart?: () => void;
  onStop?: () => void;
}

export interface DictationStatus {
  isSupported: boolean;
  isListening: boolean;
  hasPermission: boolean | null;
  lastError: string | null;
}

let recognition: SpeechRecognition | null = null;
let currentCallbacks: DictationOptions = {};

/**
 * Initialize and configure speech recognition
 */
export function initializeDictation(options: DictationOptions = {}): DictationStatus {
  currentCallbacks = options;
  
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    return {
      isSupported: false,
      isListening: false,
      hasPermission: null,
      lastError: 'Browser does not support speech recognition'
    };
  }
  
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  
  recognition.continuous = options.continuous ?? true;
  recognition.interimResults = options.interimResults ?? true;
  recognition.lang = options.lang ?? 'en-US';
  
  setupListeners();
  
  return {
    isSupported: true,
    isListening: false,
    hasPermission: null,
    lastError: null
  };
}

/**
 * Check if browser supports speech recognition
 */
export function checkSupport(): DictationStatus {
  const supported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  
  return {
    isSupported: supported,
    isListening: recognition !== null && recognition.running,
    hasPermission: null,
    lastError: supported ? null : 'Browser does not support speech recognition'
  };
}

/**
 * Start listening for speech input
 */
export function startListening() {
  if (!recognition) {
    const status = checkSupport();
    if (!status.isSupported) {
      currentCallbacks.onError?.(new Error('Speech recognition not supported'));
      return;
    }
    initializeDictation(currentCallbacks);
  }
  
  try {
    recognition?.start();
    currentCallbacks.onStart?.();
  } catch (error) {
    console.error('Failed to start listening:', error);
    currentCallbacks.onError?.(error as Error);
  }
}

/**
 * Stop listening
 */
export function stopListening() {
  if (!recognition) return;
  
  try {
    recognition.stop();
    currentCallbacks.onStop?.();
  } catch (error) {
    console.error('Failed to stop listening:', error);
    currentCallbacks.onError?.(error as Error);
  }
}

/**
 * Toggle listening state
 */
export function toggleListening(): boolean {
  if (recognition?.running) {
    stopListening();
    return false;
  } else {
    startListening();
    return true;
  }
}

/**
 * Change language
 */
export function changeLanguage(lang: string) {
  if (!recognition) return;
  
  recognition.lang = lang;
}

/**
 * Setup event listeners
 */
function setupListeners() {
  if (!recognition) return;
  
  recognition.onresult = (event: SpeechRecognitionEvent) => {
    let finalTranscript = '';
    let interimTranscript = '';
    
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript + ' ';
      } else {
        interimTranscript += transcript;
      }
    }
    
    if (finalTranscript) {
      currentCallbacks.onResult?.(finalTranscript.trim(), true);
    }
    
    if (interimTranscript) {
      currentCallbacks.onResult?.(interimTranscript.trim(), false);
    }
  };
  
  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    const error = new Error(getErrorMessage(event.error));
    currentCallbacks.onError?.(error);
  };
  
  recognition.onend = () => {
    // If continuous mode and stopped unexpectedly, restart
    if (currentCallbacks.continuous !== false && !recognition?.running) {
      try {
        recognition?.start();
      } catch (e) {
        // Already stopped or other issue
      }
    }
  };
}

function getErrorMessage(error: string): string {
  switch (error) {
    case 'no-speech':
      return 'No speech detected. Please try speaking again.';
    case 'audio-capture':
      return 'No microphone found. Ensure microphone is connected.';
    case 'no-match':
      return 'No match found. Try speaking something different.';
    default:
      return `Speech recognition error: ${error}`;
  }
}

/**
 * Get list of supported languages
 */
export function getSupportedLanguages(): Array<{ code: string; name: string }> {
  return [
    { code: 'en-US', name: 'English (US)' },
    { code: 'en-GB', name: 'English (UK)' },
    { code: 'es-ES', name: 'Spanish' },
    { code: 'fr-FR', name: 'French' },
    { code: 'de-DE', name: 'German' },
    { code: 'it-IT', name: 'Italian' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)' },
    { code: 'ru-RU', name: 'Russian' },
    { code: 'ja-JP', name: 'Japanese' },
    { code: 'zh-CN', name: 'Chinese (Mandarin)' },
    { code: 'ko-KR', name: 'Korean' },
    { code: 'ar-SA', name: 'Arabic' },
    { code: 'hi-IN', name: 'Hindi' }
  ];
}

/**
 * Cleanup
 */
export function cleanupDictation() {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
}
