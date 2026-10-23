import { stringSimilarity } from '@/lib/data-cleaning/anomaly-detector';
import { query } from '@/lib/db';

export type CanonicalField =
  | 'transaction_id'
  | 'transaction_group_id'
  | 'line_number'
  | 'transaction_description'
  | 'line_description'
  | 'memo'
  | 'entry_date'
  | 'debit_paisa'
  | 'credit_paisa'
  | 'account_code'
  | 'description'
  | 'reference_number'
  | 'counterparty_name'
  | 'payment_method'
  | 'amount'
  | 'quantity'
  | 'unit_price'
  | 'tax'
  | 'total'
  | 'employee_name'
  | 'salary'
  | 'allowances'
  | 'deductions'
  | 'net_pay'
  | 'bank_account'
  | 'item_description'
  | 'payment_status'
  | 'category'
  | 'balance';

export interface ColumnMapping {
  sourceColumn: string;
  targetField: CanonicalField | null;
  confidence: 'high' | 'medium' | 'low';
  isAutoMapped: boolean;
}

export const ALIAS_DICTIONARY: Record<CanonicalField, string[]> = {
  transaction_id: ['transaction_id', 'transaction id', 'tx id', 'txn id', 'transactionid', 'voucher_no', 'voucher no', 'voucher_id', 'entry_id'],
  transaction_group_id: ['transaction_group_id', 'transaction_external_id', 'transaction external id', 'transaction_group', 'group_id', 'group id', 'external_id', 'external id', 'txn_group_id', 'tx_group_id'],
  line_number: ['line_number', 'line number', 'line_no', 'line no', 'lineno', 'line', 'item_no', 'item no'],
  transaction_description: ['transaction_description', 'transaction description', 'txn description', 'tx description', 'main description'],
  line_description: ['line_description', 'line description', 'sub description'],
  memo: ['memo', 'narration', 'notes', 'reference narration', 'memo narration', 'extra narration'],
  entry_date: ['date', 'txn date', 'posting date', 'entry date', 'invoice date', 'bill date', 'payment date', 'transaction date', 'entry_date'],
  debit_paisa: ['debit', 'dr', 'debit amount', 'debit_paisa'],
  credit_paisa: ['credit', 'cr', 'credit amount', 'credit_paisa'],
  account_code: ['account', 'account code', 'coa', 'gl code', 'account_code', 'a/c code'],
  description: ['description', 'narration', 'details', 'particulars', 'item description'],
  reference_number: ['reference', 'ref no', 'invoice no', 'bill no', 'reference number', 'ref', 'invoice number', 'reference_number'],
  counterparty_name: ['customer', 'customer name', 'vendor', 'supplier', 'vendor name', 'supplier name', 'payee'],
  payment_method: ['payment mode', 'method', 'payment method'],
  amount: ['amount', 'total amount', 'net amount', 'amount received'],
  quantity: ['quantity', 'qty'],
  unit_price: ['unit price', 'rate', 'price'],
  tax: ['tax', 'tax amount', 'gst', 'sales tax'],
  total: ['total', 'gross total', 'invoice total'],
  balance: ['balance', 'running balance'],
  employee_name: ['employee name', 'employee', 'staff name'],
  salary: ['salary', 'basic salary', 'gross salary'],
  allowances: ['allowances', 'total allowances'],
  deductions: ['deductions', 'total deductions'],
  net_pay: ['net pay', 'net salary', 'take home'],
  bank_account: ['bank account', 'account number', 'bank a/c'],
  category: ['category', 'expense category', 'type'],
  payment_status: ['payment status', 'status', 'paid'],
  item_description: ['item description', 'details']
};

export function autoMapColumns(headers: string[]): ColumnMapping[] {
  return headers.map(header => {
    const normalizedHeader = header.toLowerCase().trim();
    
    // Check exact match in alias dictionary (High confidence)
    for (const [field, aliases] of Object.entries(ALIAS_DICTIONARY)) {
      if (aliases.includes(normalizedHeader)) {
        return {
          sourceColumn: header,
          targetField: field as CanonicalField,
          confidence: 'high',
          isAutoMapped: true
        };
      }
    }

    // Fuzzy match (Medium confidence)
    let bestMatch: CanonicalField | null = null;
    let highestScore = 0;

    for (const [field, aliases] of Object.entries(ALIAS_DICTIONARY)) {
      for (const alias of aliases) {
        const score = stringSimilarity(normalizedHeader, alias);
        if (score > highestScore) {
          highestScore = score;
          bestMatch = field as CanonicalField;
        }
      }
    }

    if (highestScore >= 0.85 && bestMatch) {
      return {
        sourceColumn: header,
        targetField: bestMatch,
        confidence: 'medium',
        isAutoMapped: true
      };
    }

    // Unmapped (Low confidence)
    return {
      sourceColumn: header,
      targetField: null,
      confidence: 'low',
      isAutoMapped: false
    };
  });
}

export async function saveMappingPreset(clientId: number, mappings: ColumnMapping[]): Promise<void> {
  // Clear existing preset for client
  await query('DELETE FROM cleaning_mappings WHERE job_id = 0 AND mapped_by = $1', [clientId.toString()]);
  
  // Insert new presets
  for (const mapping of mappings) {
    if (mapping.targetField) {
      await query(
        `INSERT INTO cleaning_mappings (job_id, source_column, target_field, confidence_score, mapped_by) 
         VALUES (0, $1, $2, $3, $4)`,
        [mapping.sourceColumn, mapping.targetField, mapping.confidence === 'high' ? 1.0 : mapping.confidence === 'medium' ? 0.8 : 0.5, clientId.toString()]
      );
    }
  }
}

interface PresetRow {
  source_column: string;
  target_field: string;
  confidence_score: number;
}

export async function loadMappingPreset(clientId: number): Promise<ColumnMapping[] | null> {
  const result = await query<PresetRow>(
    'SELECT source_column, target_field, confidence_score FROM cleaning_mappings WHERE job_id = 0 AND mapped_by = $1',
    [clientId.toString()]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows.map(row => ({
    sourceColumn: row.source_column,
    targetField: row.target_field as CanonicalField,
    confidence: Number(row.confidence_score) >= 0.9 ? 'high' : Number(row.confidence_score) >= 0.75 ? 'medium' : 'low',
    isAutoMapped: true
  }));
}

