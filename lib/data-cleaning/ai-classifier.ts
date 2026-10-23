/**
 * AI Assistive Classifier for Data Cleaning & Migration Studio
 * 
 * Capabilities:
 * - Suggests accounting data part roles (CoA, Invoices, Bills, GL, Customers, Vendors, Bank, etc.)
 * - Suggests source-column to canonical-target-field mappings
 * - Explains anomalies and unmapped accounts
 * 
 * SAFETY INVARIANTS:
 * - Never receives entire large files; receives bounded sample (header + top 5 sample rows).
 * - All suggestions are advisory with review_status: "pending".
 * - Never modifies financial values, tax decisions, or GL postings.
 * - Falls back to deterministic heuristics if AI providers fail or time out.
 */

import { z } from 'zod';
import { DataPartType, ParsedSheet } from './types';

export interface ColumnMappingSuggestion {
  sourceColumn: string;
  targetField: string;
  confidence: number;
  mappingReason: string;
  reviewStatus: 'pending';
}

export interface AiClassificationResult {
  suggestedPart: DataPartType;
  confidence: number;
  reason: string;
  columnMappings: ColumnMappingSuggestion[];
  anomaliesDetected?: string[];
  providerUsed: string;
  reviewStatus: 'pending';
}

// Zod Schema for structured AI response validation
export const AiClassificationResponseSchema = z.object({
  suggestedPart: z.enum([
    'chart_of_accounts',
    'customer_master',
    'vendor_master',
    'sales_invoices',
    'purchase_bills',
    'customer_payments',
    'vendor_payments',
    'bank_transactions',
    'general_ledger',
    'trial_balance',
    'opening_balances',
    'payroll',
    'fixed_assets',
    'inventory',
    'tax_wht',
    'other',
  ]),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  columnMappings: z.array(
    z.object({
      sourceColumn: z.string(),
      targetField: z.string(),
      confidence: z.number().min(0).max(1),
      mappingReason: z.string(),
    })
  ),
  anomaliesDetected: z.array(z.string()).optional(),
});

/**
 * Classifies a parsed sheet using bounded sampling and multi-provider AI cascading.
 */
export async function classifySheetWithAi(
  sheet: ParsedSheet,
  coaContext?: Array<{ code: string; name: string }>
): Promise<AiClassificationResult> {
  // 1. Prepare Bounded Sample (Header + Top 5 rows max)
  const sampleRows = sheet.rows.slice(0, 5).map((r) => r.data);
  const promptContext = {
    sheetName: sheet.sheetName,
    headers: sheet.headers,
    totalRowCount: sheet.totalRows,
    sampleRows,
    availableChartOfAccounts: coaContext?.slice(0, 20),
  };

  // 2. Attempt AI Provider Chain (Gemini -> OpenAI -> Groq)
  try {
    const aiResponse = await callAiProviderChain(promptContext);
    if (aiResponse) {
      const validated = AiClassificationResponseSchema.safeParse(aiResponse.data);
      if (validated.success) {
        return {
          suggestedPart: validated.data.suggestedPart as DataPartType,
          confidence: validated.data.confidence,
          reason: validated.data.reason,
          columnMappings: validated.data.columnMappings.map((m) => ({
            sourceColumn: m.sourceColumn,
            targetField: m.targetField,
            confidence: m.confidence,
            mappingReason: m.mappingReason,
            reviewStatus: 'pending',
          })),
          anomaliesDetected: validated.data.anomaliesDetected,
          providerUsed: aiResponse.provider,
          reviewStatus: 'pending',
        };
      }
    }
  } catch (err) {
    // Graceful fallback on AI provider error / timeout
  }

  // 3. Deterministic Heuristic Fallback
  return fallbackDeterministicClassification(sheet);
}

/**
 * Calls available AI providers with structured JSON prompt.
 */
async function callAiProviderChain(
  context: Record<string, unknown>
): Promise<{ data: unknown; provider: string } | null> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  const prompt = `You are a professional Chartered Accountant assistant for an accounting data migration studio.
Analyze the following accounting sheet structure and sample rows:
${JSON.stringify(context, null, 2)}

Respond with STRICT JSON matching this schema:
{
  "suggestedPart": "chart_of_accounts" | "customer_master" | "vendor_master" | "sales_invoices" | "purchase_bills" | "bank_transactions" | "general_ledger" | "trial_balance" | "opening_balances" | "payroll" | "fixed_assets" | "inventory" | "tax_wht" | "other",
  "confidence": 0.0 to 1.0,
  "reason": "Clear explanation of classification",
  "columnMappings": [
    {
      "sourceColumn": "column_name",
      "targetField": "standard_accounting_field",
      "confidence": 0.0 to 1.0,
      "mappingReason": "Reason for mapping"
    }
  ],
  "anomaliesDetected": ["list of any suspicious or unusual items"]
}`;

  // Try Gemini
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(10000), // 10s timeout
        }
      );
      if (res.ok) {
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return { data: JSON.parse(text), provider: 'gemini-1.5-flash' };
        }
      }
    } catch {
      // Continue to OpenAI
    }
  }

  // Try OpenAI
  if (openaiKey) {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const json = await res.json();
        const text = json.choices?.[0]?.message?.content;
        if (text) {
          return { data: JSON.parse(text), provider: 'gpt-4o-mini' };
        }
      }
    } catch {
      // Continue to Groq
    }
  }

  // Try Groq
  if (groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const json = await res.json();
        const text = json.choices?.[0]?.message?.content;
        if (text) {
          return { data: JSON.parse(text), provider: 'groq/llama-3.3-70b' };
        }
      }
    } catch {
      // Fall through to heuristic
    }
  }

  return null;
}

/**
 * Deterministic fallback when AI is unavailable or fails validation.
 */
function fallbackDeterministicClassification(sheet: ParsedSheet): AiClassificationResult {
  const hLower = sheet.headers.map((h) => h.toLowerCase());
  let suggestedPart: DataPartType = 'other';
  let confidence = 0.5;
  let reason = 'Deterministic rule classification based on column names.';

  if (
    hLower.some((h) => h.includes('account_code') || h.includes('code')) &&
    hLower.some((h) => h.includes('account_name') || h.includes('name')) &&
    !hLower.some((h) => h.includes('invoice') || h.includes('bill'))
  ) {
    suggestedPart = 'chart_of_accounts';
    confidence = 0.9;
    reason = 'Identified account code and account name columns.';
  } else if (
    hLower.some((h) => h.includes('invoice') || h.includes('inv_no') || h.includes('inv_num')) &&
    hLower.some((h) => h.includes('customer') || h.includes('client'))
  ) {
    suggestedPart = 'sales_invoices';
    confidence = 0.9;
    reason = 'Identified invoice reference and customer fields.';
  } else if (
    hLower.some((h) => h.includes('bill') || h.includes('bill_no') || h.includes('purchase')) &&
    hLower.some((h) => h.includes('vendor') || h.includes('supplier'))
  ) {
    suggestedPart = 'purchase_bills';
    confidence = 0.9;
    reason = 'Identified bill reference and vendor fields.';
  } else if (
    hLower.some((h) => h.includes('customer') || h.includes('client')) &&
    hLower.some((h) => h.includes('email') || h.includes('phone') || h.includes('ntn'))
  ) {
    suggestedPart = 'customer_master';
    confidence = 0.85;
    reason = 'Identified customer contact and identity fields.';
  } else if (
    hLower.some((h) => h.includes('vendor') || h.includes('supplier')) &&
    hLower.some((h) => h.includes('email') || h.includes('phone') || h.includes('ntn'))
  ) {
    suggestedPart = 'vendor_master';
    confidence = 0.85;
    reason = 'Identified vendor contact and identity fields.';
  } else if (
    hLower.some((h) => h.includes('debit') || h.includes('dr')) &&
    hLower.some((h) => h.includes('credit') || h.includes('cr'))
  ) {
    suggestedPart = 'general_ledger';
    confidence = 0.92;
    reason = 'Identified dual debit and credit transaction columns.';
  }

  // Derive column mappings
  const columnMappings: ColumnMappingSuggestion[] = sheet.headers.map((h) => {
    const lower = h.toLowerCase();
    let target = lower;
    let mapConfidence = 0.8;

    if (lower.includes('code')) target = 'account_code';
    else if (lower.includes('name') && suggestedPart === 'chart_of_accounts') target = 'account_name';
    else if (lower.includes('customer')) target = 'customer_name';
    else if (lower.includes('vendor') || lower.includes('supplier')) target = 'vendor_name';
    else if (lower.includes('invoice') || lower.includes('inv_num')) target = 'invoice_number';
    else if (lower.includes('bill') || lower.includes('bill_num')) target = 'bill_number';
    else if (lower.includes('date')) target = 'transaction_date';
    else if (lower.includes('debit') || lower === 'dr') target = 'debit_amount';
    else if (lower.includes('credit') || lower === 'cr') target = 'credit_amount';
    else if (lower.includes('tax') || lower.includes('vat') || lower.includes('gst')) target = 'tax_rate';
    else if (lower.includes('total') || lower.includes('amount') || lower.includes('net')) target = 'total_amount';
    else {
      target = lower;
      mapConfidence = 0.5;
    }

    return {
      sourceColumn: h,
      targetField: target,
      confidence: mapConfidence,
      mappingReason: `Heuristic mapping from "${h}" to "${target}".`,
      reviewStatus: 'pending',
    };
  });

  return {
    suggestedPart,
    confidence,
    reason,
    columnMappings,
    providerUsed: 'deterministic-heuristic',
    reviewStatus: 'pending',
  };
}
