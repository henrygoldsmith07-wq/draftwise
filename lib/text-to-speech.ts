/**
 * Text-to-Speech Integration for Reading Aloud
 */

export interface TTSOptions {
  rate?: number;      // Speed (0.5-2.0, default: 1.0)
  pitch?: number;     // Pitch (0-2, default: 1.0)
  volume?: number;    // Volume (0-1, default: 1.0)
  voice?: SpeechSynthesisVoice | null;
}

export interface TTSSpeakingState {
  isSpeaking: boolean;
  isPaused: boolean;
  currentText?: string;
  wordPosition?: number;
}

let synthesis: SpeechSynthesis | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let state: TTSSpeakingState = {
  isSpeaking: false,
  isPaused: false
};

const TTS_STATE_CHANGED_EVENT = 'tts-state-changed';

/**
 * Initialize speech synthesis
 */
export function initializeTTS(): {
  supported: boolean;
  availableVoices: SpeechSynthesisVoice[];
} {
  if (!('speechSynthesis' in window)) {
    return {
      supported: false,
      availableVoices: []
    };
  }
  
  synthesis = window.speechSynthesis;
  
  const voices = getAvailableVoices();
  
  console.log(`🔊 TTS initialized with ${voices.length} voices`);
  
  return {
    supported: true,
    availableVoices: voices
  };
}

/**
 * Get available voices
 */
export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!synthesis) {
    return [];
  }
  
  try {
    return synthesis.getVoices();
  } catch (error) {
    console.warn('Failed to get voices:', error);
    return [];
  }
}

/**
 * Speak text aloud
 */
export function speak(text: string, options: TTSOptions = {}): void {
  if (!synthesis) {
    initializeTTS();
  }
  
  if (!synthesis) {
    console.error('Speech synthesis not supported');
    return;
  }
  
  // Cancel any ongoing speech
  synthesis.cancel();
  
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Apply options
  if (options.rate !== undefined) {
    utterance.rate = options.rate;
  }
  if (options.pitch !== undefined) {
    utterance.pitch = options.pitch;
  }
  if (options.volume !== undefined) {
    utterance.volume = options.volume;
  }
  if (options.voice) {
    utterance.voice = options.voice;
  }
  
  // Event handlers
  utterance.onstart = () => {
    state = { ...state, isSpeaking: true, isPaused: false, currentText: text };
    updateState();
  };
  
  utterance.onend = () => {
    state = { isSpeaking: false, isPaused: false };
    currentUtterance = null;
    updateState();
  };
  
  utterance.onerror = (event) => {
    console.error('TTS Error:', event);
    state = { isSpeaking: false, isPaused: false };
    currentUtterance = null;
    updateState();
  };
  
  utterance.onboundary = (event) => {
    if (event.name === 'word') {
      state.wordPosition = event.charIndex ?? 0;
    }
  };
  
  currentUtterance = utterance;
  synthesis.speak(utterance);
  
  console.log('🗣️ Speaking:', text.substring(0, 50) + '...');
}

/**
 * Pause speaking
 */
export function pause(): void {
  if (!synthesis) return;
  
  if (synthesis.speaking && !synthesis.paused) {
    synthesis.pause();
    state = { ...state, isPaused: true };
    updateState();
    console.log('⏸️ Paused');
  }
}

/**
 * Resume speaking
 */
export function resume(): void {
  if (!synthesis) return;
  
  if (synthesis.paused) {
    synthesis.resume();
    state = { ...state, isPaused: false };
    updateState();
    console.log('▶️ Resumed');
  }
}

/**
 * Stop speaking
 */
export function stop(): void {
  if (!synthesis) return;
  
  synthesis.cancel();
  state = { isSpeaking: false, isPaused: false };
  currentUtterance = null;
  updateState();
  console.log('⏹️ Stopped');
}

/**
 * Toggle speaking state
 */
export function toggleSpeaking(text: string, options: TTSOptions = {}): void {
  if (state.isSpeaking && !state.isPaused) {
    pause();
  } else {
    speak(text, options);
  }
}

/**
 * Get current TTS state
 */
export function getState(): TTSSpeakingState {
  return { ...state };
}

/**
 * Set volume
 */
export function setVolume(volume: number): void {
  if (!synthesis) return;
  
  const utterance = currentUtterance;
  if (utterance) {
    utterance.volume = Math.max(0, Math.min(1, volume));
  }
}

/**
 * Set speaking rate
 */
export function setRate(rate: number): void {
  if (!synthesis) return;
  
  const utterance = currentUtterance;
  if (utterance) {
    utterance.rate = Math.max(0.5, Math.min(2.0, rate));
  }
}

/**
 * Set pitch
 */
export function setPitch(pitch: number): void {
  if (!synthesis) return;
  
  const utterance = currentUtterance;
  if (utterance) {
    utterance.pitch = Math.max(0, Math.min(2, pitch));
  }
}

/**
 * Select voice
 */
export function selectVoice(voiceName: string): boolean {
  if (!synthesis) return false;
  
  const voices = getAvailableVoices();
  const selectedVoice = voices.find(v => v.name === voiceName || v.lang.includes(voiceName));
  
  if (selectedVoice && currentUtterance) {
    currentUtterance.voice = selectedVoice;
    return true;
  }
  
  return false;
}

/**
 * Read selection from editor
 */
export function readSelection(editorElement: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection?.toString().trim()) {
    console.warn('No text selected');
    return;
  }
  
  speak(selection.toString());
  selection.removeAllRanges();
}

/**
 * Read entire document
 */
export function readDocument(text: string, options: TTSOptions = {}): void {
  // Chunk text for better control
  const sentences = splitIntoSentences(text);
  
  let currentIndex = 0;
  
  function readNextSentence() {
    if (currentIndex >= sentences.length) {
      stop();
      return;
    }
    
    if (!state.isSpeaking || state.isPaused) {
      return;
    }
    
    const sentence = sentences[currentIndex];
    
    // Create utterance with character boundary tracking
    const utterance = new SpeechSynthesisUtterance(sentence);
    utterance.rate = options.rate ?? 1.0;
    utterance.pitch = options.pitch ?? 1.0;
    utterance.volume = options.volume ?? 1.0;
    
    utterance.onend = () => {
      currentIndex++;
      setTimeout(readNextSentence, 300); // Small pause between sentences
    };
    
    currentUtterance = utterance;
    synthesis?.speak(utterance);
  }
  
  speak('', options);
  readNextSentence();
}

// Helper Functions

function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  return sentences.map(s => s.trim()).filter(s => s.length > 0);
}

function updateState(): void {
  window.dispatchEvent(new CustomEvent(TTS_STATE_CHANGED_EVENT, {
    detail: { ...state }
  }));
}

/**
 * Subscribe to TTS state changes
 */
export function onTTSStateChanged(
  callback: (event: CustomEvent<TTSSpeakingState>) => void
): () => void {
  window.addEventListener(TTS_STATE_CHANGED_EVENT, callback as EventListener);
  
  return () => {
    window.removeEventListener(TTS_STATE_CHANGED_EVENT, callback as EventListener);
  };
}

/**
 * Cleanup
 */
export function cleanupTTS(): void {
  stop();
  synthesis = null;
  currentUtterance = null;
  state = { isSpeaking: false, isPaused: false };
}

/**
 * Generate reading time estimate for TTS
 */
export function estimateTTSDuration(wordsPerMinute: number = 150): number {
  // Average speaking rate is 150 WPM
  return 60 / wordsPerMinute; // seconds per word
}

/**
 * Highlight text while speaking (visual feedback)
 */
export function createHighlightOverlay(element: HTMLElement): () => void {
  const ranges: Range[] = [];
  
  window.addEventListener('tts-state-changed', (event: CustomEvent<TTSSpeakingState>) => {
    // Remove previous highlights
    ranges.forEach(r => r.detach());
    ranges.length = 0;
    
    if (!element || !event.detail.currentText) {
      return;
    }
    
    // Find and highlight current position
    // This would require more complex implementation
    // For now, just a placeholder
  });
  
  // Return cleanup function
  return () => {
    ranges.forEach(r => r.detach());
  };
}
