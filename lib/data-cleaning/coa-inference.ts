/**
 * lib/data-cleaning/coa-inference.ts
 *
 * Universal Chart of Accounts Auto-Classification & Name Inference Engine.
 * 
 * Features:
 * 1. Auto-classifies account codes by numerical pattern (1xxx=Asset, 2xxx=Liability, 3xxx=Equity, 4xxx=Revenue, 5xxx/6xxx=Expense)
 * 2. Auto-infers human-readable accounting account names from transaction descriptions
 * 3. Extracts unique account codes with frequency counts from raw CSV/JSON rows
 */

export interface InferredAccount {
  code: string;
  inferredName: string;
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  normalSide: 'debit' | 'credit';
  usageCount: number;
}

/**
 * Classifies an account code based on standard general ledger numbering patterns.
 * 
 * 1xxx: Asset (Debit)
 * 2xxx: Liability (Credit)
 * 3xxx: Equity (Credit)
 * 4xxx: Revenue / Income (Credit)
 * 5xxx: Expense / COGS (Debit)
 * 6xxx: Administrative / Operating Expense (Debit)
 */
export function classifyAccountCode(code: string, sampleDesc = ''): {
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  normalSide: 'debit' | 'credit';
} {
  const cleanCode = code.trim().replace(/\D/g, '');
  const firstDigit = cleanCode.charAt(0);

  if (firstDigit === '1') {
    return { accountType: 'asset', normalSide: 'debit' };
  } else if (firstDigit === '2') {
    return { accountType: 'liability', normalSide: 'credit' };
  } else if (firstDigit === '3') {
    return { accountType: 'equity', normalSide: 'credit' };
  } else if (firstDigit === '4') {
    return { accountType: 'income', normalSide: 'credit' };
  } else if (firstDigit === '5' || firstDigit === '6') {
    return { accountType: 'expense', normalSide: 'debit' };
  }

  // Fallback heuristic based on transaction context
  const d = sampleDesc.toLowerCase();
  if (d.includes('sale') || d.includes('revenue') || d.includes('income') || d.includes('service fee') || d.includes('consulting fee')) {
    return { accountType: 'income', normalSide: 'credit' };
  }
  if (d.includes('bank') || d.includes('cash') || d.includes('receivable') || d.includes('deposit') || d.includes('asset')) {
    return { accountType: 'asset', normalSide: 'debit' };
  }
  if (d.includes('payable') || d.includes('loan') || d.includes('liability') || d.includes('tax payable')) {
    return { accountType: 'liability', normalSide: 'credit' };
  }
  if (d.includes('capital') || d.includes('equity') || d.includes('drawing')) {
    return { accountType: 'equity', normalSide: 'credit' };
  }

  return { accountType: 'expense', normalSide: 'debit' };
}

/**
 * Infers an account name based on recurring transaction descriptions.
 */
export function inferAccountName(code: string, descriptions: string[]): string {
  const combined = descriptions.join(' ').toLowerCase();

  // Explicit keyword mappings per business specifications
  if (combined.includes('rent')) return 'Rent Expense';
  if (combined.includes('electric') || combined.includes('utility') || combined.includes('power') || combined.includes('water') || combined.includes('internet')) {
    return 'Utilities Expense';
  }
  if (combined.includes('salar') || combined.includes('wage') || combined.includes('payroll') || combined.includes('staff')) {
    return 'Salaries Expense';
  }
  if (combined.includes('suppl') || combined.includes('stationer') || combined.includes('toner') || combined.includes('paper')) {
    return 'Office Supplies Expense';
  }
  if (combined.includes('cloud') || combined.includes('software') || combined.includes('subscription') || combined.includes('saas') || combined.includes('hosting')) {
    return 'Software Subscription Expense';
  }
  if (combined.includes('market') || combined.includes('promot') || combined.includes('ad') || combined.includes('facebook') || combined.includes('meta')) {
    return 'Marketing Expense';
  }
  if (combined.includes('travel') || combined.includes('conveyance') || combined.includes('fuel') || combined.includes('transport') || combined.includes('diesel')) {
    return 'Travel Expense';
  }
  if (combined.includes('income tax') || combined.includes('tax payment')) {
    return 'Income Tax Expense';
  }
  if (combined.includes('audit') || combined.includes('legal') || combined.includes('retainer') || combined.includes('filing')) {
    return 'Professional & Legal Expense';
  }
  if (combined.includes('repair') || combined.includes('maintenance')) {
    return 'Repairs & Maintenance Expense';
  }
  if (combined.includes('courier') || combined.includes('postage') || combined.includes('dispatch')) {
    return 'Courier & Postage Expense';
  }
  if (combined.includes('sale of goods') || combined.includes('sales')) {
    return 'Sales Revenue';
  }
  if (combined.includes('service') || combined.includes('advisory') || combined.includes('consulting')) {
    return 'Service Revenue';
  }
  if (combined.includes('other income') || combined.includes('dividend') || combined.includes('interest')) {
    return 'Other Income';
  }
  if (code === '1010' || code === '1020' || combined.includes('bank') || combined.includes('amount received')) {
    return 'Bank Account';
  }
  if (combined.includes('collection') || combined.includes('customer') || combined.includes('receivable')) {
    return 'Accounts Receivable';
  }
  if (combined.includes('payable') || combined.includes('vendor')) {
    return 'Accounts Payable';
  }

  // Dynamic clean title derivation from cleanest description
  const cleanList = descriptions
    .map(d => d.replace(/#\d+|REF-\w+|\b(monthly|payment|expense|disbursement|purchase|fee|charges|cost)\b/gi, '').trim())
    .filter(d => d.length >= 3);

  if (cleanList.length > 0) {
    const shortest = cleanList.reduce((a, b) => a.length <= b.length ? a : b);
    const title = shortest.charAt(0).toUpperCase() + shortest.slice(1);
    const classification = classifyAccountCode(code);
    return `${title} ${classification.accountType === 'income' ? 'Revenue' : 'Expense'}`;
  }

  const c = classifyAccountCode(code);
  return `${c.accountType.charAt(0).toUpperCase() + c.accountType.slice(1)} Account ${code}`;
}

/**
 * Extracts unique account codes, counts usage frequency, and infers account metadata.
 */
export function extractUniqueAccounts(
  rows: Array<{ accountCode?: string; account_code?: string; description?: string; memo?: string }>
): InferredAccount[] {
  const codeMap = new Map<string, { count: number; descriptions: string[] }>();

  for (const row of rows) {
    const code = (row.accountCode || row.account_code || '').toString().trim();
    if (!code) continue;
    const desc = (row.description || row.memo || '').toString().trim();
    const existing = codeMap.get(code);
    if (existing) {
      existing.count++;
      if (desc && !existing.descriptions.includes(desc)) {
        existing.descriptions.push(desc);
      }
    } else {
      codeMap.set(code, { count: 1, descriptions: desc ? [desc] : [] });
    }
  }

  const accounts: InferredAccount[] = [];
  for (const [code, info] of codeMap.entries()) {
    const classification = classifyAccountCode(code, info.descriptions[0] || '');
    const inferredName = inferAccountName(code, info.descriptions);
    accounts.push({
      code,
      inferredName,
      accountType: classification.accountType,
      normalSide: classification.normalSide,
      usageCount: info.count,
    });
  }

  return accounts.sort((a, b) => a.code.localeCompare(b.code));
}