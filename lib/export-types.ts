/**
 * Type definitions for document export functionality.
 */

export type ExportFormat = 'txt' | 'md' | 'pdf' | 'json' | 'html';

export interface PdfExportOptions {
  paperSize?: 'A4' | 'Letter' | 'Legal';
  margins?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  fontScale?: number;
}

export interface ExportResult {
  success: boolean;
  filename?: string;
  error?: string;
}

export interface DocumentExportData {
  title: string;
  content: string;
  format: ExportFormat;
  metadata?: {
    createdAt: Date;
    updatedAt: Date;
    wordCount: number;
  };
}
