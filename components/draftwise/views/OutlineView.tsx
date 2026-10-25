'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, Plus, Trash2, Edit3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

export interface OutlineNode {
  id: string;
  title: string;
  level: number; // 1-6 (H1-H6)
  children: OutlineNode[];
  expanded?: boolean;
}

interface OutlineViewProps {
  onNodeSelect?: (nodeId: string) => void;
  onNodeUpdate?: (nodeId: string, newTitle: string) => void;
  onAddNode?: (parentId: string | null, title: string, level: number) => string;
  onDeleteNode?: (nodeId: string) => void;
  existingOutline?: OutlineNode[];
}

export function OutlineView({
  onNodeSelect,
  onNodeUpdate,
  onAddNode,
  onDeleteNode,
  existingOutline
}: OutlineViewProps) {
  const [nodes, setNodes] = useState<OutlineNode[]>(existingOutline || []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  
  // Toggle expansion
  const toggleExpand = (nodeId: string) => {
    setNodes(nodes.map(node => 
      node.id === nodeId
        ? { ...node, expanded: !node.expanded }
        : node.children.length > 0
          ? { ...node, children: toggleChildrenExpansion(node.children, nodeId) }
          : node
    ));
  };
  
  function toggleChildrenExpansion(children: OutlineNode[], parentId: string): OutlineNode[] {
    return children.map(child => {
      if (child.id === parentId) {
        return { ...child, expanded: !child.expanded };
      }
      if (child.children.length > 0) {
        return { ...child, children: toggleChildrenExpansion(child.children, parentId) };
      }
      return child;
    });
  }
  
  // Add new node
  const handleAddNode = (parentId: string | null, level: number) => {
    const newNodeId = onAddNode?.(parentId, '', level);
    
    if (newNodeId && level > 1) {
      setEditingId(newNodeId);
      setEditValue('');
    }
  };
  
  // Update node
  const handleUpdateNode = (nodeId: string, newTitle: string) => {
    onNodeUpdate?.(nodeId, newTitle);
    setEditingId(null);
    setEditValue('');
  };
  
  // Delete node
  const handleDeleteNode = (nodeId: string) => {
    onDeleteNode?.(nodeId);
  };
  
  // Start editing
  const startEdit = (node: OutlineNode) => {
    setEditingId(node.id);
    setEditValue(node.title);
  };
  
  // Render outline recursively
  const renderNodes = (nodesToRender: OutlineNode[]) => {
    return nodesToRender.map((node) => (
      <OutlineNodeItem
        key={node.id}
        node={node}
        editingId={editingId}
        editValue={editValue}
        onToggleExpand={() => toggleExpand(node.id)}
        onStartEdit={() => startEdit(node)}
        onUpdate={(newTitle) => handleUpdateNode(node.id, newTitle)}
        onDelete={() => handleDeleteNode(node.id)}
        onSelect={() => onNodeSelect?.(node.id)}
        onAddChild={() => handleAddNode(node.id, node.level + 1)}
      />
    ));
  };
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Document Outline</h3>
        
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAddNode(null, 1)}
            disabled={!onAddNode}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Section
          </Button>
        </div>
      </div>
      
      {nodes.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
          No outline yet<br />
          <span className="text-sm">Click "Add Section" to get started</span>
        </div>
      ) : (
        <div className="space-y-1">
          {renderNodes(nodes)}
        </div>
      )}
    </div>
  );
}

function OutlineNodeItem({
  node,
  editingId,
  editValue,
  onToggleExpand,
  onStartEdit,
  onUpdate,
  onDelete,
  onSelect,
  onAddChild
}: {
  node: OutlineNode;
  editingId: string | null;
  editValue: string;
  onToggleExpand: () => void;
  onStartEdit: () => void;
  onUpdate: (value: string) => void;
  onDelete: () => void;
  onSelect: () => void;
  onAddChild: () => void;
}) {
  const hasChildren = node.children.length > 0;
  const isEditing = editingId === node.id;
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onUpdate(editValue);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };
  
  return (
    <div 
      className={`flex items-center gap-2 p-2 rounded-md hover:bg-muted transition-colors ${
        editingId === node.id ? 'bg-primary/10' : ''
      }`}
      style={{ paddingLeft: `${node.level * 16}px` }}
    >
      {/* Expand/Collapse */}
      {hasChildren ? (
        <button
          onClick={onToggleExpand}
          className="p-1 hover:bg-muted rounded transition-colors"
        >
          {node.expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
        </button>
      ) : (
        <div className="w-6" />
      )}
      
      {/* Heading level indicator */}
      <span className="text-xs font-bold text-muted-foreground w-5">
        H{node.level}
      </span>
      
      {/* Title or Edit Input */}
      {isEditing ? (
        <Input
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => onUpdate(editValue)}
          onKeyDown={handleKeyDown}
          autoFocus
          placeholder="Section title..."
          className="flex-1 min-w-0 h-7 text-sm px-2"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className="flex-1 min-w-0 truncate cursor-pointer hover:text-primary transition-colors"
          onClick={onSelect}
        >
          {node.title || <span className="text-muted-foreground italic">Untitled section</span>}
        </span>
      )}
      
      {/* Actions */}
      <div className="flex gap-1">
        <button
          onClick={onStartEdit}
          className="p-1 hover:bg-muted rounded transition-colors"
          title="Edit"
        >
          <Edit3 className="w-3 h-3" />
        </button>
        
        {!hasChildren && (
          <button
            onClick={onAddChild}
            className="p-1 hover:bg-muted rounded transition-colors"
            title="Add subsection"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
        
        <button
          onClick={onDelete}
          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3 h-3 text-red-500" />
        </button>
      </div>
      
      {/* Children */}
      {hasChildren && node.expanded && (
        <div className="ml-4 mt-1">
          {node.children.map(child => (
            <OutlineNodeItem
              key={child.id}
              node={child}
              editingId={editingId}
              editValue={editValue}
              onToggleExpand={() => {}}
              onStartEdit={() => {}}
              onUpdate={() => {}}
              onDelete={() => {}}
              onSelect={() => {}}
              onAddChild={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Generate outline from document headings
 */
export function generateOutlineFromDocument(text: string): OutlineNode[] {
  const lines = text.split('\n');
  const outline: OutlineNode[] = [];
  const stack: { level: number; node: OutlineNode }[] = [];
  
  const headingRegex = /^(#{1,6})\s+(.+)$/;
  
  lines.forEach(line => {
    const match = line.match(headingRegex);
    
    if (match) {
      const level = match[1].length;
      const title = match[2].trim();
      
      const newNode: OutlineNode = {
        id: `section-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        title,
        level,
        children: [],
        expanded: true
      };
      
      // Find parent based on level hierarchy
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }
      
      if (stack.length === 0) {
        outline.push(newNode);
      } else {
        const parent = stack[stack.length - 1].node;
        parent.children.push(newNode);
      }
      
      stack.push({ level, node: newNode });
    }
  });
  
  return outline;
}

/**
 * Export outline as nested JSON
 */
export function exportOutlineAsJson(nodes: OutlineNode[]): string {
  return JSON.stringify(nodes, null, 2);
}

/**
 * Import outline from JSON
 */
export function importOutlineFromJson(json: string): OutlineNode[] {
  try {
    const imported: OutlineNode[] = JSON.parse(json);
    
    // Ensure all nodes have required fields
    function validateAndFix(node: OutlineNode): OutlineNode {
      return {
        id: node.id || `node-${Date.now()}-${Math.random()}`,
        title: node.title || 'Untitled',
        level: Math.max(1, Math.min(6, node.level || 1)),
        children: node.children?.map(validateAndFix) || [],
        expanded: node.expanded ?? true
      };
    }
    
    return imported.map(validateAndFix);
  } catch (error) {
    console.error('Failed to import outline:', error);
    throw error;
  }
}
