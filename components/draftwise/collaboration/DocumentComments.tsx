'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';

export interface Comment {
  id: string;
  author: string;
  avatarUrl?: string;
  timestamp: Date;
  text: string;
  startChar: number;
  endChar: number;
  resolved: boolean;
  replies: CommentReply[];
}

export interface CommentReply {
  id: string;
  author: string;
  timestamp: Date;
  text: string;
}

interface DocumentCommentsProps {
  comments: Comment[];
  activeCommentId?: string | null;
  onAddComment: (startChar: number, endChar: number, text: string) => void;
  onDeleteComment: (commentId: string) => void;
  onResolveComment: (commentId: string) => void;
  onRepositionComment: (commentId: string, startChar: number, endChar: number) => void;
  onSelectComment: (commentId: string) => void;
  selectionStart?: number;
  selectionEnd?: number;
}

export function DocumentComments({
  comments,
  activeCommentId,
  onAddComment,
  onDeleteComment,
  onResolveComment,
  onRepositionComment,
  onSelectComment,
  selectionStart,
  selectionEnd
}: DocumentCommentsProps) {
  const [addingComment, setAddingComment] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [localSelection, setLocalSelection] = useState<{ start: number; end: number } | null>(null);
  
  // Sync with editor selection
  useEffect(() => {
    if (selectionStart !== undefined && selectionEnd !== undefined) {
      if (!addingComment || localSelection === null) {
        setLocalSelection({ start: selectionStart, end: selectionEnd });
      } else if (Math.abs(localSelection.start - selectionStart) > 5 || 
                 Math.abs(localSelection.end - selectionEnd) > 5) {
        setLocalSelection({ start: selectionStart, end: selectionEnd });
      }
    }
  }, [selectionStart, selectionEnd, addingComment, localSelection]);
  
  const handleSubmit = () => {
    if (!newCommentText.trim() || !localSelection) return;
    
    onAddComment(
      localSelection.start,
      localSelection.end,
      newCommentText.trim()
    );
    
    setNewCommentText('');
    setAddingComment(false);
    setLocalSelection(null);
  };
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };
  
  const getInitials = (name: string): string => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };
  
  const formatDate = (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };
  
  return (
    <div className="space-y-4">
      {/* Add Comment Input */}
      <div className="border border-border rounded-lg p-4 bg-card">
        {!addingComment ? (
          <Button
            onClick={() => setAddingComment(true)}
            variant="outline"
            size="sm"
            className="w-full"
            disabled={!localSelection || localSelection.start === localSelection.end}
          >
            + Add comment to selected text
          </Button>
        ) : (
          <div className="space-y-3">
            <Textarea
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add your comment... (Shift+Enter for new line)"
              className="min-h-[80px]"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAddingComment(false);
                  setNewCommentText('');
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={!newCommentText.trim()}
              >
                Post Comment
              </Button>
            </div>
          </div>
        )}
      </div>
      
      {/* Comments List */}
      <div className="space-y-3">
        {comments.length === 0 && !addingComment ? (
          <div className="text-center text-muted-foreground py-8">
            No comments yet
            <p className="text-sm mt-1">Select text to add a comment</p>
          </div>
        ) : (
          comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              isActive={comment.id === activeCommentId}
              isSelected={
                localSelection &&
                localSelection.start <= comment.startChar &&
                localSelection.end >= comment.endChar
              }
              onSelect={() => onSelectComment(comment.id)}
              onDelete={() => onDeleteComment(comment.id)}
              onResolve={() => onResolveComment(comment.id)}
              getInitials={getInitials}
              formatDate={formatDate}
            />
          ))
        )}
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  isActive,
  isSelected,
  onSelect,
  onDelete,
  onResolve,
  getInitials,
  formatDate
}: {
  comment: Comment;
  isActive: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onResolve: () => void;
  getInitials: (name: string) => string;
  formatDate: (date: Date) => string;
}) {
  return (
    <div
      className={`border rounded-lg transition-all ${
        isActive
          ? 'border-primary bg-primary/5'
          : isSelected
            ? 'border-accent bg-accent/5'
            : 'border-border hover:border-muted-foreground/50'
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        {/* Avatar */}
        <Avatar className="h-8 w-8">
          <AvatarFallback className="text-xs">
            {getInitials(comment.author)}
          </AvatarFallback>
        </Avatar>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{comment.author}</span>
              <Badge variant={comment.resolved ? 'secondary' : 'outline'} className="h-5 text-xs">
                {comment.resolved ? 'Resolved' : 'Active'}
              </Badge>
            </div>
            <span className="text-xs text-muted-foreground">
              {formatDate(comment.timestamp)}
            </span>
          </div>
          
          <p className="text-sm leading-relaxed break-words">
            {comment.text}
          </p>
          
          {/* Context preview */}
          <div className="mt-2 p-2 bg-muted rounded text-xs text-muted-foreground truncate">
            Commenting on: "...{comment.text.substring(0, 60)}..."
          </div>
          
          {/* Actions */}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={onSelect}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Reply
            </button>
            <span className="text-muted-foreground">•</span>
            {!comment.resolved && (
              <button
                onClick={onResolve}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Resolve
              </button>
            )}
            <span className="text-muted-foreground">•</span>
            <button
              onClick={onDelete}
              className="text-xs text-destructive hover:text-destructive/80 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
      
      {/* Replies */}
      {comment.replies.length > 0 && (
        <div className="border-t px-4 py-3 space-y-3">
          {comment.replies.map((reply) => (
            <div key={reply.id} className="flex gap-3">
              <Avatar className="h-6 w-6 mt-1">
                <AvatarFallback className="text-xs">
                  {getInitials(reply.author)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-xs">{reply.author}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(reply.timestamp)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {reply.text}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
