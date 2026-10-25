/**
 * Advanced Search & Replace System
 * Supports regex, case sensitivity, whole word matching
 */

export interface SearchResult {
  start: number;
  end: number;
  text: string;
  contextBefore?: string;
  contextAfter?: string;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  useRegex?: boolean;
  wholeWord?: boolean;
  includeContext?: boolean;
  contextLength?: number; // characters before/after
}

const DEFAULT_OPTIONS: Required<SearchOptions> = {
  caseSensitive: false,
  useRegex: false,
  wholeWord: false,
  includeContext: true,
  contextLength: 50
};

/**
 * Search in text for matches
 */
export function searchText(
  content: string,
  query: string,
  options: SearchOptions = {}
): SearchResult[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  if (!query.trim()) {
    return [];
  }
  
  try {
    if (opts.useRegex) {
      return searchWithRegex(content, query, opts);
    } else {
      return searchLiteral(content, query, opts);
    }
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
}

/**
 * Literal search (non-regex)
 */
function searchLiteral(
  content: string,
  query: string,
  options: Required<SearchOptions>
): SearchResult[] {
  const results: SearchResult[] = [];
  let searchContent = content;
  let offset = 0;
  
  const compareFn = options.caseSensitive
    ? (a: string, b: string) => a === b
    : (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  
  while (true) {
    let foundIndex = -1;
    
    if (options.caseSensitive) {
      foundIndex = searchContent.indexOf(query, offset);
    } else {
      const lowerQuery = query.toLowerCase();
      const lowerContent = searchContent.toLowerCase();
      
      while ((foundIndex = lowerContent.indexOf(lowerQuery, offset)) !== -1) {
        // Verify exact match at position
        if (compareFn(searchContent.substring(foundIndex, foundIndex + query.length), query)) {
          break;
        }
        offset = foundIndex + 1;
      }
      
      if (foundIndex === -1) break;
    }
    
    // Check whole word requirement
    if (options.wholeWord && !isWholeWord(content, foundIndex, query.length)) {
      offset = foundIndex + 1;
      continue;
    }
    
    const result: SearchResult = {
      start: foundIndex,
      end: foundIndex + query.length,
      text: content.substring(foundIndex, foundIndex + query.length)
    };
    
    if (options.includeContext) {
      result.contextBefore = getContext(content, foundIndex, -options.contextLength);
      result.contextAfter = getContext(content, foundIndex + query.length, options.contextLength);
    }
    
    results.push(result);
    
    offset = foundIndex + query.length;
    
    if (offset >= content.length) {
      break;
    }
  }
  
  return results;
}

/**
 * Regex-based search
 */
function searchWithRegex(
  content: string,
  pattern: string,
  options: Required<SearchOptions>
): SearchResult[] {
  const results: SearchResult[] = [];
  
  try {
    let flags = options.caseSensitive ? 'g' : 'gi';
    
    // Add word boundaries if whole word is required
    if (options.wholeWord) {
      flags = flags.replace('i', ''); // Remove i temporarily for boundary check
      pattern = `\\b${pattern}\\b`;
      if (!options.caseSensitive) {
        flags += 'i';
      }
    }
    
    const regex = new RegExp(pattern, flags);
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      const result: SearchResult = {
        start: match.index,
        end: match.index + match[0].length,
        text: match[0]
      };
      
      if (options.includeContext) {
        result.contextBefore = getContext(content, match.index, -options.contextLength);
        result.contextAfter = getContext(content, match.index + match[0].length, options.contextLength);
      }
      
      results.push(result);
    }
  } catch (error) {
    throw new Error(`Invalid regex pattern: ${pattern}`);
  }
  
  return results;
}

/**
 * Check if match is a whole word
 */
function isWholeWord(text: string, startPos: number, length: number): boolean {
  const beforeChar = startPos > 0 ? text[startPos - 1] : '';
  const afterChar = startPos + length < text.length ? text[startPos + length] : '';
  
  // Word characters are alphanumeric + underscore
  const isWordChar = (c: string) => /[a-zA-Z0-9_]/.test(c);
  
  return (!beforeChar || !isWordChar(beforeChar)) && 
         (!afterChar || !isWordChar(afterChar));
}

/**
 * Get context around position
 */
function getContext(text: string, position: number, length: number): string | undefined {
  if (position < 0 || position >= text.length) {
    return undefined;
  }
  
  const safeStart = Math.max(0, position + length);
  const safeEnd = Math.min(text.length, safeStart + Math.abs(length));
  
  return text.substring(safeStart, safeEnd);
}

/**
 * Replace all occurrences
 */
export function replaceAll(
  content: string,
  oldText: string,
  newText: string,
  options: SearchOptions = {}
): {
  content: string;
  replacementCount: number;
  replacements: Array<{ old: string; new: string; position: number }>;
} {
  const results = searchText(content, oldText, options);
  
  if (results.length === 0) {
    return { content, replacementCount: 0, replacements: [] };
  }
  
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let replacementCount = 0;
  const replacements: Array<{ old: string; new: string; position: number }> = [];
  
  if (opts.useRegex) {
    // Simple regex replace
    try {
      let flags = opts.caseSensitive ? 'g' : 'gi';
      if (opts.wholeWord) {
        flags = 'g';
        oldText = `\\b${oldText}\\b`;
        if (!opts.caseSensitive) {
          flags += 'i';
        }
      }
      
      const regex = new RegExp(oldText, flags);
      const newContent = content.replace(regex, newText);
      replacementCount = results.length;
      
      results.forEach(r => {
        replacements.push({
          old: r.text,
          new: newText,
          position: r.start
        });
      });
      
      return {
        content: newContent,
        replacementCount,
        replacements
      };
    } catch (error) {
      console.error('Replace error:', error);
      return { content, replacementCount: 0, replacements: [] };
    }
  } else {
    // Iterative literal replace
    let currentContent = content;
    let cumulativeOffset = 0;
    
    // Sort results in reverse order to preserve positions during replacement
    const sortedResults = [...results].sort((a, b) => b.start - a.start);
    
    sortedResults.forEach(result => {
      const actualStart = result.start + cumulativeOffset;
      const actualEnd = result.end + cumulativeOffset;
      
      const oldStr = currentContent.substring(actualStart, actualEnd);
      const newStr = oldStr.replace(/[[\{}()*+?\\^$|]/g, '\\$&'); // Escape regex special chars
      
      currentContent = 
        currentContent.substring(0, actualStart) +
        newText +
        currentContent.substring(actualEnd);
      
      replacements.push({
        old: oldStr,
        new: newText,
        position: actualStart
      });
      
      replacementCount++;
      
      // Update offset for next iterations
      cumulativeOffset += newText.length - oldStr.length;
    });
    
    return {
      content: currentContent,
      replacementCount,
      replacements
    };
  }
}

/**
 * Preview replacements without applying them
 */
export function previewReplacements(
  content: string,
  oldText: string,
  newText: string,
  options: SearchOptions = {}
): {
  originalLines: SearchResult[];
  previewLines: SearchResult[];
  changesSummary: string;
} {
  const results = searchText(content, oldText, options);
  
  if (results.length === 0) {
    return {
      originalLines: [],
      previewLines: [],
      changesSummary: 'No matches found'
    };
  }
  
  const originalLines = results.map(r => ({
    ...r,
    type: 'original' as const
  }));
  
  // Generate preview by simulating replacements
  const preview = replaceAll(content, oldText, newText, options);
  const previewResults = searchText(preview.content, newText, { ...options, includeContext: false });
  
  const previewLines = previewResults.slice(0, results.length).map(r => ({
    start: r.start,
    end: r.end,
    text: r.text,
    type: 'preview' as const
  }));
  
  const summary = `${preview.replacementCount} occurrence(s) would be replaced`;
  
  return {
    originalLines,
    previewLines,
    changesSummary: summary
  };
}

/**
 * Extract unique words from text for quick searching
 */
export function extractUniqueWords(text: string): Set<string> {
  const words = new Set<string>();
  const lowercaseText = text.toLowerCase();
  
  // Split on non-word characters
  const splits = lowercaseText.split(/[^a-z0-9]+/i);
  
  splits.forEach(word => {
    if (word.length > 2) { // Minimum word length
      words.add(word);
    }
  });
  
  return words;
}

/**
 * Quick word existence check
 */
export function containsWord(text: string, word: string, options?: SearchOptions): boolean {
  const searchOpts = { ...DEFAULT_OPTIONS, ...options, wholeWord: true };
  const results = searchText(text, word, searchOpts);
  return results.length > 0;
}

/**
 * Highlight search results in HTML
 */
export function highlightResults(
  content: string,
  results: SearchResult[],
  className: string = 'search-highlight'
): string {
  if (results.length === 0) {
    return escapeHtml(content);
  }
  
  // Sort results in reverse order to preserve positions
  const sortedResults = [...results].sort((a, b) => b.start - a.start);
  
  let escapedContent = escapeHtml(content);
  
  sortedResults.forEach(result => {
    // Insert opening tag
    escapedContent = 
      escapedContent.substring(0, result.start) +
      `<span class="${className}">` +
      escapedContent.substring(result.start, result.end) +
      `</span>` +
      escapedContent.substring(result.end);
  });
  
  return escapedContent;
}

// Helper Functions

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Clear highlights from editor
 */
export function clearHighlights(): void {
  const highlights = document.querySelectorAll('.search-highlight');
  highlights.forEach(el => {
    const parent = el.parentNode;
    parent?.replaceChild(document.createTextNode(el.textContent || ''), el);
    parent?.appendChild(parent.lastChild!); // Preserve siblings
  });
}

/**
 * Jump to next search result
 */
export function jumpToResult(results: SearchResult[], currentIndex: number, direction: 'next' | 'prev'): number {
  if (results.length === 0) {
    return -1;
  }
  
  let newIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1;
  
  if (newIndex >= results.length) {
    newIndex = 0; // Loop back to start
  } else if (newIndex < 0) {
    newIndex = results.length - 1; // Loop to end
  }
  
  return newIndex;
}

/**
 * Calculate statistics for search query
 */
export function getSearchStats(content: string, query: string, options?: SearchOptions): {
  totalCount: number;
  matchPercentage: number;
  firstMatchPosition: number;
  lastMatchPosition: number;
} {
  const results = searchText(content, query, options);
  
  const totalCount = results.length;
  const matchedText = results.reduce((sum, r) => sum + r.text.length, 0);
  const matchPercentage = content.length > 0 ? (matchedText / content.length) * 100 : 0;
  
  return {
    totalCount,
    matchPercentage,
    firstMatchPosition: results.length > 0 ? results[0].start : -1,
    lastMatchPosition: results.length > 0 ? results[results.length - 1].end : -1
  };
}
