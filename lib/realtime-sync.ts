/**
 * Real-Time Document Sync via WebRTC/P2P
 * Zero-server peer-to-peer synchronization
 */

export interface SyncPeer {
  id: string;
  name: string;
  avatar?: string;
  lastActive: Date;
  documentVersion: number;
  cursorPosition?: number;
  selectionRange?: { start: number; end: number };
}

export interface DocumentSnapshot {
  id: string;
  content: string;
  version: number;
  timestamp: Date;
  authorId: string;
  metadata: {
    wordCount: number;
    characterCount: number;
    tag?: string;
  };
}

export interface SyncEvent {
  type: 'document-update' | 'peer-joined' | 'peer-left' | 'conflict-resolved';
  documentId: string;
  data: any;
  timestamp: Date;
}

interface SyncManagerState {
  peers: Map<string, SyncPeer>;
  documents: Map<string, DocumentSnapshot>;
  versionHistory: Map<string, DocumentSnapshot[]>;
  isSyncing: boolean;
  currentPeerId: string;
}

let state: SyncManagerState = {
  peers: new Map(),
  documents: new Map(),
  versionHistory: new Map(),
  isSyncing: false,
  currentPeerId: `peer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
};

// Simulated WebRTC-like connection (placeholder for actual implementation)
class PeerConnectionSimulator {
  private connectedPeers: Set<string> = new Set();
  private listeners: Array<(event: SyncEvent) => void> = [];
  
  constructor(private manager: SyncManagerState) {}
  
  /**
   * Broadcast event to all connected peers
   */
  broadcast(eventType: string, data: any): void {
    const event: SyncEvent = {
      type: eventType as SyncEvent['type'],
      documentId: data.documentId || 'all',
      data,
      timestamp: new Date()
    };
    
    // Notify local listeners
    this.listeners.forEach(listener => listener(event));
    
    // In real implementation, would send over WebRTC
    console.log(`📡 Broadcasting: ${eventType}`, data);
  }
  
  /**
   * Connect to a peer
   */
  connect(peerId: string, peerName: string): void {
    if (!this.connectedPeers.has(peerId)) {
      const peer: SyncPeer = {
        id: peerId,
        name: peerName,
        lastActive: new Date(),
        documentVersion: 0
      };
      
      this.manager.peers.set(peerId, peer);
      this.connectedPeers.add(peerId);
      
      this.broadcast('peer-joined', { peer });
      window.dispatchEvent(new CustomEvent('peer-connected', { detail: { peer } }));
    }
  }
  
  /**
   * Disconnect from peer
   */
  disconnect(peerId: string): void {
    if (this.connectedPeers.has(peerId)) {
      this.connectedPeers.delete(peerId);
      this.manager.peers.delete(peerId);
      
      this.broadcast('peer-left', { peerId });
      window.dispatchEvent(new CustomEvent('peer-disconnected', { detail: { peerId } }));
    }
  }
  
  /**
   * Update cursor position
   */
  updateCursorPosition(cursorPos: number): void {
    this.broadcast('cursor-move', { cursorPos });
  }
  
  /**
   * Subscribe to events
   */
  onEvent(callback: (event: SyncEvent) => void): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }
}

let syncConnector: PeerConnectionSimulator | null = null;

/**
 * Initialize realtime sync system
 */
export function initializeRealtimeSync(): { supported: boolean } {
  syncConnector = new PeerConnectionSimulator(state);
  
  console.log('🔄 Real-time sync initialized');
  return { supported: true };
}

/**
 * Create or load a document
 */
export function loadDocument(documentId: string): DocumentSnapshot {
  if (!state.documents.has(documentId)) {
    const snapshot: DocumentSnapshot = {
      id: documentId,
      content: '',
      version: 1,
      timestamp: new Date(),
      authorId: state.currentPeerId,
      metadata: {
        wordCount: 0,
        characterCount: 0
      }
    };
    
    state.documents.set(documentId, snapshot);
    state.versionHistory.set(documentId, []);
    
    console.log(`📄 Document loaded/created: ${documentId}`);
  }
  
  return state.documents.get(documentId)!;
}

/**
 * Save document update
 */
export function saveDocumentUpdate(
  documentId: string,
  newContent: string,
  tag?: string
): DocumentSnapshot {
  const existing = state.documents.get(documentId);
  
  if (!existing) {
    throw new Error(`Document ${documentId} not found`);
  }
  
  const updated: DocumentSnapshot = {
    ...existing,
    content: newContent,
    version: existing.version + 1,
    timestamp: new Date(),
    authorId: state.currentPeerId,
    metadata: {
      wordCount: newContent.split(/\s+/).filter(w => w.length > 0).length,
      characterCount: newContent.length,
      tag
    }
  };
  
  state.documents.set(documentId, updated);
  
  // Track version history
  const history = state.versionHistory.get(documentId) || [];
  history.push(existing);
  state.versionHistory.set(documentId, history);
  
  // Broadcast update
  syncConnector?.broadcast('document-update', {
    documentId,
    snapshot: updated,
    fromPeer: state.currentPeerId
  });
  
  window.dispatchEvent(new CustomEvent('document-saved', {
    detail: { documentId, snapshot: updated }
  }));
  
  return updated;
}

/**
 * Get full version history
 */
export function getVersionHistory(documentId: string): DocumentSnapshot[] {
  return state.versionHistory.get(documentId) || [];
}

/**
 * Restore old version
 */
export function restoreVersion(
  documentId: string,
  versionToRestore: number
): DocumentSnapshot | null {
  const history = state.versionHistory.get(documentId);
  
  if (!history) {
    return null;
  }
  
  const snapshot = history.find(s => s.version === versionToRestore);
  
  if (!snapshot) {
    return null;
  }
  
  // Restore the content
  state.documents.set(documentId, {
    ...snapshot,
    content: snapshot.content
  });
  
  syncConnector?.broadcast('conflict-resolved', {
    documentId,
    restoredVersion: versionToRestore
  });
  
  console.log(`✅ Restored version ${versionToRestore} of ${documentId}`);
  
  return snapshot;
}

/**
 * Find conflicts (concurrent edits)
 */
export function findConflicts(documentId: string): Array<{
  snapshot1: DocumentSnapshot;
  snapshot2: DocumentSnapshot;
  overlapPercentage: number;
}> {
  const history = state.versionHistory.get(documentId) || [];
  const conflicts: Array<{
    snapshot1: DocumentSnapshot;
    snapshot2: DocumentSnapshot;
    overlapPercentage: number;
  }> = [];
  
  // Compare recent versions for potential conflicts
  const recentVersions = history.slice(-5);
  
  for (let i = 0; i < recentVersions.length - 1; i++) {
    const v1 = recentVersions[i];
    const v2 = recentVersions[i + 1];
    
    if (v1.authorId !== v2.authorId) {
      // Calculate overlap
      const commonWords = getCommonWords(v1.content, v2.content);
      const overlapPercentage = commonWords / Math.min(
        v1.content.length,
        v2.content.length
      );
      
      if (overlapPercentage < 0.7) { // Significant differences
        conflicts.push({
          snapshot1: v1,
          snapshot2: v2,
          overlapPercentage
        });
      }
    }
  }
  
  return conflicts;
}

/**
 * Resolve conflict by merging content
 */
export function mergeDocuments(doc1: string, doc2: string): string {
  // Simple merge: prefer longer sentences, preserve both perspectives
  const sentences1 = doc1.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const sentences2 = doc2.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  // Merge unique sentences
  const uniqueFrom1 = sentences1.filter(s => !doc2.includes(s));
  const uniqueFrom2 = sentences2.filter(s => !doc1.includes(s));
  
  const merged = [
    ...uniqueFrom1,
    '--- Merged from another draft ---',
    ...uniqueFrom2
  ].join('\n\n');
  
  return merged;
}

/**
 * Get connected peers list
 */
export function getConnectedPeers(): SyncPeer[] {
  return Array.from(state.peers.values());
}

/**
 * Get current peer information
 */
export function getCurrentPeer(): { id: string; name: string } {
  return {
    id: state.currentPeerId,
    name: `Writer ${state.currentPeerId.substr(-6)}`
  };
}

/**
 * Generate unique document ID
 */
export function generateDocumentId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Export document with metadata
 */
export function exportDocument(documentId: string): string {
  const snapshot = state.documents.get(documentId);
  const history = state.versionHistory.get(documentId) || [];
  
  return JSON.stringify({
    current: snapshot,
    history,
    exportedAt: new Date().toISOString(),
    version: 1
  }, null, 2);
}

/**
 * Import document from backup
 */
export function importDocument(json: string): void {
  try {
    const imported = JSON.parse(json);
    
    if (imported.current) {
      state.documents.set(imported.current.id, imported.current);
    }
    
    if (imported.history) {
      state.versionHistory.set(imported.current.id, imported.history);
    }
    
    console.log('✅ Document imported successfully');
  } catch (error) {
    console.error('Failed to import document:', error);
  }
}

/**
 * Clear sync state
 */
export function clearAllSyncData(): void {
  state.peers.clear();
  state.documents.clear();
  state.versionHistory.clear();
  state.isSyncing = false;
  
  console.log('🧹 All sync data cleared');
}

/**
 * Check sync status
 */
export function getSyncStatus(): {
  isSyncing: boolean;
  connectedPeers: number;
  totalDocuments: number;
  currentPeerId: string;
} {
  return {
    isSyncing: state.isSyncing,
    connectedPeers: state.peers.size,
    totalDocuments: state.documents.size,
    currentPeerId: state.currentPeerId
  };
}

// Helper Functions

function getCommonWords(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  let count = 0;
  words1.forEach(word => {
    if (words2.has(word)) count++;
  });
  
  return count;
}

/**
 * Join sync session
 */
export function joinSession(sessionId: string): void {
  console.log(`🔗 Attempting to join session: ${sessionId}`);
  
  // Simulate connecting to other peers
  const simulatedPeers = [
    { id: `peer-sim-${Math.random()}`, name: 'Alice' },
    { id: `peer-sim-${Math.random()}`, name: 'Bob' }
  ];
  
  simulatedPeers.forEach(peer => {
    syncConnector?.connect(peer.id, peer.name);
  });
}

/**
 * Leave sync session
 */
export function leaveSession(): void {
  state.peers.forEach(peer => {
    syncConnector?.disconnect(peer.id);
  });
  
  console.log('👋 Left sync session');
}
