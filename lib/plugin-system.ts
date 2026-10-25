/**
 * Plugin Architecture System for DraftWise Extensibility
 * Enables third-party extensions, custom hooks, and modular functionality
 */

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license?: string;
  homepage?: string;
}

export interface DraftWisePlugin {
  metadata: PluginMetadata;
  enabled: boolean;
  
  // Hooks (like React hooks but for plugin system)
  hooks: {
    onDraftChange?: (draft: string) => string | null;
    onDraftLoaded?: (draft: string, options?: any) => void;
    onExportBegin?: (format: ExportFormat) => void;
    onExportComplete?: (format: ExportFormat, blob: Blob) => void;
    onAnalysisBegin?: (text: string) => void;
    onAnalysisComplete?: (suggestions: AISuggestion[], text: string) => void;
    onSaveBegin?: () => void;
    onSaveComplete?: (success: boolean, error?: Error) => void;
    onSettingsChanged?: (settings: any) => void;
  };
  
  // UI Components
  uiComponents?: {
    topBarRight?: React.ComponentType<any>;
    sidebarLeft?: React.ComponentType<any>;
    editorToolbar?: React.ComponentType<any>;
    documentDashboard?: React.ComponentType<any>;
  };
  
  // Theme customization
  theme?: {
    colors?: Record<string, string>;
    overrides?: string[];
  };
  
  // Keyboard shortcuts
  keyboardShortcuts?: Array<{
    key: string;
    modifier: 'ctrl' | 'shift' | 'alt' | 'cmd';
    handler: () => void;
    description: string;
  }>;
  
  // Custom commands/actions
  actions?: {
    id: string;
    label: string;
    icon?: string;
    action: () => void;
  }[];
}

export type ExportFormat = 'pdf' | 'docx' | 'epub' | 'markdown' | 'text' | 'html' | 'json' | 'xml';
export type AISuggestion = any; // Import from actual types
export type EditorState = any;

// Global plugin registry
const PLUGINS: Map<string, DraftWisePlugin> = new Map();
const PLUGIN_HOOKS: Map<keyof DraftWisePlugin['hooks'], Array<(value: any) => any>> = new Map();

/**
 * Register a plugin in the system
 */
export function registerPlugin(plugin: DraftWisePlugin): void {
  if (PLUGINS.has(plugin.metadata.id)) {
    console.warn(`Plugin ${plugin.metadata.name} already registered`);
    return;
  }
  
  PLUGINS.set(plugin.metadata.id, plugin);
  
  // Register hooks
  if (plugin.hooks) {
    Object.entries(plugin.hooks).forEach(([hookName, callback]) => {
      const typedHook = hookName as keyof DraftWisePlugin['hooks'];
      
      if (callback && !PLUGIN_HOOKS.has(typedHook)) {
        PLUGIN_HOOKS.set(typedHook, []);
      }
      
      if (callback && PLUGIN_HOOKS.has(typedHook)) {
        PLUGIN_HOOKS.get(typedHook)?.push(callback);
      }
    });
  }
  
  console.log(`✅ Plugin "${plugin.metadata.name}" v${plugin.metadata.version} registered`);
}

/**
 * Unregister a plugin
 */
export function unregisterPlugin(pluginId: string): void {
  const plugin = PLUGINS.get(pluginId);
  
  if (!plugin) {
    console.warn(`Plugin ${pluginId} not found`);
    return;
  }
  
  PLUGINS.delete(pluginId);
  
  // Remove hooks
  if (plugin.hooks) {
    Object.entries(plugin.hooks).forEach(([hookName]) => {
      const typedHook = hookName as keyof DraftWisePlugin['hooks'];
      
      if (PLUGIN_HOOKS.has(typedHook)) {
        const callbacks = PLUGIN_HOOKS.get(typedHook)!;
        const pluginCallbackIndex = callbacks.findIndex(
          cb => Object.values(plugin.hooks!).includes(cb)
        );
        
        if (pluginCallbackIndex >= 0) {
          callbacks.splice(pluginCallbackIndex, 1);
        }
      }
    });
  }
  
  console.log(`❌ Plugin "${plugin.metadata.name}" unregistered`);
}

/**
 * Enable a plugin
 */
export function enablePlugin(pluginId: string): void {
  const plugin = PLUGINS.get(pluginId);
  
  if (!plugin) {
    console.error(`Plugin ${pluginId} not found`);
    return;
  }
  
  plugin.enabled = true;
  console.log(`🟢 Plugin "${plugin.metadata.name}" enabled`);
}

/**
 * Disable a plugin
 */
export function disablePlugin(pluginId: string): void {
  const plugin = PLUGINS.get(pluginId);
  
  if (!plugin) {
    console.error(`Plugin ${pluginId} not found`);
    return;
  }
  
  plugin.enabled = false;
  console.log(`🔴 Plugin "${plugin.metadata.name}" disabled`);
}

/**
 * Get all registered plugins
 */
export function getAllPlugins(): DraftWisePlugin[] {
  return Array.from(PLUGINS.values()).filter(p => p.enabled);
}

/**
 * Get a specific plugin by ID
 */
export function getPlugin(pluginId: string): DraftWisePlugin | undefined {
  return PLUGINS.get(pluginId);
}

/**
 * Execute a plugin hook with value
 */
export async function executeHook<T>(
  hookName: keyof DraftWisePlugin['hooks'],
  value: T,
  options?: { stopOnError?: boolean }
): Promise<T | null> {
  const callbacks = PLUGIN_HOOKS.get(hookName);
  
  if (!callbacks || callbacks.length === 0) {
    return value;
  }
  
  let result = value;
  
  for (const callback of callbacks) {
    try {
      const callbackResult = await callback(result);
      if (callbackResult !== undefined) {
        result = callbackResult as T;
      }
    } catch (error) {
      console.error(`Error executing hook ${hookName}:`, error);
      
      if (options?.stopOnError) {
        return null;
      }
    }
  }
  
  return result;
}

/**
 * Hook examples and usage patterns
 */

/**
 * Example: Create a plugin that adds statistics to every draft
 */
export function createStatisticsPlugin(): DraftWisePlugin {
  return {
    metadata: {
      id: 'statistics-plugin',
      name: 'Document Statistics',
      version: '1.0.0',
      description: 'Adds real-time word count and character analysis',
      author: 'DraftWise Team',
      license: 'MIT'
    },
    enabled: false,
    hooks: {
      onDraftChange: (draft) => {
        const words = draft.trim().split(/\s+/).filter(w => w.length > 0).length;
        const chars = draft.length;
        const sentences = draft.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
        
        console.log(`📊 Stats: ${words} words, ${chars} chars, ${sentences} sentences`);
        return draft;
      },
      
      onExportBegin: (format) => {
        console.log(`📤 Exporting to ${format}...`);
      },
      
      onSaveComplete: (success, error) => {
        if (success) {
          console.log('💾 Save successful');
        } else {
          console.error('💾 Save failed:', error);
        }
      }
    },
    
    uiComponents: {
      editorToolbar: ({ state }) => {
        // Custom toolbar component
        return (
          <div className="statistics-toolbar">
            <span>Words: {state.wordCount}</span>
            <span>Chars: {state.charCount}</span>
          </div>
        );
      }
    },
    
    theme: {
      colors: {
        '--plugin-stats-color': '#4CAF50',
        '--plugin-bg': '#f5f5f5'
      }
    },
    
    actions: [
      {
        id: 'count-words',
        label: 'Count Words Manually',
        icon: '📝',
        action: () => {
          console.log('Manual word count triggered');
        }
      }
    ]
  };
}

/**
 * Example: Create a plugin that enforces style guidelines
 */
export function createStyleEnforcerPlugin(): DraftWisePlugin {
  return {
    metadata: {
      id: 'style-enforcer',
      name: 'Style Enforcer',
      version: '1.0.0',
      description: 'Ensures writing follows specific style guidelines',
      author: 'Custom',
      license: 'MIT'
    },
    enabled: true,
    hooks: {
      onDraftChange: (draft) => {
        // Block certain words/phrases
        const prohibitedWords = ['utilize', 'implement', 'navigate'];
        const lowerDraft = draft.toLowerCase();
        
        const violations = prohibitedWords.filter(word => 
          lowerDraft.includes(word)
        );
        
        if (violations.length > 0) {
          console.warn('🚫 Style violation detected:', violations);
          
          // You could potentially auto-correct or warn user
          // For now, just log warnings
        }
        
        return draft;
      }
    }
  };
}

/**
 * Example: Create a plugin that integrates with external API
 */
export function createAPIDraftSyncPlugin(options: {
  apiUrl: string;
  authToken: string;
}): DraftWisePlugin {
  return {
    metadata: {
      id: 'api-draft-sync',
      name: 'Cloud Sync',
      version: '1.0.0',
      description: 'Synchronizes drafts with external cloud service',
      author: 'User',
      license: 'MIT'
    },
    enabled: false,
    hooks: {
      onSaveComplete: async (success, error) => {
        if (success) {
          try {
            // Sync to cloud
            const response = await fetch(`${options.apiUrl}/sync`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${options.authToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ synced: true })
            });
            
            if (!response.ok) {
              throw new Error('Cloud sync failed');
            }
          } catch (err) {
            console.error('Failed to sync to cloud:', err);
          }
        }
      }
    }
  };
}

/**
 * Validate plugin before registration
 */
export function validatePlugin(plugin: DraftWisePlugin): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Required fields
  if (!plugin.metadata.id) {
    errors.push('Missing plugin ID');
  }
  if (!plugin.metadata.name) {
    errors.push('Missing plugin name');
  }
  if (!plugin.metadata.version) {
    errors.push('Missing version');
  }
  
  // Version format validation (semver-ish)
  if (!/^\d+\.\d+\.\d+$/.test(plugin.metadata.version)) {
    errors.push('Invalid version format (use semantic versioning: X.Y.Z)');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * List all installed plugins
 */
export function listPlugins(): Array<{
  metadata: PluginMetadata;
  enabled: boolean;
  hooks: number;
}> {
  return Array.from(PLUGINS.values()).map(plugin => ({
    metadata: plugin.metadata,
    enabled: plugin.enabled,
    hooks: Object.keys(plugin.hooks || {}).length
  }));
}

/**
 * Plugin manifest loader (for external plugins)
 */
export async function loadPluginManifest(url: string): Promise<Partial<DraftWisePlugin>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load plugin manifest: ${url}`);
  }
  
  return response.json();
}

/**
 * Plugin configuration storage
 */
export function savePluginConfiguration(pluginId: string, config: Record<string, any>): void {
  localStorage.setItem(`plugin_config_${pluginId}`, JSON.stringify(config));
}

export function loadPluginConfiguration(pluginId: string): Record<string, any> | null {
  const stored = localStorage.getItem(`plugin_config_${pluginId}`);
  return stored ? JSON.parse(stored) : null;
}

export function clearAllPlugins(): void {
  PLUGINS.clear();
  PLUGIN_HOOKS.clear();
}
