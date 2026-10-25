/**
 * Voice Command Control System
 * Hands-free document control through speech recognition
 */

export interface VoiceCommand {
  id: string;
  pattern: RegExp;
  description: string;
  handler: (args: string[]) => Promise<void>;
}

export interface VoiceControlState {
  isListening: boolean;
  lastCommand: string | null;
  commandsExecuted: number;
  error?: string;
}

interface VoiceRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
}

let recognition: VoiceRecognition | null = null;
let state: VoiceControlState = {
  isListening: false,
  lastCommand: null,
  commandsExecuted: 0
};
let registeredCommands: Map<string, VoiceCommand> = new Map();
let eventListeners: Array<(event: CustomEvent) => void> = [];

/**
 * Initialize voice command system
 */
export function initializeVoiceControl(): { supported: boolean } {
  const SpeechRecognition = (window as any).SpeechRecognition || 
                            (window as any).webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    console.warn('❌ Voice control not supported in this browser');
    return { supported: false };
  }
  
  try {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    
    setupRecognitionListeners();
    registerDefaultCommands();
    
    console.log('🎤 Voice control initialized successfully');
    return { supported: true };
  } catch (error) {
    console.error('Failed to initialize voice control:', error);
    return { supported: false };
  }
}

/**
 * Register a voice command
 */
export function registerCommand(command: VoiceCommand): void {
  registeredCommands.set(command.id, command);
  console.log(`✅ Registered voice command: ${command.description}`);
}

/**
 * Unregister a command
 */
export function unregisterCommand(commandId: string): boolean {
  return registeredCommands.delete(commandId);
}

/**
 * Start listening for voice commands
 */
export function startListening(): void {
  if (!recognition) {
    initializeVoiceControl();
  }
  
  if (recognition && !state.isListening) {
    try {
      recognition.start();
      state.isListening = true;
      updateState({});
      
      window.dispatchEvent(new CustomEvent('voice-control-started'));
    } catch (error) {
      handleError(error as Error);
    }
  }
}

/**
 * Stop listening
 */
export function stopListening(): void {
  if (recognition && state.isListening) {
    recognition.stop();
    state.isListening = false;
    updateState({});
    
    window.dispatchEvent(new CustomEvent('voice-control-stopped'));
  }
}

/**
 * Toggle listening state
 */
export function toggleListening(): boolean {
  if (state.isListening) {
    stopListening();
    return false;
  } else {
    startListening();
    return true;
  }
}

/**
 * Get current state
 */
export function getState(): VoiceControlState {
  return { ...state };
}

/**
 * Subscribe to events
 */
export function subscribeToEvents(
  callback: (event: CustomEvent<{ type: string; data?: any }>) => void
): () => void {
  eventListeners.push(callback);
  
  return () => {
    eventListeners = eventListeners.filter(cb => cb !== callback);
  };
}

// Default Commands Registry

function registerDefaultCommands(): void {
  // Basic navigation
  registerCommand({
    id: 'go-home',
    pattern: /home|back to home/i,
    description: 'Navigate to home view',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('navigation', { detail: { target: 'home' } }));
    }
  });
  
  registerCommand({
    id: 'go-write',
    pattern: /write|start writing|open editor/i,
    description: 'Open writing editor',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('navigation', { detail: { target: 'write' } }));
    }
  });
  
  // Document operations
  registerCommand({
    id: 'new-document',
    pattern: /new (document|draft)|create new|start new/i,
    description: 'Create new document',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'newDocument' } }));
    }
  });
  
  registerCommand({
    id: 'save-document',
    pattern: /save|save this|store document/i,
    description: 'Save current document',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'saveDocument' } }));
    }
  });
  
  registerCommand({
    id: 'load-document',
    pattern: /open|load (document|file)|bring up/i,
    description: 'Load existing document',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'loadDocument' } }));
    }
  });
  
  // Text editing
  registerCommand({
    id: 'select-all',
    pattern: /select all|i want everything/i,
    description: 'Select all text',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'selectAll' } }));
    }
  });
  
  registerCommand({
    id: 'delete-selection',
    pattern: /delete|remove|get rid of|erase this/i,
    description: 'Delete selected text',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'deleteSelection' } }));
    }
  });
  
  // Formatting
  registerCommand({
    id: 'bold-text',
    pattern: /make bold|bold this|strong/i,
    description: 'Apply bold formatting',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'applyBold' } }));
    }
  });
  
  registerCommand({
    id: 'italic-text',
    pattern: /make italic|italicize|emphasize/i,
    description: 'Apply italic formatting',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'applyItalic' } }));
    }
  });
  
  // Search and navigation
  registerCommand({
    id: 'find-text',
    pattern: /find|search for|look for|locate/i,
    description: 'Open search dialog',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'openSearch' } }));
    }
  });
  
  // Assistant help
  registerCommand({
    id: 'help',
    pattern: /help|what can you do|commands|assistant/i,
    description: 'Show help information',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'showHelp' } }));
    }
  });
  
  // Read aloud
  registerCommand({
    id: 'read-aloud',
    pattern: /read aloud|read this|speak out|tell me/i,
    description: 'Read text aloud using TTS',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'readAloud' } }));
    }
  });
  
  // Focus mode
  registerCommand({
    id: 'zen-mode',
    pattern: /zen mode|focus mode|full screen|immersive/i,
    description: 'Enter Zen/distraction-free mode',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'toggleZenMode' } }));
    }
  });
  
  // Settings
  registerCommand({
    id: 'settings',
    pattern: /settings|preferences|config|options/i,
    description: 'Open settings panel',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'openSettings' } }));
    }
  });
  
  // Copy/Paste
  registerCommand({
    id: 'copy-text',
    pattern: /copy|copy this|duplicate/i,
    description: 'Copy selected text',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'copyText' } }));
    }
  });
  
  registerCommand({
    id: 'paste-text',
    pattern: /paste|insert from clipboard/i,
    description: 'Paste from clipboard',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'pasteText' } }));
    }
  });
  
  // Undo/Redo
  registerCommand({
    id: 'undo',
    pattern: /undo|last change|went wrong/back|take back/i,
    description: 'Undo last action',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'undo' } }));
    }
  });
  
  registerCommand({
    id: 'redo',
    pattern: /redo|redo that|try again/revert undo|do again/i,
    description: 'Redo last undone action',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'redo' } }));
    }
  });
  
  // Paragraphs
  registerCommand({
    id: 'new-paragraph',
    pattern: /new paragraph|line break|start new line|next paragraph/i,
    description: 'Insert paragraph break',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'insertParagraph' } }));
    }
  });
  
  // Clear selection
  registerCommand({
    id: 'clear-selection',
    pattern: /clear selection|deselect|unselect|cancel selection/i,
    description: 'Clear current selection',
    handler: async () => {
      window.dispatchEvent(new CustomEvent('action', { detail: { name: 'clearSelection' } }));
    }
  });
  
  console.log(`📋 Registered ${registeredCommands.size} voice commands`);
}

// Recognition Event Handlers

function setupRecognitionListeners(): void {
  if (!recognition) return;
  
  recognition.onresult = (event: any) => {
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
    
    // Process final transcripts
    if (finalTranscript.trim()) {
      processCommand(finalTranscript);
    }
    
    // Log interim for UI feedback
    if (interimTranscript.trim()) {
      window.dispatchEvent(new CustomEvent('voice-interim', { 
        detail: { transcript: interimTranscript } 
      }));
    }
  };
  
  recognition.onerror = (event: any) => {
    handleError(event.error || 'Unknown error');
  };
  
  recognition.onend = () => {
    // Auto-restart if still enabled
    if (state.isListening) {
      try {
        recognition?.start();
      } catch (e) {
        // Already running or other issue
      }
    }
  };
}

// Command Processing

async function processCommand(transcript: string): Promise<void> {
  const lowerTranscript = transcript.toLowerCase().trim();
  
  console.log(`🎯 Processing command: "${transcript}"`);
  
  let matchedCommand: VoiceCommand | null = null;
  let matchArgs: string[] = [];
  
  // Try each registered command
  for (const command of registeredCommands.values()) {
    const match = lowerTranscript.match(command.pattern);
    
    if (match) {
      matchedCommand = command;
      matchArgs = match.slice(1); // Capture groups
      
      break;
    }
  }
  
  if (matchedCommand) {
    try {
      await matchedCommand.handler(matchArgs);
      state.commandsExecuted++;
      state.lastCommand = transcript;
      updateState({ success: true });
      
      window.dispatchEvent(new CustomEvent('voice-command-executed', {
        detail: { 
          commandId: matchedCommand.id,
          description: matchedCommand.description,
          args: matchArgs 
        }
      }));
    } catch (error) {
      console.error('Command execution failed:', error);
      handleError(error as Error);
    }
  } else {
    // No matching command found
    handleNotFound(transcript);
  }
}

// State Management

function updateState(extra: Partial<VoiceControlState> = {}): void {
  state = { ...state, ...extra };
  window.dispatchEvent(new CustomEvent('voice-state-changed', { 
    detail: { ...state } 
  }));
}

function handleError(error: Error): void {
  state.error = error.message;
  state.isListening = false;
  updateState({});
  
  window.dispatchEvent(new CustomEvent('voice-error', { detail: { error: error.message } }));
}

function handleNotFound(transcript: string): void {
  console.log(`❌ No matching command for: "${transcript}"`);
  
  window.dispatchEvent(new CustomEvent('voice-not-found', { 
    detail: { transcript } 
  }));
}

// Utility Functions

/**
 * List all available commands
 */
export function listAvailableCommands(): Array<{
  id: string;
  description: string;
  pattern: string;
}> {
  return Array.from(registeredCommands.entries()).map(([id, cmd]) => ({
    id,
    description: cmd.description,
    pattern: cmd.pattern.source
  }));
}

/**
 * Get usage statistics
 */
export function getStats(): {
  commandsRegistered: number;
  totalExecutions: number;
  lastSuccessfulCommand?: string;
} {
  return {
    commandsRegistered: registeredCommands.size,
    totalExecutions: state.commandsExecuted,
    lastSuccessfulCommand: state.lastCommand || undefined
  };
}

/**
 * Change recognition language
 */
export function changeLanguage(lang: string): void {
  if (recognition) {
    recognition.lang = lang;
    console.log(`🌐 Language changed to: ${lang}`);
  }
}

/**
 * Reset voice control system
 */
export function resetVoiceControl(): void {
  stopListening();
  registeredCommands.clear();
  eventListeners = [];
  state = { isListening: false, lastCommand: null, commandsExecuted: 0 };
  
  registerDefaultCommands();
}
