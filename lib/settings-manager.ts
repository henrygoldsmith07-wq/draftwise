/**
 * Settings Manager with preferences persistence
 */

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  fontSize: number;
  fontFamily: string;
  lineSpacing: number;
  autoSaveEnabled: boolean;
  autoSaveInterval: number; // seconds
  spellCheckEnabled: boolean;
  suggestOnTyping: boolean;
  notificationsEnabled: boolean;
  analyticsOptIn: boolean;
  editorWidth: number;
  sidebarCollapsed: boolean;
  lastActiveTab: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'system',
  fontSize: 16,
  fontFamily: '"Georgia", serif',
  lineSpacing: 1.6,
  autoSaveEnabled: true,
  autoSaveInterval: 30,
  spellCheckEnabled: true,
  suggestOnTyping: true,
  notificationsEnabled: true,
  analyticsOptIn: false,
  editorWidth: 800,
  sidebarCollapsed: false,
  lastActiveTab: 'write'
};

const SETTINGS_STORAGE_KEY = 'draftwise_user_settings';

/**
 * Get current settings
 */
export function getSettings(): UserSettings {
  const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
  
  if (!stored) {
    return DEFAULT_SETTINGS;
  }
  
  try {
    const parsed = JSON.parse(stored);
    
    // Merge with defaults for new settings
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (error) {
    console.error('Failed to parse settings:', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Update specific setting
 */
export function updateSetting<K extends keyof UserSettings>(
  key: K,
  value: UserSettings[K]
): void {
  const current = getSettings();
  const updated = { ...current, [key]: value };
  
  saveSettings(updated);
  
  // Apply immediate changes where possible
  applyThemeChange(updated.theme);
  
  // Emit change event
  dispatchSettingChangeEvent(key, value, updated[key]);
}

/**
 * Bulk update settings
 */
export function bulkUpdateSettings(updates: Partial<UserSettings>): void {
  const current = getSettings();
  const updated = { ...current, ...updates };
  
  saveSettings(updated);
  applyBulkChanges(updates);
}

/**
 * Save settings to localStorage
 */
function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

/**
 * Reset to default settings
 */
export function resetToDefaults(): void {
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
}

/**
 * Export settings as JSON
 */
export function exportSettings(): string {
  const settings = getSettings();
  return JSON.stringify(settings, null, 2);
}

/**
 * Import settings from JSON
 */
export function importSettings(json: string): void {
  try {
    const parsed = JSON.parse(json);
    
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Invalid settings format');
    }
    
    const validated: Partial<UserSettings> = {};
    
    Object.entries(parsed).forEach(([key, value]) => {
      if (Object.keys(DEFAULT_SETTINGS).includes(key)) {
        (validated as any)[key] = value;
      }
    });
    
    bulkUpdateSettings(validated);
  } catch (error) {
    console.error('Failed to import settings:', error);
    throw error;
  }
}

/**
 * Apply theme change
 */
function applyThemeChange(theme: 'light' | 'dark' | 'system'): void {
  const root = document.documentElement;
  
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', prefersDark);
  } else {
    root.classList.toggle('dark', theme === 'dark');
  }
}

/**
 * Apply bulk changes after saving
 */
function applyBulkChanges(changes: Partial<UserSettings>): void {
  const settings = getSettings();
  
  // Apply font changes
  if (changes.fontSize || changes.fontFamily) {
    const editorEl = document.querySelector('.editor-textarea') as HTMLElement;
    if (editorEl) {
      if (changes.fontSize) {
        editorEl.style.fontSize = `${changes.fontSize}px`;
      }
      if (changes.fontFamily) {
        editorEl.style.fontFamily = changes.fontFamily;
      }
    }
  }
  
  // Apply line spacing
  if (changes.lineSpacing) {
    const editorEl = document.querySelector('.editor-textarea') as HTMLElement;
    if (editorEl) {
      editorEl.style.lineHeight = String(changes.lineSpacing);
    }
  }
  
  // Apply width
  if (changes.editorWidth) {
    const containerEl = document.querySelector('.editor-container') as HTMLElement;
    if (containerEl) {
      containerEl.style.maxWidth = `${changes.editorWidth}px`;
    }
  }
}

/**
 * Dispatch custom event for settings changes
 */
function dispatchSettingChangeEvent<K extends keyof UserSettings>(
  key: K,
  oldValue: UserSettings[K],
  newValue: UserSettings[K]
): void {
  window.dispatchEvent(new CustomEvent('setting-changed', {
    detail: { key, oldValue, newValue }
  }));
}

/**
 * Subscribe to settings changes
 */
export function onSettingChange(
  callback: (event: CustomEvent<{
    key: keyof UserSettings;
    oldValue: any;
    newValue: any;
  }>) => void
): () => void {
  window.addEventListener('setting-changed', callback as EventListener);
  
  return () => {
    window.removeEventListener('setting-changed', callback as EventListener);
  };
}

/**
 * Check if specific setting has been modified
 */
export function isSettingModified<K extends keyof UserSettings>(
  key: K,
  currentValue: UserSettings[K]
): boolean {
  const defaultValue = DEFAULT_SETTINGS[key];
  return currentValue !== defaultValue;
}

/**
 * Get all modified settings
 */
export function getModifiedSettings(): Array<{
  key: keyof UserSettings;
  current: any;
  default: any;
}> {
  const current = getSettings();
  const modified: Array<{ key: keyof UserSettings; current: any; default: any }> = [];
  
  Object.keys(current).forEach((key) => {
    const typedKey = key as keyof UserSettings;
    if (current[typedKey] !== DEFAULT_SETTINGS[typedKey]) {
      modified.push({
        key: typedKey,
        current: current[typedKey],
        default: DEFAULT_SETTINGS[typedKey]
      });
    }
  });
  
  return modified;
}
