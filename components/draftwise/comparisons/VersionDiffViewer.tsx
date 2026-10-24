'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';

interface DiffLine {
  type: 'unchanged' | 'inserted' | 'deleted';
  content: string;
  lineNumber?: number;
}

interface VersionHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
  oldCount: number;
  newCount: number;
}

interface VersionDiffResult {
  hunks: VersionHunk[];
  totalOldChars: number;
  totalNewChars: number;
  unchangedLines: number;
  insertedLines: number;
  deletedLines: number;
}

interface VersionDiffProps {
  oldText: string;
  newText: string;
  oldTitle?: string;
  newTitle?: string;
  onRestore: (version: 'old' | 'new', text: string) => void;
  onClose?: () => void;
}

export function VersionDiffViewer({
  oldText,
  newText,
  oldTitle = 'Previous Version',
  newTitle = 'Current Version',
  onRestore,
  onClose
}: VersionDiffProps) {
  const [zoomLevel, setZoomLevel] = useState(16); // Line height in px
  
  const diffResult = useMemo(() => computeDiff(oldText, newText), [oldText, newText]);
  
  const changesPercent = useMemo(() => {
    const totalChanges = diffResult.insertedLines + diffResult.deletedLines;
    const maxLen = Math.max(oldText.length, newText.length);
    return maxLen > 0 ? Math.round((totalChanges / maxLen) * 100) : 0;
  }, [diffResult, oldText.length, newText.length]);
  
  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Version Comparison</h2>
            <Badge variant="outline">
              {changesPercent}% changed
            </Badge>
          </div>
          
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        
        {/* Change Summary */}
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 bg-green-500 rounded"></span>
            <span>{diffResult.insertedLines} additions</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 bg-red-500 rounded"></span>
            <span>{diffResult.deletedLines} deletions</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-3 h-3 bg-gray-500 rounded"></span>
            <span>{diffResult.unchangedLines} unchanged</span>
          </div>
        </div>
        
        {/* Zoom Control */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Size:</span>
          <Slider
            value={[zoomLevel]}
            min={12}
            max={24}
            step={1}
            onValueChange(([value]) => setZoomLevel(value))
            className="w-32"
          />
          <span className="text-xs text-muted-foreground w-8">{zoomLevel}px</span>
        </div>
      </div>
      
      {/* Diff Content */}
      <div className="flex-1 overflow-hidden">
        <DiffView
          diffResult={diffResult}
          zoomLevel={zoomLevel}
          onRestore={onRestore}
        />
      </div>
      
      {/* Action Buttons */}
      <div className="border-t p-4 flex justify-end gap-3">
        <Button variant="outline" onClick={() => onRestore('old', oldText)}>
          Restore Old Version
        </Button>
        <Button onClick={() => onRestore('new', newText)}>
          Keep Current Version
        </Button>
      </div>
    </div>
  );
}

function DiffView({
  diffResult,
  zoomLevel,
  onRestore
}: {
  diffResult: VersionDiffResult;
  zoomLevel: number;
  onRestore: (version: 'old' | 'new', text: string) => void;
}) {
  if (diffResult.hunks.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        No differences found between versions
      </div>
    );
  }
  
  return (
    <ScrollArea className="h-full">
      <div 
        className="font-mono text-sm"
        style={{ lineHeight: `${zoomLevel}px` }}
      >
        {diffResult.hunks.map((hunk, hunkIndex) => (
          <DiffHunk
            key={hunkIndex}
            hunk={hunk}
            zoomLevel={zoomLevel}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function DiffHunk({
  hunk,
  zoomLevel
}: {
  hunk: VersionHunk;
  zoomLevel: number;
}) {
  let lineNum = 1;
  
  return (
    <div className="border-b border-border/50">
      {/* Hunk header */}
      <div 
        className="px-3 bg-muted/50 border-b"
        style={{ minHeight: `${zoomLevel}px` }}
      >
        <span className="text-xs text-muted-foreground">
          Showing changes around lines {hunk.oldStart}-{hunk.oldStart + hunk.oldCount - 1} → {hunk.newStart}-{hunk.newStart + hunk.newCount - 1}
        </span>
      </div>
      
      {/* Lines */}
      <div className="flex">
        {/* Line numbers and side markers */}
        <div 
          className="flex-none pr-2 text-right select-none"
          style={{ width: `${60 + zoomLevel / 2}px` }}
        >
          {hunk.lines.map((line, i) => (
            <div
              key={i}
              className={`inline-block w-2 mr-2 ${
                line.type === 'inserted' 
                  ? 'bg-green-500' 
                  : line.type === 'deleted'
                    ? 'bg-red-500'
                    : 'bg-transparent'
              }`}
              style={{ height: `${zoomLevel}px` }}
            />
          ))}
        </div>
        
        {/* Old version */}
        <div className="flex-1 overflow-x-auto">
          {hunk.lines.map((line, i) => (
            <DiffLine
              key={`old-${i}`}
              line={line}
              side="old"
              style={{ lineHeight: `${zoomLevel}px` }}
            />
          ))}
        </div>
        
        {/* New version */}
        <div className="flex-1 overflow-x-auto border-l">
          {hunk.lines.map((line, i) => (
            <DiffLine
              key={`new-${i}`}
              line={line}
              side="new"
              style={{ lineHeight: `${zoomLevel}px` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffLine({
  line,
  side,
  ...style
}: {
  line: DiffLine;
  side: 'old' | 'new';
  style?: React.CSSProperties;
}) {
  const getPrefix = () => {
    switch (line.type) {
      case 'inserted':
        return side === 'new' ? '+' : ' ';
      case 'deleted':
        return side === 'old' ? '-' : ' ';
      default:
        return ' ';
    }
  };
  
  return (
    <div 
      className={`whitespace-pre px-3 py-1 ${
        line.type === 'inserted' 
          ? 'bg-green-500/10 text-green-700 dark:text-green-400'
          : line.type === 'deleted'
            ? 'bg-red-500/10 text-red-700 dark:text-red-400'
            : ''
      }`}
      {...style}
    >
      <span className="text-muted-foreground mr-2 select-none">
        {getPrefix()}
      </span>
      {line.content}
    </div>
  );
}

/**
 * Compute simple diff algorithm (Longest Common Subsequence based)
 */
function computeDiff(oldText: string, newText: string): VersionDiffResult {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  
  // Build LCS matrix
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }
  
  // Backtrack to find diffs
  const result: VersionDiffResult = {
    hunks: [],
    totalOldChars: oldText.length,
    totalNewChars: newText.length,
    unchangedLines: 0,
    insertedLines: 0,
    deletedLines: 0
  };
  
  let i = m, j = n;
  const currentHunkLines: DiffLine[] = [];
  let currentHunkOldStart = 1;
  let currentHunkNewStart = 1;
  let inHunk = false;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      // Unchanged line
      currentHunkLines.unshift({
        type: 'unchanged',
        content: oldLines[i - 1],
        lineNumber: i
      });
      
      if (inHunk) {
        // End previous hunk
        result.hunks.push({
          oldStart: currentHunkOldStart,
          newStart: currentHunkNewStart,
          lines: currentHunkLines,
          oldCount: i - currentHunkOldStart + 1,
          newCount: j - currentHunkNewStart + 1
        });
        inHunk = false;
      }
      
      result.unchangedLines++;
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      // Inserted line
      currentHunkLines.unshift({
        type: 'inserted',
        content: newLines[j - 1]
      });
      result.insertedLines += newLines[j - 1].length;
      
      if (!inHunk) {
        currentHunkNewStart = j;
        currentHunkOldStart = i + 1;
        inHunk = true;
      }
      j--;
    } else {
      // Deleted line
      currentHunkLines.unshift({
        type: 'deleted',
        content: oldLines[i - 1]
      });
      result.deletedLines += oldLines[i - 1].length;
      
      if (!inHunk) {
        currentHunkOldStart = i;
        currentHunkNewStart = j + 1;
        inHunk = true;
      }
      i--;
    }
  }
  
  // Don't forget the last hunk if any
  if (currentHunkLines.length > 0) {
    result.hunks.push({
      oldStart: currentHunkOldStart,
      newStart: currentHunkNewStart,
      lines: currentHunkLines,
      oldCount: m - currentHunkOldStart + 1,
      newCount: n - currentHunkNewStart + 1
    });
  }
  
  return result;
}
