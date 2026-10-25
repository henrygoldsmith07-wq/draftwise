/**
 * Real-time Collaboration Presence System
 * Live cursors, user indicators, and collaborative editing support
 */

export interface Collaborator {
  id: string;
  name: string;
  avatarUrl?: string;
  color: string;
  isConnected: boolean;
  lastActiveAt: Date;
  currentSelection?: SelectionRange;
}

export interface SelectionRange {
  start: number;
  end: number;
  text: string;
  timestamp: Date;
}

export interface DocumentPresence {
  documentId: string;
  collaborators: Map<string, Collaborator>;
  activeUsers: Set<string>;
}

export interface CollaborationEvent {
  type: 'cursor-move' | 'selection-change' | 'document-update' | 'user-joined' | 'user-left';
  documentId: string;
  userId: string;
  timestamp: Date;
  data?: any;
}

let presenceData: Map<string, DocumentPresence> = new Map();
let eventListeners: Array<(event: CollaborationEvent) => void> = [];
let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Initialize collaboration system
 */
export function initializeCollaboration(): void {
  if (intervalId) return;
  
  // Clean up stale connections every 5 seconds
  intervalId = setInterval(() => {
    cleanupStaleConnections();
  }, 5000);
}

/**
 * Register local user for collaboration
 */
export function registerUser(
  documentId: string,
  name: string,
  avatarUrl?: string
): string {
  const userId = generateUserId();
  const color = getRandomColor();
  
  updateDocumentPresence(documentId, {
    type: 'user-joined',
    documentId,
    userId,
    data: {
      name,
      avatarUrl,
      color,
      isConnected: true,
      lastActiveAt: new Date()
    }
  });
  
  emitEvent({
    type: 'user-joined',
    documentId,
    userId,
    timestamp: new Date(),
    data: { name, avatarUrl, color }
  });
  
  return userId;
}

/**
 * Update current user's selection/cursor position
 */
export function updateCursorPosition(
  documentId: string,
  userId: string,
  selection: SelectionRange
): void {
  updateDocumentPresence(documentId, {
    type: 'selection-change',
    documentId,
    userId,
    data: selection
  });
  
  emitEvent({
    type: 'cursor-move',
    documentId,
    userId,
    timestamp: new Date(),
    data: selection
  });
}

/**
 * Leave document session
 */
export function leaveDocument(documentId: string, userId: string): void {
  const presence = presenceData.get(documentId);
  
  if (presence && presence.collaborators.has(userId)) {
    const collaborator = presence.collaborators.get(userId)!;
    
    // Remove from active users
    presence.activeUsers.delete(userId);
    
    // Keep as disconnected but not fully removed
    presence.collaborators.set(userId, {
      ...collaborator,
      isConnected: false,
      lastActiveAt: new Date()
    });
    
    emitEvent({
      type: 'user-left',
      documentId,
      userId,
      timestamp: new Date()
    });
  }
}

/**
 * Update full presence state
 */
function updateDocumentPresence(
  documentId: string,
  event: CollaborationEvent
): void {
  let presence = presenceData.get(documentId);
  
  if (!presence) {
    presence = {
      documentId,
      collaborators: new Map(),
      activeUsers: new Set()
    };
    presenceData.set(documentId, presence);
  }
  
  switch (event.type) {
    case 'user-joined':
      presence.collaborators.set(event.userId, {
        id: event.userId,
        name: event.data.name,
        avatarUrl: event.data.avatarUrl,
        color: event.data.color,
        isConnected: true,
        lastActiveAt: event.timestamp
      });
      presence.activeUsers.add(event.userId);
      break;
      
    case 'selection-change':
      const collab = presence.collaborators.get(event.userId);
      if (collab) {
        collab.currentSelection = event.data;
        collab.lastActiveAt = new Date();
        
        // Add to active users on movement
        presence.activeUsers.add(event.userId);
      }
      break;
      
    case 'user-left':
      // Mark as disconnected
      const leavingCollab = presence.collaborators.get(event.userId);
      if (leavingCollab) {
        leavingCollab.isConnected = false;
        leavingCollab.lastActiveAt = new Date();
      }
      presence.activeUsers.delete(event.userId);
      break;
  }
}

/**
 * Cleanup stale/disconnected users
 */
function cleanupStaleConnections(): void {
  const maxIdleTime = 30 * 1000; // 30 seconds
  
  presenceData.forEach((presence, docId) => {
    presence.collaborators.forEach((collab, userId) => {
      const idleTime = Date.now() - collab.lastActiveAt.getTime();
      
      if (idleTime > maxIdleTime && !collab.isConnected) {
        // Remove completely after 60 seconds
        presence.collaborators.delete(userId);
        presence.activeUsers.delete(userId);
      }
    });
  });
}

/**
 * Get all active collaborators for a document
 */
export function getActiveCollaborators(documentId: string): Collaborator[] {
  const presence = presenceData.get(documentId);
  
  if (!presence) return [];
  
  return Array.from(presence.collaborators.values()).filter(c => c.isConnected);
}

/**
 * Subscribe to collaboration events
 */
export function subscribeToEvents(callback: (event: CollaborationEvent) => void): () => void {
  eventListeners.push(callback);
  
  return () => {
    eventListeners = eventListeners.filter(cb => cb !== callback);
  };
}

/**
 * Emit event to all subscribers
 */
function emitEvent(event: CollaborationEvent): void {
  eventListeners.forEach(callback => {
    try {
      callback(event);
    } catch (error) {
      console.error('Error in collaboration event listener:', error);
    }
  });
}

/**
 * Generate unique user ID
 */
function generateUserId(): string {
  return `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get random color for user cursor/indicator
 */
function getRandomColor(): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

/**
 * Calculate reading time based on word count
 */
export function estimateReadingTime(wordCount: number): {
  minutes: number;
  seconds: number;
  readableString: string;
} {
  const averageWordsPerMinute = 200;
  const totalMinutes = Math.ceil(wordCount / averageWordsPerMinute);
  const minutes = Math.max(1, totalMinutes);
  const seconds = (wordCount % averageWordsPerMinute) / (averageWordsPerMinute / 60);
  
  if (minutes === 1) {
    return { minutes, seconds, readableString: '~1 min read' };
  } else {
    return { minutes, seconds, readableString: `${minutes} min read` };
  }
}

/**
 * Format collaborative edit indicator
 */
export function formatCollaboratorIndicator(collaborator: Collaborator): string {
  return `${collaborator.name} (${collaborator.id.slice(0, 6)})`;
}

/**
 * Check if document has active collaborators
 */
export function hasActiveCollaborators(documentId: string): boolean {
  const presence = presenceData.get(documentId);
  return presence ? presence.activeUsers.size > 0 : false;
}

/**
 * Get connected collaborator count
 */
export function getConnectedCollaboratorCount(documentId: string): number {
  const presence = presenceData.get(documentId);
  return presence ? Array.from(presence.collaborators.values()).filter(c => c.isConnected).length : 0;
}

/**
 * Clear all collaboration data
 */
export function clearAllCollaboration(): void {
  presenceData.clear();
  eventListeners = [];
  
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

// Export for React integration
export interface CollaborationContextValue {
  activeCollaborators: Collaborator[];
  isSelfWriting: boolean;
  selectTextAtRange: (start: number, end: number) => void;
  getReadingTimeEstimate: () => { minutes: number; readableString: string };
}
