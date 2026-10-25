/**
 * Handwriting Recognition (Simulation)
 * For future integration with touch input devices
 */

export interface HandwritingPoint {
  x: number;
  y: number;
  timestamp: number;
  pressure?: number;
}

export interface HandwritingStroke {
  id: string;
  points: HandwritingPoint[];
  confidence: number;
  recognizedText?: string;
}

export interface HandwritingRecognitionState {
  isDrawing: boolean;
  currentStroke: HandwritingStroke | null;
  strokes: HandwritingStroke[];
  lastRecognized: string | null;
  error?: string;
}

class HandwritingRecognizer {
  private strokes: HandwritingStroke[] = [];
  private state: HandwritingRecognitionState = {
    isDrawing: false,
    currentStroke: null,
    strokes: [],
    lastRecognized: null
  };
  
  // Neural network simulation (placeholder for actual ML model)
  private simulatedAccuracy = 0.85; // 85% recognition accuracy
  
  constructor() {
    console.log('✍️ Handwriting recognizer initialized');
  }
  
  /**
   * Start drawing a stroke
   */
  beginStroke(x: number, y: number, pressure?: number): void {
    const point: HandwritingPoint = {
      x,
      y,
      timestamp: Date.now(),
      pressure
    };
    
    this.state.currentStroke = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      points: [point],
      confidence: 1.0
    };
    
    this.state.isDrawing = true;
    
    window.dispatchEvent(new CustomEvent('handwriting-stroke-start', {
      detail: { strokeId: this.state.currentStroke.id }
    }));
  }
  
  /**
   * Continue drawing
   */
  addPoint(x: number, y: number, pressure?: number): void {
    if (!this.state.isDrawing || !this.state.currentStroke) {
      return;
    }
    
    const point: HandwritingPoint = {
      x,
      y,
      timestamp: Date.now(),
      pressure
    };
    
    this.state.currentStroke.points.push(point);
    
    window.dispatchEvent(new CustomEvent('handwriting-point-added', {
      detail: { 
        strokeId: this.state.currentStroke.id,
        point 
      }
    }));
  }
  
  /**
   * End current stroke
   */
  endStroke(): HandwritingStroke | null {
    if (!this.state.isDrawing || !this.state.currentStroke) {
      return null;
    }
    
    const stroke = this.state.currentStroke;
    this.completeStroke();
    
    // Simulate recognition
    const text = this.simulateRecognition(stroke);
    stroke.recognizedText = text;
    stroke.confidence = this.simulatedAccuracy;
    
    this.strokes.push(stroke);
    
    window.dispatchEvent(new CustomEvent('handwriting-stroke-end', {
      detail: { stroke }
    }));
    
    return stroke;
  }
  
  /**
   * Complete and finalize current stroke
   */
  completeStroke(): void {
    if (this.state.currentStroke) {
      this.state.strokes.push(this.state.currentStroke);
    }
    
    this.state.currentStroke = null;
    this.state.isDrawing = false;
    
    window.dispatchEvent(new CustomEvent('handwriting-drawing-ended'));
  }
  
  /**
   * Cancel current stroke
   */
  cancelStroke(): void {
    this.state.currentStroke = null;
    this.state.isDrawing = false;
    
    window.dispatchEvent(new CustomEvent('handwriting-canceled'));
  }
  
  /**
   * Simulate handwriting-to-text recognition
   * In production, this would use actual ML model
   */
  private simulateRecognition(stroke: HandwritingStroke): string {
    // Simplified simulation based on stroke patterns
    const pointCount = stroke.points.length;
    const avgPressure = stroke.points.reduce((sum, p) => sum + (p.pressure || 0.5), 0) / pointCount;
    
    // Pattern-based text generation (for demonstration)
    const patterns: Record<string, string[]> = {
      'c': ['c', 'o', 'a', 'e'],
      'o': ['o', 'c', 'e', 'a'],
      'l': ['l', 't', 'i'],
      't': ['t', 'l', 'i'],
      'i': ['i', 't', 'l'],
      'm': ['m', 'w', 'n']
    };
    
    // Generate pseudo-random but deterministic text
    const seed = stroke.id.split('-')[1] || '';
    const words = ['cat', 'dog', 'the', 'and', 'is', 'in', 'on', 'at'];
    
    // Return simulated recognized text
    const predictedWord = words[seed.length % words.length];
    
    return `${predictedWord} (${(this.simulatedAccuracy * 100).toFixed(0)}%)`;
  }
  
  /**
   * Get current state
   */
  getState(): HandwritingRecognitionState {
    return { ...this.state };
  }
  
  /**
   * Get all strokes
   */
  getStrokes(): HandwritingStroke[] {
    return [...this.strokes];
  }
  
  /**
   * Clear all strokes
   */
  clear(): void {
    this.strokes = [];
    this.state = {
      isDrawing: false,
      currentStroke: null,
      strokes: [],
      lastRecognized: null
    };
    
    window.dispatchEvent(new CustomEvent('handwriting-cleared'));
  }
  
  /**
   * Export strokes as JSON
   */
  exportStrokesAsJson(): string {
    return JSON.stringify(this.strokes, null, 2);
  }
  
  /**
   * Import strokes from JSON
   */
  importStrokesFromJson(json: string): void {
    try {
      const imported = JSON.parse(json);
      this.strokes = imported;
      
      window.dispatchEvent(new CustomEvent('handwriting-imported', {
        detail: { count: imported.length }
      }));
    } catch (error) {
      console.error('Failed to import strokes:', error);
    }
  }
  
  /**
   * Save recognition results
   */
  saveToDocument(textArea: HTMLTextAreaElement): void {
    const recognizedText = this.strokes
      .map(s => s.recognizedText || '')
      .join(' ');
    
    if (recognizedText) {
      const textarea = textArea as any;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      
      textarea.value = 
        value.substring(0, start) + 
        recognizedText + 
        value.substring(end);
      
      textarea.selectionStart = textarea.selectionEnd = start + recognizedText.length;
      textarea.focus();
      
      window.dispatchEvent(new CustomEvent('handwriting-saved', {
        detail: { text: recognizedText }
      }));
    }
  }
}

// Singleton instance
const recognizer = new HandwritingRecognizer();

// Event helpers
export function onStrokeStart(callback: (event: CustomEvent<{ strokeId: string }>) => void): () => void {
  window.addEventListener('handwriting-stroke-start', callback as EventListener);
  return () => window.removeEventListener('handwriting-stroke-start', callback as EventListener);
}

export function onStrokeEnd(callback: (event: CustomEvent<{ stroke: HandwritingStroke }>) => void): () => void {
  window.addEventListener('handwriting-stroke-end', callback as EventListener);
  return () => window.removeEventListener('handwriting-stroke-end', callback as EventListener);
}

export function onStrokeAdded(callback: (event: CustomEvent<{ strokeId: string; point: HandwritingPoint }>) => void): () => void {
  window.addEventListener('handwriting-point-added', callback as EventListener);
  return () => window.removeEventListener('handwriting-point-added', callback as EventListener);
}

export function onDrawingEnded(callback: (event: CustomEvent<undefined>) => void): () => void {
  window.addEventListener('handwriting-drawing-ended', callback as EventListener);
  return () => window.removeEventListener('handwriting-drawing-ended', callback as EventListener);
}

export function onSaved(callback: (event: CustomEvent<{ text: string }>) => void): () => void {
  window.addEventListener('handwriting-saved', callback as EventListener);
  return () => window.removeEventListener('handwriting-saved', callback as EventListener);
}

// Public API
export const handwriting = {
  recognizer,
  beginStroke: (x, y, p?) => recognizer.beginStroke(x, y, p),
  addPoint: (x, y, p?) => recognizer.addPoint(x, y, p),
  endStroke: () => recognizer.endStroke(),
  cancelStroke: () => recognizer.cancelStroke(),
  clear: () => recognizer.clear(),
  getState: () => recognizer.getState(),
  getStrokes: () => recognizer.getStrokes(),
  exportJson: () => recognizer.exportStrokesAsJson(),
  importJson: (json: string) => recognizer.importStrokesFromJson(json),
  saveToDocument: (textarea: HTMLTextAreaElement) => recognizer.saveToDocument(textarea)
};

/**
 * Create SVG path data from points
 */
export function pointsToSvgPath(points: HandwritingPoint[]): string {
  if (points.length === 0) return '';
  
  const moves = points.map((p, i) => {
    if (i === 0) {
      return `M ${p.x} ${p.y}`;
    } else {
      return `L ${p.x} ${p.y}`;
    }
  });
  
  return moves.join(' ');
}

/**
 * Normalize stroke coordinates to canvas size
 */
export function normalizePoints(
  points: HandwritingPoint[],
  width: number,
  height: number
): HandwritingPoint[] {
  if (points.length === 0) return points;
  
  const minX = Math.min(...points.map(p => p.x));
  const maxX = Math.max(...points.map(p => p.x));
  const minY = Math.min(...points.map(p => p.y));
  const maxY = Math.max(...points.map(p => p.y));
  
  const scaleX = width / (maxX - minX || 1);
  const scaleY = height / (maxY - minY || 1);
  
  return points.map(p => ({
    x: (p.x - minX) * scaleX,
    y: (p.y - minY) * scaleY,
    timestamp: p.timestamp,
    pressure: p.pressure
  }));
}

/**
 * Calculate stroke bounding box
 */
export function getBoundingBox(points: HandwritingPoint[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
}

/**
 * Smooth stroke using moving average
 */
export function smoothStroke(points: HandwritingPoint[], factor: number = 3): HandwritingPoint[] {
  if (points.length < factor) return points;
  
  const smoothed: HandwritingPoint[] = [];
  
  for (let i = 0; i < points.length; i++) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    
    for (let j = Math.max(0, i - Math.floor(factor / 2)); 
         j <= Math.min(points.length - 1, i + Math.floor(factor / 2)); j++) {
      sumX += points[j].x;
      sumY += points[j].y;
      count++;
    }
    
    smoothed.push({
      ...points[i],
      x: sumX / count,
      y: sumY / count
    });
  }
  
  return smoothed;
}

/**
 * Filter stroke points (decimation)
 */
export function decimatePoints(points: HandwritingPoint[], threshold: number): HandwritingPoint[] {
  if (points.length <= 2) return points;
  
  const filtered: HandwritingPoint[] = [points[0]];
  
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    
    // Douglas-Peucker algorithm simplified
    const dist = Math.abs((curr.y - prev.y) * (next.x - prev.x) - 
                          (next.y - prev.y) * (curr.x - prev.x)) / 
                 Math.sqrt(Math.pow(next.x - prev.x, 2) + Math.pow(next.y - prev.y, 2));
    
    if (dist > threshold) {
      filtered.push(curr);
    }
  }
  
  filtered.push(points[points.length - 1]);
  
  return filtered;
}
