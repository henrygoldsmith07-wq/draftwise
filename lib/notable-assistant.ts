/**
 * Note-Taking Assistant with Smart Linking
 * Merges note organization with document editing
 */

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  linkedTo?: string[]; // Document IDs this note references
  isLocked: boolean;
}

export interface Notebook {
  id: string;
  name: string;
  notes: Note[];
  color: string;
  pinToTop: boolean;
}

interface NotableState {
  notebooks: Map<string, Notebook>;
  notesIndex: Map<string, Note>;
  recentNotes: string[];
  favoriteNotes: string[];
}

let state: NotableState = {
  notebooks: new Map(),
  notesIndex: new Map(),
  recentNotes: [],
  favoriteNotes: []
};

const DEFAULT_NOTEBOOKS: Array<{ name: string; color: string }> = [
  { name: 'Writing Ideas', color: '#3b82f6' },
  { name: 'Research Notes', color: '#10b981' },
  { name: 'Drafts', color: '#f59e0b' },
  { name: 'References', color: '#8b5cf6' }
];

/**
 * Initialize notability system
 */
export function initializeNotable(): void {
  // Load from localStorage if exists
  const saved = localStorage.getItem('notable_state');
  
  if (saved) {
    try {
      state = JSON.parse(saved);
      console.log(`📝 Loaded ${state.notesIndex.size} notes`);
    } catch (error) {
      console.error('Failed to load notable data:', error);
    }
  } else {
    // Create default notebooks
    DEFAULT_NOTEBOOKS.forEach(notebook => {
      createNotebook(notebook.name, notebook.color);
    });
    
    console.log('📝 Notable initialized with default notebooks');
  }
}

/**
 * Create a new note
 */
export function createNote(
  notebookId: string,
  title: string,
  content: string = '',
  tags: string[] = []
): Note {
  const now = new Date();
  const note: Note = {
    id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    title: title || 'Untitled Note',
    content,
    tags,
    createdAt: now,
    updatedAt: now,
    isLocked: false
  };
  
  // Add to notebook
  const notebook = state.notebooks.get(notebookId);
  if (notebook) {
    notebook.notes.push(note);
    state.notebooks.set(notebookId, notebook);
  }
  
  // Index the note
  state.notesIndex.set(note.id, note);
  
  // Add to recent
  state.recentNotes.unshift(note.id);
  state.recentNotes = state.recentNotes.slice(0, 50); // Keep last 50
  
  saveState();
  
  window.dispatchEvent(new CustomEvent('note-created', { detail: { note } }));
  
  return note;
}

/**
 * Update existing note
 */
export function updateNote(noteId: string, updates: Partial<Note>): Note | null {
  const note = state.notesIndex.get(noteId);
  
  if (!note) {
    return null;
  }
  
  const updated = { ...note, ...updates, updatedAt: new Date() };
  state.notesIndex.set(noteId, updated);
  
  // Update in notebook
  state.notebooks.forEach(notebook => {
    const index = notebook.notes.findIndex(n => n.id === noteId);
    if (index >= 0) {
      notebook.notes[index] = updated;
    }
  });
  
  saveState();
  
  window.dispatchEvent(new CustomEvent('note-updated', { detail: { note: updated } }));
  
  return updated;
}

/**
 * Delete a note
 */
export function deleteNote(noteId: string): boolean {
  const note = state.notesIndex.get(noteId);
  
  if (!note) {
    return false;
  }
  
  state.notesIndex.delete(noteId);
  state.recentNotes = state.recentNotes.filter(id => id !== noteId);
  
  // Remove from notebook
  state.notebooks.forEach(notebook => {
    notebook.notes = notebook.notes.filter(n => n.id !== noteId);
  });
  
  // Remove from favorites if present
  state.favoriteNotes = state.favoriteNotes.filter(id => id !== noteId);
  
  saveState();
  
  window.dispatchEvent(new CustomEvent('note-deleted', { detail: { noteId } }));
  
  return true;
}

/**
 * Search across all notes
 */
export function searchNotes(query: string): Array<{
  note: Note;
  relevance: number;
}> {
  const lowerQuery = query.toLowerCase();
  const results: Array<{ note: Note; relevance: number }> = [];
  
  for (const note of state.notesIndex.values()) {
    let score = 0;
    
    // Title match gets highest weight
    if (note.title.toLowerCase().includes(lowerQuery)) {
      score += 10;
    }
    
    // Content match
    if (note.content.toLowerCase().includes(lowerQuery)) {
      score += 5;
    }
    
    // Tag match
    if (note.tags.some(tag => tag.toLowerCase().includes(lowerQuery))) {
      score += 8;
    }
    
    if (score > 0) {
      results.push({ note, relevance: score });
    }
  }
  
  // Sort by relevance
  return results.sort((a, b) => b.relevance - a.relevance);
}

/**
 * Create a new notebook
 */
export function createNotebook(name: string, color: string): Notebook {
  const notebook: Notebook = {
    id: `notebook-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name,
    notes: [],
    color,
    pinToTop: false
  };
  
  state.notebooks.set(notebook.id, notebook);
  saveState();
  
  window.dispatchEvent(new CustomEvent('notebook-created', { detail: { notebook } }));
  
  return notebook;
}

/**
 * Get all notebooks
 */
export function getAllNotebooks(): Notebook[] {
  return Array.from(state.notebooks.values());
}

/**
 * Get notes by notebook
 */
export function getNotesByNotebook(notebookId: string): Note[] {
  const notebook = state.notebooks.get(notebookId);
  return notebook ? [...notebook.notes].sort((a, b) => 
    b.updatedAt.getTime() - a.updatedAt.getTime()
  ) : [];
}

/**
 * Favorite/unfavorite a note
 */
export function toggleFavorite(noteId: string): boolean {
  const index = state.favoriteNotes.indexOf(noteId);
  
  if (index >= 0) {
    // Unfavorite
    state.favoriteNotes.splice(index, 1);
    return false;
  } else {
    // Favorite
    state.favoriteNotes.unshift(noteId);
    return true;
  }
}

/**
 * Get favorite notes
 */
export function getFavoriteNotes(): Note[] {
  return state.favoriteNotes
    .map(id => state.notesIndex.get(id))
    .filter((note): note is Note => note !== undefined)
    .slice(0, 20); // Top 20 favorites
}

/**
 * Get recent notes
 */
export function getRecentNotes(limit: number = 10): Note[] {
  return state.recentNotes
    .map(id => state.notesIndex.get(id))
    .filter((note): note is Note => note !== undefined)
    .slice(0, limit);
}

/**
 * Lock/unlock a note
 */
export function toggleLock(noteId: string): boolean {
  const note = state.notesIndex.get(noteId);
  
  if (!note) {
    return false;
  }
  
  const locked = !note.isLocked;
  note.isLocked = locked;
  state.notesIndex.set(noteId, note);
  
  saveState();
  
  return locked;
}

/**
 * Find related notes based on content similarity
 */
export function findRelatedNotes(noteId: string, maxResults: number = 5): Note[] {
  const sourceNote = state.notesIndex.get(noteId);
  if (!sourceNote) {
    return [];
  }
  
  const sourceWords = new Set(
    sourceNote.content.toLowerCase().split(/\s+/).filter(w => w.length > 4)
  );
  
  const scores: Array<{ noteId: string; score: number }> = [];
  
  for (const [id, note] of state.notesIndex.entries()) {
    if (id === noteId) continue;
    
    const noteWords = new Set(
      note.content.toLowerCase().split(/\s+/).filter(w => w.length > 4)
    );
    
    // Calculate Jaccard similarity
    let intersection = 0;
    let union = 0;
    
    noteWords.forEach(word => {
      if (sourceWords.has(word)) intersection++;
      union++;
    });
    
    sourceWords.forEach(word => {
      if (!noteWords.has(word)) union++;
    });
    
    const similarity = union > 0 ? intersection / union : 0;
    
    if (similarity > 0.1) {
      scores.push({ noteId: id, score: similarity });
    }
  }
  
  // Sort and return top results
  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(s => state.notesIndex.get(s.noteId)!)
    .filter((note): note is Note => note !== undefined);
}

/**
 * Tag-based filtering
 */
export function filterByTag(tag: string): Note[] {
  return Array.from(state.notesIndex.values()).filter(note =>
    note.tags.some(t => t.toLowerCase() === tag.toLowerCase())
  );
}

/**
 * Export all data as JSON
 */
export function exportAllData(): string {
  return JSON.stringify(state, null, 2);
}

/**
 * Import data from JSON
 */
export function importAllData(json: string): void {
  try {
    const imported = JSON.parse(json);
    state = imported;
    saveState();
    console.log('✅ Data imported successfully');
  } catch (error) {
    console.error('Failed to import data:', error);
  }
}

/**
 * Save state to localStorage
 */
function saveState(): void {
  try {
    localStorage.setItem('notable_state', JSON.stringify(state));
  } catch (error) {
    console.error('Failed to save state:', error);
  }
}

/**
 * Clear all data
 */
export function clearAll(): void {
  localStorage.removeItem('notable_state');
  state = {
    notebooks: new Map(),
    notesIndex: new Map(),
    recentNotes: [],
    favoriteNotes: []
  };
  
  DEFAULT_NOTEBOOKS.forEach(notebook => {
    createNotebook(notebook.name, notebook.color);
  });
  
  console.log('🧹 All data cleared');
}

/**
 * Get statistics
 */
export function getStatistics(): {
  totalNotes: number;
  notebooks: number;
  recentActivity: string[];
  topTags: Array<{ tag: string; count: number }>;
} {
  const tags: Record<string, number> = {};
  
  state.notesIndex.forEach(note => {
    note.tags.forEach(tag => {
      tags[tag] = (tags[tag] || 0) + 1;
    });
  });
  
  const topTags = Object.entries(tags)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));
  
  return {
    totalNotes: state.notesIndex.size,
    notebooks: state.notebooks.size,
    recentActivity: state.recentNotes.slice(0, 10),
    topTags
  };
}
