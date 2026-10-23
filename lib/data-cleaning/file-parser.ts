/**
 * Multi-Format File Parser for Data Cleaning & Migration Studio
 * 
 * Supports: CSV, XLSX, XLS, JSON, TSV, TXT
 * Enforces:
 * - Max 25 MB file size
 * - Max 100,000 rows
 * - Non-destructive: preserves original bytes immutably
 * - Retains 1-indexed source row, sheet, and column references
 */

import path from 'path';
import * as XLSX from 'xlsx';
import { computeSha256 } from '@/lib/storage/storage-service';
import {
  detectHeaderRow,
  computeTwoTierFingerprint,
} from '@/lib/import-wizard/header-detector';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_ROW_COUNT,
  ParsedFileResult,
  ParsedSheet,
  RawRow,
} from './types';

/**
 * Parses raw file buffer into structured sheets and rows with exact line traceability.
 */
export function parseFileContent(filename: string, buffer: Buffer): ParsedFileResult {
  // 1. Boundary & Safety Checks
  if (!buffer || buffer.byteLength === 0) {
    throw new Error(`Parse Error: File "${filename}" is empty (0 bytes).`);
  }

  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `Parse Error: File "${filename}" size (${(buffer.byteLength / (1024 * 1024)).toFixed(2)} MB) exceeds the 25 MB maximum limit.`
    );
  }

  const ext = path.extname(filename).toLowerCase();
  const fileHash = computeSha256(buffer);
  let sheets: ParsedSheet[] = [];

  try {
    switch (ext) {
      case '.csv':
        sheets = [parseCsvBuffer(filename, buffer, ',')];
        break;
      case '.tsv':
      case '.txt':
        sheets = [parseCsvBuffer(filename, buffer, '\t')];
        break;
      case '.xlsx':
      case '.xls':
        sheets = parseExcelBuffer(filename, buffer);
        break;
      case '.json':
        sheets = [parseJsonBuffer(filename, buffer)];
        break;
      default:
        throw new Error(`Parse Error: Unsupported file format "${ext}". Supported formats: .csv, .xlsx, .xls, .json, .tsv, .txt`);
    }
  } catch (err: any) {
    if (err.message?.startsWith('Parse Error:')) {
      throw err;
    }
    throw new Error(`Parse Error: Failed to parse corrupted or invalid file "${filename}": ${err.message}`);
  }

  // 2. Global Row Count Guard
  const totalRows = sheets.reduce((acc, s) => acc + s.totalRows, 0);
  if (totalRows > MAX_ROW_COUNT) {
    throw new Error(
      `Parse Error: File "${filename}" contains ${totalRows.toLocaleString()} rows, exceeding the 100,000 maximum row limit.`
    );
  }

  return {
    filename,
    fileSizeBytes: buffer.byteLength,
    fileHashSha256: fileHash,
    mimeType: getMimeType(ext),
    sheets,
    totalRowsAcrossSheets: totalRows,
  };
}

/**
 * Robust CSV/TSV parser handling quoted fields, commas inside quotes, escapes, and CRLF.
 */
function parseCsvBuffer(filename: string, buffer: Buffer, defaultDelimiter = ','): ParsedSheet {
  const text = buffer.toString('utf-8');
  const lines = splitCsvLines(text);

  if (lines.length === 0 || (lines.length === 1 && lines[0]!.trim() === '')) {
    throw new Error(`Parse Error: File "${filename}" contains no data rows.`);
  }

  // Auto-detect delimiter if comma yielded only 1 column but tabs/semicolons exist
  let delimiter = defaultDelimiter;
  const firstLine = lines[0]!;
  if (delimiter === ',' && !firstLine.includes(',') && firstLine.includes('\t')) {
    delimiter = '\t';
  } else if (delimiter === ',' && !firstLine.includes(',') && firstLine.includes(';')) {
    delimiter = ';';
  }

  const rawHeaderCells = parseCsvLine(firstLine, delimiter);
  const headers = rawHeaderCells.map((h, i) => h.trim() || `column_${i + 1}`);

  const rows: RawRow[] = [];
  let duplicateHeaderCount = 0;
  let blankRowCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const sourceRowNumber = i + 1; // 1-indexed (row 1 is header)

    if (rawLine.trim() === '') {
      blankRowCount++;
      continue;
    }

    const cells = parseCsvLine(rawLine, delimiter);

    // Check if this row is a duplicate header row
    const isDuplicateHeader =
      cells.length === headers.length &&
      cells.every((c, idx) => c.trim().toLowerCase() === headers[idx]!.toLowerCase());

    if (isDuplicateHeader) {
      duplicateHeaderCount++;
      continue;
    }

    const rowData: Record<string, string> = {};
    const rawValues: Record<string, unknown> = {};

    headers.forEach((h, colIdx) => {
      const val = (cells[colIdx] ?? '').trim();
      rowData[h] = val;
      rawValues[h] = val;
    });

    const isAllBlank = Object.values(rowData).every((v) => v === '');
    if (isAllBlank) {
      blankRowCount++;
      continue;
    }

    rows.push({
      sourceRowNumber,
      sheetName: 'Sheet1',
      data: rowData,
      rawValues,
    });
  }

  return {
    sheetName: 'Sheet1',
    headers,
    rows,
    totalRows: rows.length,
    duplicateHeaderCount,
    blankRowCount,
  };
}

/**
 * Splits CSV text by newline while respecting quoted multi-line fields.
 */
function splitCsvLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
        current += char;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip LF
      }
      lines.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

/**
 * Parses a single CSV line into an array of string values respecting quotes and escapes.
 */
function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

/**
 * Parses XLSX/XLS workbook preserving sheets and cell formats.
 */
function parseExcelBuffer(filename: string, buffer: Buffer): ParsedSheet[] {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellNF: true,
    cellText: true,
  });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error(`Parse Error: Excel file "${filename}" contains no sheets.`);
  }

  const parsedSheets: ParsedSheet[] = [];

  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    // Convert sheet to array of row arrays
    const jsonRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      dateNF: 'yyyy-mm-dd',
      defval: '',
    });

    if (jsonRows.length === 0) {
      parsedSheets.push({
        sheetName,
        headers: [],
        rows: [],
        totalRows: 0,
        duplicateHeaderCount: 0,
        blankRowCount: 0,
      });
      continue;
    }

    const rawHeaderRow = (jsonRows[0] as unknown[]) || [];
    const headers = rawHeaderRow.map((h, i) => String(h || '').trim() || `column_${i + 1}`);

    const rows: RawRow[] = [];
    let duplicateHeaderCount = 0;
    let blankRowCount = 0;

    for (let r = 1; r < jsonRows.length; r++) {
      const rowArr = (jsonRows[r] as unknown[]) || [];
      const sourceRowNumber = r + 1;

      const isAllBlank = rowArr.every((cell) => cell === undefined || cell === null || String(cell).trim() === '');
      if (isAllBlank) {
        blankRowCount++;
        continue;
      }

      // Check if duplicate header
      const isDuplicateHeader =
        rowArr.length === headers.length &&
        rowArr.every((c, idx) => String(c || '').trim().toLowerCase() === headers[idx]!.toLowerCase());

      if (isDuplicateHeader) {
        duplicateHeaderCount++;
        continue;
      }

      const rowData: Record<string, string> = {};
      const rawValues: Record<string, unknown> = {};

      headers.forEach((h, colIdx) => {
        const val = rowArr[colIdx];
        const strVal = val === undefined || val === null ? '' : String(val).trim();
        rowData[h] = strVal;
        rawValues[h] = val;
      });

      rows.push({
        sourceRowNumber,
        sheetName,
        data: rowData,
        rawValues,
      });
    }

    parsedSheets.push({
      sheetName,
      headers,
      rows,
      totalRows: rows.length,
      duplicateHeaderCount,
      blankRowCount,
    });
  }

  return parsedSheets;
}

/**
 * Parses JSON buffer (Array of objects or structured sheets).
 */
function parseJsonBuffer(filename: string, buffer: Buffer): ParsedSheet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf-8'));
  } catch (err: any) {
    throw new Error(`Parse Error: Malformed JSON in file "${filename}": ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    if (typeof parsed === 'object' && parsed !== null) {
      // Check if single record or object with rows
      const values = Object.values(parsed);
      const arrayProp = values.find((v) => Array.isArray(v));
      if (arrayProp && Array.isArray(arrayProp)) {
        parsed = arrayProp;
      } else {
        parsed = [parsed];
      }
    } else {
      throw new Error(`Parse Error: JSON root must be an array of objects or an object containing an array.`);
    }
  }

  const items = parsed as Record<string, unknown>[];
  if (items.length === 0) {
    return {
      sheetName: 'Sheet1',
      headers: [],
      rows: [],
      totalRows: 0,
      duplicateHeaderCount: 0,
      blankRowCount: 0,
    };
  }

  // Extract all distinct keys as headers
  const headerSet = new Set<string>();
  items.forEach((item) => {
    if (typeof item === 'object' && item !== null) {
      Object.keys(item).forEach((k) => headerSet.add(k));
    }
  });

  const headers = Array.from(headerSet);
  const rows: RawRow[] = items.map((item, idx) => {
    const data: Record<string, string> = {};
    const rawValues: Record<string, unknown> = {};

    headers.forEach((h) => {
      const val = item[h];
      const strVal = val === undefined || val === null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val);
      data[h] = strVal;
      rawValues[h] = val;
    });

    return {
      sourceRowNumber: idx + 1,
      sheetName: 'Sheet1',
      data,
      rawValues,
    };
  });

  return {
    sheetName: 'Sheet1',
    headers,
    rows,
    totalRows: rows.length,
    duplicateHeaderCount: 0,
    blankRowCount: 0,
  };
}

function getMimeType(ext: string): string {
  switch (ext) {
    case '.csv':
      return 'text/csv';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.json':
      return 'application/json';
    case '.tsv':
      return 'text/tab-separated-values';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

// ---------------------------------------------------------------------------
// Streamlined ParsedFile Interface and Helpers for Universal Ingestion
// ---------------------------------------------------------------------------

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  data: Record<string, string>[];
  rowCount: number;
  format: 'csv' | 'xlsx';
  filename: string;
  suggestedHeaderRow?: number;
  headerDetectionConfidence?: 'high' | 'medium' | 'low';
  skippedPreambleRows?: string[][];
  rawRows?: string[][];
  structuralFingerprint?: string;
  exactTextFingerprint?: string;
}

function sanitizeCell(val: string): string {
  if (!val) return '';
  let s = String(val).trim();
  // Strip formula injection characters at start
  while (s.length > 0 && ['=', '+', '-', '@', '\t', '\r'].includes(s[0]!)) {
    s = s.slice(1).trim();
  }
  return s;
}

export function parseCSVText(text: string, skipTopNRows?: number): ParsedFile {
  if (!text || !text.trim()) {
    throw new Error('CSV text is empty');
  }
  const lines = splitCsvLines(text);
  if (lines.length === 0) {
    throw new Error('CSV contains no data rows');
  }
  let delimiter = ',';
  const firstLine = lines[0]!;
  if (!firstLine.includes(',') && firstLine.includes('\t')) delimiter = '\t';
  else if (!firstLine.includes(',') && firstLine.includes(';')) delimiter = ';';

  // Parse all lines into raw cell arrays
  const rawGrid: string[][] = lines.map((l) => parseCsvLine(l, delimiter));
  const detection = detectHeaderRow(rawGrid);

  const enableAutoHeaderSkip = process.env.ENABLE_AUTO_HEADER_SKIP !== 'false';
  const headerIndex = typeof skipTopNRows === 'number' && skipTopNRows >= 0
    ? skipTopNRows
    : (enableAutoHeaderSkip ? detection.suggestedHeaderRow : 0);

  const preambleRows = rawGrid.slice(0, headerIndex);
  const rawHeaders = rawGrid[headerIndex] || [];
  const headers = rawHeaders.map((h, i) => sanitizeCell(h) || `column_${i + 1}`);

  const { structuralFingerprint, exactTextFingerprint } = computeTwoTierFingerprint(
    preambleRows,
    headers
  );

  const dataRows = rawGrid.slice(headerIndex + 1);
  const rows: Record<string, string>[] = [];
  for (let r = 0; r < dataRows.length; r++) {
    const cells = dataRows[r]!;
    if (!cells.some((c) => c && c.trim())) continue;
    const rowObj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowObj[h] = sanitizeCell(cells[idx] ?? '');
    });
    rows.push(rowObj);
  }

  return {
    headers,
    rows,
    data: rows,
    rowCount: rows.length,
    format: 'csv',
    filename: 'input.csv',
    suggestedHeaderRow: detection.suggestedHeaderRow,
    headerDetectionConfidence: detection.confidence,
    skippedPreambleRows: preambleRows,
    rawRows: rawGrid,
    structuralFingerprint,
    exactTextFingerprint,
  };
}

export function parseFileBuffer(buffer: Buffer, filename: string, skipTopNRows?: number): ParsedFile {
  if (!buffer || buffer.length === 0) {
    throw new Error(`File "${filename}" is empty`);
  }
  if (buffer.length > 10 * 1024 * 1024) {
    throw new Error(`File "${filename}" exceeds 10MB limit`);
  }

  const lowerFilename = filename.toLowerCase();
  if (lowerFilename.endsWith('.csv') || lowerFilename.endsWith('.tsv') || lowerFilename.endsWith('.txt')) {
    const text = buffer.toString('utf-8');
    const parsed = parseCSVText(text, skipTopNRows);
    parsed.filename = filename;
    return parsed;
  } else if (lowerFilename.endsWith('.xlsx') || lowerFilename.endsWith('.xls')) {
    if (lowerFilename.endsWith('.xlsx')) {
      if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
        throw new Error('Invalid file type or corrupted XLSX: ZIP magic bytes missing');
      }
    }

    try {
      const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
      if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
        throw new Error('XLSX workbook contains no sheets');
      }
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]!];
      if (!firstSheet) {
        throw new Error('First worksheet in XLSX is empty');
      }
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, defval: '' });
      const nonBlank: string[][] = rawRows
        .map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : []))
        .filter((r) => r.some((c) => c !== undefined && c !== null && String(c).trim() !== ''));

      if (nonBlank.length === 0) {
        throw new Error('XLSX sheet contains no data rows');
      }

      const detection = detectHeaderRow(nonBlank);
      const enableAutoHeaderSkip = process.env.ENABLE_AUTO_HEADER_SKIP !== 'false';
      const headerIndex = typeof skipTopNRows === 'number' && skipTopNRows >= 0
        ? skipTopNRows
        : (enableAutoHeaderSkip ? detection.suggestedHeaderRow : 0);

      const preambleRows = nonBlank.slice(0, headerIndex);
      const headerRow = nonBlank[headerIndex] || [];
      const headers = headerRow.map((h, i) => sanitizeCell(String(h || '')) || `column_${i + 1}`);

      const { structuralFingerprint, exactTextFingerprint } = computeTwoTierFingerprint(
        preambleRows,
        headers
      );

      const dataRows = nonBlank.slice(headerIndex + 1);
      const rows: Record<string, string>[] = [];
      for (let i = 0; i < dataRows.length; i++) {
        const rowArr = dataRows[i] || [];
        const rowObj: Record<string, string> = {};
        headers.forEach((h, colIdx) => {
          rowObj[h] = sanitizeCell(String(rowArr[colIdx] ?? ''));
        });
        rows.push(rowObj);
      }

      return {
        headers,
        rows,
        data: rows,
        rowCount: rows.length,
        format: 'xlsx',
        filename,
        suggestedHeaderRow: detection.suggestedHeaderRow,
        headerDetectionConfidence: detection.confidence,
        skippedPreambleRows: preambleRows,
        rawRows: nonBlank,
        structuralFingerprint,
        exactTextFingerprint,
      };
    } catch (err: any) {
      if (err.message && (err.message.includes('limit') || err.message.includes('magic bytes') || err.message.includes('empty'))) {
        throw err;
      }
      throw new Error(`Corrupted or unreadable Excel file: ${err.message}`);
    }
  } else {
    throw new Error('Unsupported file format. Please provide a .csv or .xlsx file.');
  }
}

