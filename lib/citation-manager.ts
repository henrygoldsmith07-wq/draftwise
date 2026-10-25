/**
 * Citation Management System for Academic Writing
 * Supports APA, MLA, Chicago formats with automatic bibliography generation
 */

export interface Citation {
  id: string;
  type: 'book' | 'journal' | 'website' | 'conference' | 'thesis' | 'newspaper';
  author: string[];
  title: string;
  year: number;
  publisher?: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  url?: string;
  accessedDate?: string;
  doi?: string;
}

export interface BibliographyEntry {
  citationId: string;
  formatted: string;
  format: 'APA' | 'MLA' | 'Chicago';
}

export interface CitationStyle {
  name: 'APA' | 'MLA' | 'Chicago';
  displayName: string;
  rules: {
    authorFormat: 'lastFirst' | 'firstLast' | 'allLast';
    yearPosition: 'afterAuthor' | 'end' | 'inParens';
    titleCapitalization: 'sentence' | 'titleCase' | 'lowercase';
    italicizeTitles: boolean;
    includeDoi: boolean;
    includeUrl: boolean;
  };
}

const CITATION_STYLES: Record<string, CitationStyle> = {
  APA: {
    name: 'APA',
    displayName: 'APA (7th Edition)',
    rules: {
      authorFormat: 'lastFirst',
      yearPosition: 'inParens',
      titleCapitalization: 'sentence',
      italicizeTitles: true,
      includeDoi: true,
      includeUrl: true
    }
  },
  MLA: {
    name: 'MLA',
    displayName: 'MLA (9th Edition)',
    rules: {
      authorFormat: 'lastFirst',
      yearPosition: 'end',
      titleCapitalization: 'titleCase',
      italicizeTitles: false,
      includeDoi: false,
      includeUrl: true
    }
  },
  Chicago: {
    name: 'Chicago',
    displayName: 'Chicago Manual of Style',
    rules: {
      authorFormat: 'lastFirst',
      yearPosition: 'end',
      titleCapitalization: 'titleCase',
      italicizeTitles: false,
      includeDoi: false,
      includeUrl: false
    }
  }
};

let citationsDb: Map<string, Citation> = new Map();
let currentStyle: CitationStyle = CITATION_STYLES.APA;

/**
 * Add a new citation
 */
export function addCitation(citation: Omit<Citation, 'id'>): string {
  const id = generateCitationId();
  const fullCitation: Citation = { ...citation, id };
  
  citationsDb.set(id, fullCitation);
  
  console.log(`📚 Citation added: ${fullCitation.title}`);
  return id;
}

/**
 * Remove a citation by ID
 */
export function removeCitation(citationId: string): void {
  if (citationsDb.has(citationId)) {
    citationsDb.delete(citationId);
    console.log(`🗑️ Citation removed: ${citationId}`);
  }
}

/**
 * Get all citations
 */
export function getAllCitations(): Citation[] {
  return Array.from(citationsDb.values());
}

/**
 * Get citation by ID
 */
export function getCitation(citationId: string): Citation | undefined {
  return citationsDb.get(citationId);
}

/**
 * Update existing citation
 */
export function updateCitation(
  citationId: string,
  updates: Partial<Citation>
): boolean {
  const existing = citationsDb.get(citationId);
  
  if (!existing) {
    return false;
  }
  
  const updated = { ...existing, ...updates };
  citationsDb.set(citationId, updated);
  
  return true;
}

/**
 * Format citation in current style
 */
export function formatCitation(citationId: string): string | null {
  const citation = citationsDb.get(citationId);
  
  if (!citation) {
    console.warn(`Citation ${citationId} not found`);
    return null;
  }
  
  switch (citation.type) {
    case 'book':
      return formatBook(citation, currentStyle);
    case 'journal':
      return formatJournal(citation, currentStyle);
    case 'website':
      return formatWebsite(citation, currentStyle);
    case 'conference':
      return formatConference(citation, currentStyle);
    case 'thesis':
      return formatThesis(citation, currentStyle);
    case 'newspaper':
      return formatNewspaper(citation, currentStyle);
    default:
      console.warn(`Unknown citation type: ${citation.type}`);
      return null;
  }
}

/**
 * Generate complete bibliography
 */
export function generateBibliography(format: 'APA' | 'MLA' | 'Chicago' = 'APA'): string {
  currentStyle = CITATION_STYLES[format];
  const entries: BibliographyEntry[] = [];
  
  for (const [id, citation] of citationsDb.entries()) {
    const formatted = formatCitation(id);
    if (formatted) {
      entries.push({
        citationId: id,
        formatted: formatted.trim(),
        format: format
      });
    }
  }
  
  // Alphabetically sort by first author's last name
  entries.sort((a, b) => {
    const authorA = a.formatted.split(',')[0].trim();
    const authorB = b.formatted.split(',')[0].trim();
    return authorA.localeCompare(authorB);
  });
  
  // Join with double line breaks between entries
  return entries.map(e => e.formatted).join('\n\n');
}

/**
 * Set citation style
 */
export function setCitationStyle(styleName: 'APA' | 'MLA' | 'Chicago'): void {
  currentStyle = CITATION_STYLES[styleName];
  console.log(`📐 Citation style changed to: ${currentStyle.displayName}`);
}

/**
 * Get current citation style
 */
export function getCurrentStyle(): CitationStyle {
  return currentStyle;
}

// Formatting Functions

function formatBook(citation: Citation, style: CitationStyle): string {
  const authors = formatAuthors(citation.author, style.rules.authorFormat);
  const year = `(year: ${citation.year})`;
  const title = style.rules.italicizeTitles 
    ? `<em>${capitalizeTitle(citation.title)}</em>` 
    : citation.title;
  const publisher = citation.publisher ? `, Publisher.` : '';
  
  switch (style.name) {
    case 'APA':
      return `${authors}. (${citation.year}). ${title}${publisher}`;
    case 'MLA':
      return `${authors}. ${title}. ${citation.publisher || 'Publisher'}, ${citation.year}.`;
    case 'Chicago':
      return `${authors}, ${title}. ${citation.publisher || 'Publisher'}, ${citation.year}.`;
  }
}

function formatJournal(citation: Citation, style: CitationStyle): string {
  const authors = formatAuthors(citation.author, style.rules.authorFormat);
  const year = citation.year;
  const title = style.rules.titleCapitalization === 'titleCase'
    ? capitalizeTitle(citation.title)
    : citation.title.toLowerCase();
  const journal = style.rules.italicizeTitles
    ? `<em>${citation.journal}</em>`
    : citation.journal;
  const volume = citation.volume ? `(${citation.volume})` : '';
  const pages = citation.pages ? `, ${citation.pages}` : '';
  
  let result = '';
  
  switch (style.name) {
    case 'APA':
      result = `${authors}. (${year}). ${title}. ${journal}${volume}${pages}`;
      break;
    case 'MLA':
      result = `${authors}. "${title}." ${journal}, vol. ${volume || 'N/A'}, no. ${citation.issue || 'N/A'}, ${year}, pp.${pages}`;
      break;
    case 'Chicago':
      result = `${authors}, "${title}," ${journal} ${volume}${pages} (${year}).`;
      break;
  }
  
  return result;
}

function formatWebsite(citation: Citation, style: CitationStyle): string {
  const authors = citation.author.length > 0
    ? formatAuthors(citation.author, style.rules.authorFormat)
    : '(No author listed)';
  
  const date = citation.accessedDate || new Date().toISOString().split('T')[0];
  const title = style.rules.italicizeTitles
    ? `<em>${capitalizeTitle(citation.title)}</em>`
    : citation.title;
  const url = style.includeUrl ? `\nURL: ${citation.url || 'N/A'}` : '';
  const doi = style.includeDoi && citation.doi
    ? `\nDOI: ${citation.doi}`
    : '';
  
  let result = '';
  
  switch (style.name) {
    case 'APA':
      result = `${authors}. (${citation.year || 'n.d.'}). ${title}. ${url}${doi}`;
      break;
    case 'MLA':
      result = `${authors}. "${title}." Website Name, ${date}. ${url}`;
      break;
    case 'Chicago':
      result = `${authors}. "${title}." Last modified ${date}. ${citation.url || 'URL'} (accessed ${date}).`;
      break;
  }
  
  return result;
}

function formatConference(citation: Citation, style: CitationStyle): string {
  const authors = formatAuthors(citation.author, style.rules.authorFormat);
  const title = style.rules.italicizeTitles
    ? `<em>${capitalizeTitle(citation.title)}</em>`
    : citation.title;
  const conferenceName = citation.publisher || 'Conference Name';
  const location = citation.journal || 'Location';
  
  return `${authors}. ${citation.year}. "${title}". In ${conferenceName}, ${location}.`;
}

function formatThesis(citation: Citation, style: CitationStyle): string {
  const authors = formatAuthors(citation.author, style.rules.authorFormat);
  const title = style.rules.italicizeTitles
    ? `<em>${capitalizeTitle(citation.title)}</em>`
    : citation.title;
  const degree = citation.type === 'thesis' ? 'Unpublished doctoral dissertation' : 'Master\'s thesis';
  
  return `${authors}. (${citation.year}). ${title} (${degree}). ${citation.publisher || 'Institution Name'}.`;
}

function formatNewspaper(citation: Citation, style: CitationStyle): string {
  const authors = formatAuthors(citation.author, style.rules.authorFormat);
  const title = `"${capitalizeTitle(citation.title)}"`;
  const date = `${citation.year}-${String(citation.year % 100).padStart(2, '0')}`;
  const pages = citation.pages ? `, p. ${pages}` : '';
  
  return `${authors}. (${citation.year}, ${date}). ${title}. ${citation.publisher}${pages}.`;
}

// Helper Functions

function formatAuthors(authors: string[], format: 'lastFirst' | 'firstLast' | 'allLast'): string {
  switch (format) {
    case 'lastFirst':
      return authors
        .map(a => {
          const parts = a.trim().split(' ');
          if (parts.length >= 2) {
            return `${parts[parts.length - 1]}, ${parts.slice(0, parts.length - 1).join(' ')}`;
          }
          return a;
        })
        .join(', ');
    
    case 'firstLast':
      return authors.join(', ');
    
    case 'allLast':
      return authors
        .map(a => {
          const parts = a.trim().split(' ');
          return parts[parts.length - 1];
        })
        .join(', ');
    
    default:
      return authors.join(', ');
  }
}

function capitalizeTitle(title: string): string {
  const minorWords = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 
                      'of', 'on', 'or', 'the', 'to', 'up', 'via'];
  
  const words = title.split(' ').map((word, index) => {
    const cleanWord = word.replace(/[^a-zA-Z]/g, '');
    
    // Capitalize first and last words always
    if (index === 0 || index === words.length - 1) {
      return capitalizeFirst(word);
    }
    
    // Otherwise capitalize only major words
    return minorWords.includes(cleanWord.toLowerCase()) ? word.toLowerCase() : capitalizeFirst(word);
  });
  
  return words.join(' ');
}

function capitalizeFirst(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function generateCitationId(): string {
  return `cite-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Example data population
 */
export function populateExampleCitations(): void {
  addCitation({
    type: 'book',
    author: ['Smith, John', 'Johnson, Mary'],
    title: 'The Future of AI in Education',
    year: 2023,
    publisher: 'Academic Press'
  });
  
  addCitation({
    type: 'journal',
    author: ['Williams, Robert'],
    title: 'Machine Learning Algorithms for Natural Language Processing',
    year: 2022,
    journal: 'Journal of Artificial Intelligence Research',
    volume: '45',
    issue: '3',
    pages: '123-145',
    doi: '10.1234/jair.2022.45.3.123'
  });
  
  addCitation({
    type: 'website',
    author: ['OpenAI Team'],
    title: 'GPT-4 Technical Report',
    year: 2023,
    url: 'https://openai.com/research/gpt-4',
    accessedDate: '2024-01-15'
  });
  
  console.log('✅ Example citations added');
}

/**
 * Clear all citations
 */
export function clearAllCitations(): void {
  citationsDb.clear();
  console.log('🧹 All citations cleared');
}

/**
 * Export citations as JSON
 */
export function exportCitationsAsJson(): string {
  const data = Array.from(citationsDb.values());
  return JSON.stringify(data, null, 2);
}

/**
 * Import citations from JSON
 */
export function importCitationsFromJson(json: string): number {
  try {
    const imported: Citation[] = JSON.parse(json);
    let count = 0;
    
    imported.forEach(c => {
      if (c.id && citationsDb.has(c.id)) {
        console.warn(`Skipping duplicate citation: ${c.id}`);
        return;
      }
      citationsDb.set(c.id || generateCitationId(), c);
      count++;
    });
    
    return count;
  } catch (error) {
    console.error('Failed to import citations:', error);
    throw error;
  }
}

/**
 * Search citations by keyword
 */
export function searchCitations(query: string): Citation[] {
  const lowerQuery = query.toLowerCase();
  
  return Array.from(citationsDb.values()).filter(citation =>
    citation.title.toLowerCase().includes(lowerQuery) ||
    citation.author.some(a => a.toLowerCase().includes(lowerQuery)) ||
    citation.type.toLowerCase().includes(lowerQuery)
  );
}
