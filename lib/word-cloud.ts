/**
 * Word Cloud Generator for Visual Text Analysis
 * Creates beautiful visual representations of word frequency
 */

export interface WordCloudData {
  word: string;
  count: number;
  frequency: number; // 0-1 normalized
  position: { x: number; y: number };
  color: string;
  fontSize: number;
  angle: number;
}

interface WordCloudState {
  words: WordCloudData[];
  containerWidth: number;
  containerHeight: number;
  minWordSize: number;
  maxWordSize: number;
  colorPalette: string[];
  isGenerating: boolean;
}

const DEFAULT_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#6366f1'  // indigo
];

let state: WordCloudState = {
  words: [],
  containerWidth: 800,
  containerHeight: 600,
  minWordSize: 12,
  maxWordSize: 72,
  colorPalette: [...DEFAULT_PALETTE],
  isGenerating: false
};

/**
 * Generate word cloud from text
 */
export function generateWordCloud(
  text: string,
  options?: {
    excludeWords?: string[];
    minWordLength?: number;
    maxWords?: number;
  }
): WordCloudData[] {
  const opts = {
    excludeWords: ['the', 'and', 'for', 'with', 'from', 'that', 'on', 'is', 'in', 'it', 'of', 'to', 'a', 'an'],
    minWordLength: 4,
    maxWords: 100,
    ...options
  };

  // Extract and count words
  const wordCounts: Map<string, number> = new Map();
  
  const words = text.toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^a-z]/g, ''))
    .filter(w => 
      w.length >= opts.minWordLength && 
      !opts.excludeWords.includes(w) &&
      w.length > 0
    );

  // Count frequencies
  words.forEach(word => {
    wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
  });

  // Sort by frequency
  const sorted = Array.from(wordCounts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, opts.maxWords);

  if (sorted.length === 0) {
    return [];
  }

  // Find max frequency for normalization
  const maxCount = sorted[0][1];
  
  // Generate positions using spiral algorithm
  const centerX = state.containerWidth / 2;
  const centerY = state.containerHeight / 2;
  
  const wordCloud: WordCloudData[] = sorted.map(([word, count], index) => {
    const angle = index * Math.PI * (3 - Math.sqrt(5)); // Golden angle
    const radius = Math.sqrt(index) * (Math.min(state.containerWidth, state.containerHeight) / 2 / Math.sqrt(sorted.length));
    
    const x = centerX + radius * Math.cos(angle);
    const y = centerY + radius * Math.sin(angle);
    
    const frequency = count / maxCount;
    const fontSize = state.minWordSize + (state.maxWordSize - state.minWordSize) * frequency;
    const color = state.colorPalette[index % state.colorPalette.length];
    
    return {
      word,
      count,
      frequency,
      position: { x, y },
      color,
      fontSize,
      angle: angle * 180 / Math.PI // Convert to degrees
    };
  });

  state.words = wordCloud;
  state.isGenerating = false;
  
  window.dispatchEvent(new CustomEvent('word-cloud-generated', {
    detail: { data: wordCloud, stats: getStatistics() }
  }));

  return wordCloud;
}

/**
 * Update word cloud settings
 */
export function updateSettings(partial: Partial<Omit<WordCloudState, 'words' | 'isGenerating'>>) {
  state = { ...state, ...partial };
  savePreferences();
}

/**
 * Get current word cloud data
 */
export function getWordCloudData(): WordCloudData[] {
  return [...state.words];
}

/**
 * Export SVG markup
 */
export function exportAsSVG(width: number = 800, height: number = 600): string {
  const svgElements = state.words.map((item, i) => {
    const { x, y } = item.position;
    return `<text 
      x="${x}" 
      y="${y}" 
      fill="${item.color}" 
      font-size="${item.fontSize}px" 
      transform="rotate(${item.angle}, ${x}, ${y})"
      text-anchor="middle"
      dominant-baseline="central"
      class="word-cloud-word">
      ${item.word}
    </text>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .word-cloud-word {
        font-family: Georgia, serif;
        font-weight: bold;
        transition: all 0.3s ease;
        cursor: pointer;
      }
      .word-cloud-word:hover {
        opacity: 0.8;
        filter: brightness(1.1);
      }
    </style>
  </defs>
  ${svgElements}
</svg>`;
}

/**
 * Export as PNG (requires canvas)
 */
export function exportAsPNG(width: number = 800, height: number = 600): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Canvas not supported');
  }

  // Draw background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Draw words
  state.words.forEach(item => {
    ctx.font = `bold ${item.fontSize}px Georgia`;
    ctx.fillStyle = item.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.save();
    ctx.translate(item.position.x, item.position.y);
    ctx.rotate(item.angle * Math.PI / 180);
    ctx.fillText(item.word, 0, 0);
    ctx.restore();
  });

  return canvas;
}

/**
 * Save preferences to localStorage
 */
function savePreferences(): void {
  const prefs = {
    containerWidth: state.containerWidth,
    containerHeight: state.containerHeight,
    minWordSize: state.minWordSize,
    maxWordSize: state.maxWordSize,
    colorPalette: state.colorPalette
  };
  
  localStorage.setItem('word_cloud_prefs', JSON.stringify(prefs));
}

/**
 * Load saved preferences
 */
export function loadPreferences(): void {
  const saved = localStorage.getItem('word_cloud_prefs');
  
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      state = { ...state, ...parsed };
    } catch (error) {
      console.error('Failed to load word cloud prefs:', error);
    }
  }
}

/**
 * Clear preferences
 */
export function clearPreferences(): void {
  localStorage.removeItem('word_cloud_prefs');
  state = {
    words: [],
    containerWidth: 800,
    containerHeight: 600,
    minWordSize: 12,
    maxWordSize: 72,
    colorPalette: [...DEFAULT_PALETTE],
    isGenerating: false
  };
}

/**
 * Get word cloud statistics
 */
export function getStatistics(): {
  totalWords: number;
  uniqueWords: number;
  mostFrequent: Array<{ word: string; count: number }>;
  avgFrequency: number;
} {
  const wordCounts = state.words.map(w => ({ word: w.word, count: w.count }));
  const freqValues = state.words.map(w => w.frequency);
  
  return {
    totalWords: state.words.reduce((sum, w) => sum + w.count, 0),
    uniqueWords: state.words.length,
    mostFrequent: [...wordCounts].sort((a, b) => b.count - a.count).slice(0, 10),
    avgFrequency: freqValues.length > 0 
      ? freqValues.reduce((sum, f) => sum + f, 0) / freqValues.length 
      : 0
  };
}

/**
 * Set custom colors
 */
export function setColors(colors: string[]): void {
  state.colorPalette = colors;
  savePreferences();
}

/**
 * Adjust word size range
 */
export function adjustWordSizes(min: number, max: number): void {
  state.minWordSize = Math.max(8, min);
  state.maxWordSize = Math.min(144, max);
  savePreferences();
}

/**
 * Resize container
 */
export function resizeContainer(width: number, height: number): void {
  state.containerWidth = width;
  state.containerHeight = height;
}

/**
 * Generate from textarea content
 */
export function generateFromTextArea(textArea: HTMLTextAreaElement): WordCloudData[] {
  const text = textArea.value;
  return generateWordCloud(text);
}

/**
 * Download SVG file
 */
export function downloadSVG(filename: string = 'word-cloud'): void {
  const svgString = exportAsSVG();
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename + '.svg';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Download PNG file
 */
export function downloadPNG(filename: string = 'word-cloud'): void {
  const canvas = exportAsPNG();
  const url = canvas.toDataURL('image/png');
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename + '.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}

/**
 * Filter by minimum count
 */
export function filterByMinCount(minCount: number): WordCloudData[] {
  return state.words.filter(w => w.count >= minCount);
}

/**
 * Filter by maximum count (exclude very common words)
 */
export function filterByMaxCount(maxCount: number): WordCloudData[] {
  return state.words.filter(w => w.count <= maxCount);
}

/**
 * Shuffle colors
 */
export function shuffleColors(): void {
  for (let i = state.colorPalette.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.colorPalette[i], state.colorPalette[j]] = [state.colorPalette[j], state.colorPalette[i]];
  }
  savePreferences();
}

/**
 * Reset to defaults
 */
export function resetDefaults(): void {
  state = {
    words: [],
    containerWidth: 800,
    containerHeight: 600,
    minWordSize: 12,
    maxWordSize: 72,
    colorPalette: [...DEFAULT_PALETTE],
    isGenerating: false
  };
  clearPreferences();
}
