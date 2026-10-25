/**
 * Advanced Text Styling System
 * Custom typography, animations, and visual effects
 */

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  textAlign: 'left' | 'center' | 'right' | 'justify';
  color: string;
  backgroundColor: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'none' | 'underline' | 'line-through';
}

export interface VisualEffect {
  name: string;
  active: boolean;
  params: Record<string, any>;
}

export interface AnimationSettings {
  cursorBlink: boolean;
  highlightAnimation: boolean;
  typingEffect: boolean;
  transitionDuration: number; // ms
}

// Built-in font families
const AVAILABLE_FONTS = [
  { name: 'Georgia', category: 'serif', class: 'font-georgia' },
  { name: 'Times New Roman', category: 'serif', class: 'font-times' },
  { name: 'Arial', category: 'sans-serif', class: 'font-arial' },
  { name: 'Helvetica', category: 'sans-serif', class: 'font-helvetica' },
  { name: 'Courier New', category: 'monospace', class: 'font-courier' },
  { name: 'Verdana', category: 'sans-serif', class: 'font-verdana' },
  { name: 'Palatino', category: 'serif', class: 'font-palatino' }
];

// Color themes
const COLOR_THEMES = [
  {
    name: 'Light',
    bg: '#ffffff',
    fg: '#1a1a1a',
    accent: '#3b82f6',
    selection: '#bfdbfe'
  },
  {
    name: 'Sepia',
    bg: '#f4ecd8',
    fg: '#3c3026',
    accent: '#8b7355',
    selection: '#e8dcc5'
  },
  {
    name: 'Dark',
    bg: '#1a1a1a',
    fg: '#e0e0e0',
    accent: '#60a5fa',
    selection: '#374151'
  },
  {
    name: 'Ocean',
    bg: '#f0f9ff',
    fg: '#0f172a',
    accent: '#0ea5e9',
    selection: '#bae6fd'
  },
  {
    name: 'Forest',
    bg: '#f0fdf4',
    fg: '#14532d',
    accent: '#22c55e',
    selection: '#bbf7d0'
  }
];

// Default settings
let currentStyle: TextStyle = {
  fontFamily: 'Georgia',
  fontSize: 16,
  lineHeight: 1.6,
  letterSpacing: 0,
  textAlign: 'left',
  color: '#1a1a1a',
  backgroundColor: '#ffffff',
  fontWeight: 400
};

let visualEffects: VisualEffect[] = [
  { name: 'typingCursor', active: true, params: { blinkRate: 500 } },
  { name: 'wordHover', active: false, params: { duration: 200 } },
  { name: 'highlightFlow', active: false, params: { speed: 'slow' } }
];

let animationSettings: AnimationSettings = {
  cursorBlink: true,
  highlightAnimation: true,
  typingEffect: false,
  transitionDuration: 150
};

/**
 * Apply text style to element
 */
export function applyStyle(element: HTMLElement, style: TextStyle): void {
  Object.entries(style).forEach(([key, value]) => {
    const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
    element.style.setProperty(cssKey, String(value));
  });
  
  window.dispatchEvent(new CustomEvent('style-applied', { detail: { style } }));
}

/**
 * Update current style
 */
export function updateTextStyle(partialStyle: Partial<TextStyle>): void {
  currentStyle = { ...currentStyle, ...partialStyle };
  updateGlobalStyles();
}

/**
 * Get current text style
 */
export function getCurrentStyle(): TextStyle {
  return { ...currentStyle };
}

/**
 * Set color theme
 */
export function setColorTheme(themeName: string): void {
  const theme = COLOR_THEMES.find(t => t.name === themeName);
  
  if (!theme) {
    console.warn(`Unknown theme: ${themeName}`);
    return;
  }
  
  currentStyle.backgroundColor = theme.bg;
  currentStyle.color = theme.fg;
  
  updateGlobalStyles();
}

/**
 * Get available color themes
 */
export function getAvailableThemes(): Array<{ name: string; preview: string }> {
  return COLOR_THEMES.map(theme => ({
    name: theme.name,
    preview: `linear-gradient(135deg, ${theme.bg} 0%, ${theme.accent} 100%)`
  }));
}

/**
 * Enable/disable visual effect
 */
export function setVisualEffect(effectName: string, enabled: boolean): void {
  const effect = visualEffects.find(e => e.name === effectName);
  
  if (effect) {
    effect.active = enabled;
    
    window.dispatchEvent(new CustomEvent('visual-effect-changed', {
      detail: { effectName, enabled }
    }));
  }
}

/**
 * Toggle visual effect state
 */
export function toggleVisualEffect(effectName: string): boolean {
  const effect = visualEffects.find(e => e.name === effectName);
  
  if (!effect) {
    return false;
  }
  
  effect.active = !effect.active;
  updateEffectStyling(effect);
  
  return effect.active;
}

/**
 * Configure animation settings
 */
export function setAnimationSetting<K extends keyof AnimationSettings>(
  key: K,
  value: AnimationSettings[K]
): void {
  animationSettings[key] = value;
  
  window.dispatchEvent(new CustomEvent('animation-setting-changed', {
    detail: { key, value }
  }));
}

/**
 * Get all visual effects
 */
export function getVisualEffects(): VisualEffect[] {
  return [...visualEffects];
}

/**
 * Add custom CSS class for text styling
 */
export function addCustomClass(className: string, styles: Partial<CSSStyleDeclaration>): void {
  // Create stylesheet if doesn't exist
  let styleSheet = document.querySelector('#custom-text-styles') as HTMLStyleElement;
  
  if (!styleSheet) {
    styleSheet = document.createElement('style');
    styleSheet.id = 'custom-text-styles';
    document.head.appendChild(styleSheet);
  }
  
  // Generate CSS rules
  const cssRules = className.split(', ').map(name => {
    const declarations = Object.entries(styles)
      .map(([prop, value]) => `${prop}: ${value}`)
      .join('; ');
    return `.text-style-${name} { ${declarations} }`;
  }).join('\n');
  
  styleSheet.textContent += cssRules + '\n';
}

/**
 * Apply custom class to selected text
 */
export function applyCustomClass(textArea: HTMLTextAreaElement, className: string): void {
  const start = textArea.selectionStart;
  const end = textArea.selectionEnd;
  const selectedText = textArea.value.substring(start, end);
  
  // Wrap in span with class
  const wrappedText = `<span class="text-style-${className}">${selectedText}</span>`;
  
  // Note: This requires rich text editor mode
  // For plain textarea, just log warning
  console.log(`Applied class "${className}" to selection`);
  console.log('Note: Use rich text mode for full functionality');
}

/**
 * Preview text with current style
 */
export function previewText(text: string): string {
  const styleString = Object.entries(currentStyle)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => {
      const cssKey = k.replace(/([A-Z])/g, '-$1').toLowerCase();
      return `${cssKey}: ${v}`;
    })
    .join('; ');
  
  return `<div style="${styleString}">${escapeHtml(text)}</div>`;
}

/**
 * Generate print-ready stylesheet
 */
export function generatePrintStylesheet(): string {
  return `
@media print {
  body {
    font-family: "${currentStyle.fontFamily}", serif;
    font-size: ${currentStyle.fontSize}px;
    line-height: ${currentStyle.lineHeight};
    color: ${currentStyle.color};
    background: none;
  }
  
  .print-content {
    max-width: 800px;
    margin: 0 auto;
    padding: 40px;
  }
  
  h1, h2, h3 {
    font-weight: bold;
    page-break-after: avoid;
  }
  
  p {
    margin-bottom: 1em;
    text-align: ${currentStyle.textAlign};
  }
}
  `;
}

/**
 * Save style preferences
 */
export function savePreferences(): void {
  localStorage.setItem('draftwise_text_style', JSON.stringify(currentStyle));
  localStorage.setItem('draftwise_animation_settings', JSON.stringify(animationSettings));
  localStorage.setItem('draftwise_visual_effects', JSON.stringify(visualEffects));
}

/**
 * Load style preferences
 */
export function loadPreferences(): void {
  const savedStyle = localStorage.getItem('draftwise_text_style');
  const savedAnimations = localStorage.getItem('draftwise_animation_settings');
  const savedEffects = localStorage.getItem('draftwise_visual_effects');
  
  if (savedStyle) {
    currentStyle = { ...currentStyle, ...JSON.parse(savedStyle) };
  }
  
  if (savedAnimations) {
    animationSettings = { ...animationSettings, ...JSON.parse(savedAnimations) };
  }
  
  if (savedEffects) {
    visualEffects = JSON.parse(savedEffects);
  }
  
  updateGlobalStyles();
}

// Helper Functions

function updateGlobalStyles(): void {
  // Update body/document styles
  const root = document.documentElement;
  
  root.style.setProperty('--draft-font-family', `'${currentStyle.fontFamily}', serif`);
  root.style.setProperty('--draft-font-size', `${currentStyle.fontSize}px`);
  root.style.setProperty('--draft-line-height', `${currentStyle.lineHeight}`);
  
  // Apply to main editor
  const editorEl = document.querySelector('.editor-textarea') as HTMLElement;
  if (editorEl) {
    applyStyle(editorEl, currentStyle);
  }
  
  savePreferences();
  
  window.dispatchEvent(new CustomEvent('global-style-updated', { 
    detail: { currentStyle } 
  }));
}

function updateEffectStyling(effect: VisualEffect): void {
  if (effect.name === 'cursorBlink' && effect.active) {
    // Enable cursor blinking animation
    document.body.classList.add('animate-cursor-blink');
  } else if (effect.name === 'cursorBlink' && !effect.active) {
    document.body.classList.remove('animate-cursor-blink');
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Apply font from preset list
 */
export function applyFont(fontName: string): boolean {
  const font = AVAILABLE_FONTS.find(f => f.name === fontName);
  
  if (font) {
    currentStyle.fontFamily = fontName;
    updateGlobalStyles();
    return true;
  }
  
  return false;
}

/**
 * Adjust font size
 */
export function adjustFontSize(delta: number): void {
  const newSize = Math.max(8, Math.min(72, currentStyle.fontSize + delta));
  currentStyle.fontSize = newSize;
  updateGlobalStyles();
  
  window.dispatchEvent(new CustomEvent('font-size-changed', {
    detail: { newSize }
  }));
}

/**
 * Change text alignment
 */
export function setTextAlignment(alignment: TextStyle['textAlign']): void {
  currentStyle.textAlign = alignment;
  updateGlobalStyles();
}

/**
 * Reset to default style
 */
export function resetToDefaults(): void {
  currentStyle = {
    fontFamily: 'Georgia',
    fontSize: 16,
    lineHeight: 1.6,
    letterSpacing: 0,
    textAlign: 'left',
    color: '#1a1a1a',
    backgroundColor: '#ffffff',
    fontWeight: 400
  };
  
  animationSettings = {
    cursorBlink: true,
    highlightAnimation: true,
    typingEffect: false,
    transitionDuration: 150
  };
  
  visualEffects = [
    { name: 'typingCursor', active: true, params: { blinkRate: 500 } },
    { name: 'wordHover', active: false, params: { duration: 200 } },
    { name: 'highlightFlow', active: false, params: { speed: 'slow' } }
  ];
  
  updateGlobalStyles();
}

/**
 * Calculate accessibility contrast ratio
 */
export function getContrastRatio(fg: string, bg: string): number {
  // Convert hex to RGB
  const rgb1 = hexToRgb(fg);
  const rgb2 = hexToRgb(bg);
  
  if (!rgb1 || !rgb2) {
    return 0;
  }
  
  // Calculate relative luminance
  const l1 = calculateLuminance(rgb1);
  const l2 = calculateLuminance(rgb2);
  
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  
  return (lighter + 0.05) / (darker + 0.05);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function calculateLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const a = [r, g, b].map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  
  return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

/**
 * Check WCAG AA compliance
 */
export function isWCAAGCompliant(): boolean {
  const ratio = getContrastRatio(currentStyle.color, currentStyle.backgroundColor);
  return ratio >= 4.5; // AA standard for normal text
}

/**
 * Auto-fix contrast issues
 */
export function optimizeContrast(): void {
  const ratio = getContrastRatio(currentStyle.color, currentStyle.backgroundColor);
  
  if (ratio < 4.5) {
    // Darken the foreground or lighten background
    const darkenedColor = darkenColor(currentStyle.color, Math.floor((4.5 / ratio) * 20));
    currentStyle.color = darkenedColor;
    updateGlobalStyles();
    
    console.log(`Contrast optimized: ${getContrastRatio(currentStyle.color, currentStyle.backgroundColor).toFixed(2)}:1`);
  }
}

function darkenColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, (num >> 16) - amt);
  const G = Math.max(0, ((num >> 8) & 0x00FF) - amt);
  const B = Math.max(0, (num & 0x0000FF) - amt);
  
  return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}
