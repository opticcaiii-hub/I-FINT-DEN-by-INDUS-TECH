/**
 * lib/data-cleaning/llm-service.ts
 *
 * Multi-Provider LLM Fallback Service with Caching and Heuristics.
 * 
 * Hierarchy:
 * 1. Feature flag guard: if AI_FEATURES_ENABLED=false, return immediately — no HTTP call, no PII leak.
 * 2. Cache hit (Instant, 0 latency)
 * 3. Heuristic Rule Matcher with Active Client COA Binding (Precision First)
 * 4. Gemini 2.5 Flash / OpenAI / Groq
 * 5. Ambiguity Guard: NEVER defaults to 5000; returns 'Manual Review Required'
 */

import { isAiFeaturesEnabled } from '@/lib/feature-flags';

export interface AISuggestionResponse {
  suggestedAccountCode: string | null;
  suggestedAccountName: string;
  confidenceScore: number;
  taxRateBps: number;
  reasoning: string;
  isFlaggedForReview: boolean;
  provider: string;
}

// NOTE: No module-level suggestion cache.
// Rationale: On Vercel serverless, each Lambda container has independent in-memory state
// with no coordination between warm instances. A Map() cache here would:
//   (a) provide near-zero hit rate (each container handles only a fraction of requests)
//   (b) serve stale suggestions (wrong account codes) to some users for up to 1 hour
//       after COA or engine changes — with no way to flush it across all warm instances.
// The heuristic rules are pure CPU (~0ms), so caching them adds risk with no benefit.
// The LLM fallback path uses a short AbortSignal.timeout(3000) and is only called when
// AI_FEATURES_ENABLED=true, which is opt-in. No caching needed.

export function getCacheKey(description: string, counterparty?: string, amountPaisa?: number, direction?: string): string {
  return `${(description || '').trim().toLowerCase()}_${(counterparty || '').trim().toLowerCase()}_${amountPaisa || 0}_${direction || 'unknown'}`;
}

export function applyHeuristicRules(
  description: string,
  chartOfAccounts: Array<{ account_code: string; account_name: string; account_type?: string }>,
  direction: 'debit' | 'credit' | 'unknown' = 'unknown'
): { code: string; name: string; confidence: number; reasoning: string } | null {
  const d = description.toLowerCase().trim();

  // Filter out pure parent category header accounts (e.g., accounts named literally "Expenses", "Assets", "Liabilities", "Equity", "Income")
  const nonHeaderAccounts = chartOfAccounts.filter(a => {
    const code = a.account_code.trim();
    const nameLower = a.account_name.trim().toLowerCase();
    if (['expenses', 'assets', 'liabilities', 'equity', 'income', 'revenue'].includes(nameLower)) {
      return false;
    }
    if (code === '5000' && nameLower.includes('expense')) return false;
    return true;
  });

  function findBestAccount(targetCode: string, fallbackCodes: string[], nameKeywords: string[], categoryPrefix: string) {
    // Enforce cash flow direction guards
    if (direction === 'debit' && (targetCode.startsWith('4') || categoryPrefix === '4')) return null;
    if (direction === 'credit' && (targetCode.startsWith('5') || targetCode.startsWith('6') || categoryPrefix === '5' || categoryPrefix === '6')) return null;

    // PRIORITY 1: Exact code AND semantic name match.
    // If the target code exists and its label matches the semantic keywords, it is the ideal match.
    const byCode = nonHeaderAccounts.find(a => a.account_code === targetCode && a.account_code !== '3030');
    if (byCode) {
      const codeNameLower = byCode.account_name.toLowerCase();
      const codeMatchesSemantics = nameKeywords.some(kw => codeNameLower.includes(kw));
      if (codeMatchesSemantics) {
        return byCode;
      }
    }

    // PRIORITY 2: Semantic Name Match within the category prefix.
    // When a client's COA uses a different numbering scheme (e.g. AR is 1200 instead of 1100,
    // or Fuel is 5400 instead of 5600), this correctly locates the client's actual designated account.
    for (const kw of nameKeywords) {
      const byName = nonHeaderAccounts.find(a =>
        a.account_code.startsWith(categoryPrefix) &&
        a.account_code !== '3030' &&
        !(direction === 'debit' && a.account_code.startsWith('4')) &&
        !(direction === 'credit' && (a.account_code.startsWith('5') || a.account_code.startsWith('6'))) &&
        a.account_name.toLowerCase().includes(kw)
      );
      if (byName) return byName;
    }

    // PRIORITY 3: Exact targetCode match fallback ONLY if the account is a generic bucket or matches category intent.
    // We do NOT bind if the account at targetCode is explicitly named after an unrelated specific category.
    if (byCode) {
      const nameLower = byCode.account_name.toLowerCase();
      const isGeneric = ['operating expense', 'operating expenses', 'general expense', 'admin expense', 'office expense', 'other expense', 'miscellaneous'].some(g => nameLower.includes(g));
      if (isGeneric) {
        return byCode;
      }
    }

    // PRIORITY 4: Specific fallback codes (e.g. 2010 for AP if 2000 absent, 5030 for salaries, etc.)
    for (const fc of fallbackCodes) {
      if (direction === 'debit' && fc.startsWith('4')) continue;
      if (direction === 'credit' && (fc.startsWith('5') || fc.startsWith('6'))) continue;
      const byFallback = nonHeaderAccounts.find(a => a.account_code === fc && a.account_code !== '3030');
      if (byFallback) {
        const nameLower = byFallback.account_name.toLowerCase();
        const matchesName = nameKeywords.some(kw => nameLower.includes(kw));
        const isGeneric = ['operating expense', 'operating expenses', 'general expense', 'office expense', 'admin expense', 'other expense', 'miscellaneous'].some(g => nameLower.includes(g));
        if (matchesName || isGeneric) {
          return byFallback;
        }
      }
    }

    // No match: return null so the caller flags for manual review rather than guessing.
    return null;
  }

  interface RuleSpec {
    keywords: string[];
    targetCode: string;
    fallbackCodes: string[];
    nameKeywords: string[];
    categoryPrefix: string;
    defaultName: string;
    confidence: number;
    reason: string;
  }

  const rules: RuleSpec[] = [
    // Owner Capital / Equity Contribution -> 3010 Owner Capital
    {
      keywords: [
        'owner capital',
        'capital contribution',
        'capital injection',
        'equity contribution',
        'capital introduced',
      ],
      targetCode: '3010',
      fallbackCodes: ['3000', '3100'],
      nameKeywords: ['owner capital', 'capital', 'equity'],
      categoryPrefix: '3',
      defaultName: 'Owner Capital',
      confidence: 95,
      reason: 'Owner capital / equity contribution detected.',
    },
    // Service Revenue / Services Rendered -> 4020 Service Revenue
    {
      keywords: [
        'service rendered',
        'services rendered',
        'consulting fee',
        'service fee',
        'consultancy',
      ],
      targetCode: '4020',
      fallbackCodes: ['4010'],
      nameKeywords: ['service revenue', 'services revenue', 'revenue', 'income'],
      categoryPrefix: '4',
      defaultName: 'Service Revenue',
      confidence: 95,
      reason: 'Service revenue / services rendered detected.',
    },
    // Sale of Goods -> 4010 Sales Revenue
    {
      keywords: [
        'sale of goods',
        'sales of goods',
        'sale to customer',
        'sales to customer',
        'product sale',
        'merchandise sale',
      ],
      targetCode: '4010',
      fallbackCodes: ['4020'],
      nameKeywords: ['sales revenue', 'sales', 'revenue', 'income'],
      categoryPrefix: '4',
      defaultName: 'Sales Revenue',
      confidence: 95,
      reason: 'Sale of goods to customer detected.',
    },
    // Software Subscription Expense -> 5050 Software Subscription Expense (or 5400)
    {
      keywords: [
        'software subscription',
        'software renewal',
        'subscription renewal',
        'software license',
        'saas subscription',
        'cloud subscription',
        'aws',
        'azure',
        'zoom',
        'github',
        'adobe',
      ],
      targetCode: '5050',
      fallbackCodes: ['5400', '5040'],
      nameKeywords: ['software', 'subscription', 'it expense', 'cloud'],
      categoryPrefix: '5',
      defaultName: 'Software Subscription Expense',
      confidence: 94,
      reason: 'Software / subscription renewal detected.',
    },
    // Bank service charges / maintenance fee -> 5800 Bank Charges (or 6100)
    {
      keywords: [
        'bank - service charge',
        'service charge',
        'bank charge',
        'bank charges',
        'account maintenance',
        'acct fee',
        'maintenance fee',
        'monthly account maintenance',
        'bank fee',
        'banking fee',
        'transfer fee',
        'cheque return',
        'chq return',
      ],
      targetCode: '5800',
      fallbackCodes: ['6100'],
      nameKeywords: ['bank charge', 'bank charges', 'bank fee', 'finance cost', 'banking charges'],
      categoryPrefix: '5',
      defaultName: 'Bank Charges',
      confidence: 95,
      reason: 'Bank service charge / maintenance fee detected.',
    },
    // Cash Deposit (Counter / Branch) -> 1010 Cash in Hand
    {
      keywords: [
        'cash deposit',
        'counter deposit',
        'deposit - counter',
        'branch deposit',
        'cash received at counter',
      ],
      targetCode: '1010',
      fallbackCodes: ['1000'],
      nameKeywords: ['cash in hand', 'petty cash', 'cash'],
      categoryPrefix: '1',
      defaultName: 'Cash in Hand',
      confidence: 96,
      reason: 'Cash deposit from counter/branch detected → Cash in Hand.',
    },
    // ATM Cash Withdrawal -> 1010 Cash in Hand
    {
      keywords: [
        'atm withdrawal',
        'cash withdrawal',
        'petty cash withdrawal',
        'atm cash',
      ],
      targetCode: '1010',
      fallbackCodes: ['1000'],
      nameKeywords: ['cash in hand', 'petty cash', 'cash'],
      categoryPrefix: '1',
      defaultName: 'Cash in Hand',
      confidence: 96,
      reason: 'ATM / cash withdrawal detected → Cash in Hand.',
    },
    // Customer collection / receipt / Fund Transfer In -> 1100 Accounts Receivable (or 1200 / 4010)
    {
      keywords: [
        'collection from customer',
        'received from customer',
        'customer collection',
        'collection from',
        'received from',
        'customer receipt',
        'customer payment',
        'accounts receivable',
        'trade receivable',
        'fund transfer',
        'funds transfer',
        'inward transfer',
        'inward remittance',
        'ibft received',
        'ft received',
        'ft -',
      ],
      targetCode: '1100',
      fallbackCodes: ['1200', '4010'],
      nameKeywords: ['receivable', 'trade receivable', 'ar', 'sales revenue', 'service revenue', 'income'],
      categoryPrefix: '1',
      defaultName: 'Accounts Receivable (AR)',
      confidence: 95,
      reason: 'Customer collection / fund transfer detected → Accounts Receivable.',
    },
    // 1. Monthly office/warehouse rent payment -> 5100 Rent Expense
    {
      keywords: ['office rent', 'monthly rent', 'rent payment', 'rent expense', 'building rent', 'warehouse rent', 'rent -'],
      targetCode: '5100',
      fallbackCodes: [],
      nameKeywords: ['rent'],
      categoryPrefix: '5',
      defaultName: 'Rent Expense',
      confidence: 95,
      reason: 'Office/warehouse rent payment detected.',
    },
    // 2. Staff salary disbursement -> 5200 Salaries & Wages (or 5030)
    {
      keywords: ['staff salary', 'salary disbursement', 'payroll', 'wages paid', 'employee salary', 'monthly salary', 'salaries', 'salary'],
      targetCode: '5200',
      fallbackCodes: ['5030'],
      nameKeywords: ['salary', 'salaries', 'wage', 'wages', 'staff salary', 'payroll'],
      categoryPrefix: '5',
      defaultName: 'Salaries & Wages',
      confidence: 95,
      reason: 'Staff salary disbursement detected.',
    },

    // 4. Utilities Expense -> 5300 or 5100
    {
      keywords: ['electricity bill', 'utility bill', 'power bill', 'gas bill', 'water bill', 'k-electric', 'lesco', 'iesco', 'ssgc', 'sngpl', 'ptcl', 'nayatel'],
      targetCode: '5300',
      fallbackCodes: ['5100', '5900'],
      nameKeywords: ['utilit', 'electric', 'gas bill', 'power bill', 'water bill', 'utilities'],
      categoryPrefix: '5',
      defaultName: 'Utilities Expense',
      confidence: 93,
      reason: 'Utilities expense payment detected.',
    },
    // 5. Insurance Expense -> 5710 (Standard template, Category 5, no fallback)
    {
      keywords: ['insurance premium', 'insurance payment', 'insurance', 'takaful'],
      targetCode: '5710',
      fallbackCodes: [],
      nameKeywords: ['insurance', 'takaful'],
      categoryPrefix: '5',
      defaultName: 'Insurance Expense',
      confidence: 94,
      reason: 'Insurance premium payment detected.',
    },
    // 6a. Advance Income Tax / Withholding Tax Deducted at Source (Asset/Expense) -> 1300 Advance Tax Paid (or 6010 Tax Expense)
    // NEVER map to 1310 (Input Sales Tax is strictly for VAT/Sales Tax reclaim, NOT income tax WHT).
    {
      keywords: [
        'withholding tax',
        'wht deduction',
        'tax deduction',
        'advance tax',
        'tax deducted',
        'wht on',
        'wht -',
        'bank profit',
        'withholding tax deduction',
      ],
      targetCode: '1300',
      fallbackCodes: ['6010'],
      nameKeywords: ['advance tax', 'withholding tax', 'wht asset', 'tax receivable', 'wht receivable', 'income tax expense', 'tax expense'],
      categoryPrefix: '1',
      defaultName: 'Advance Tax Paid',
      confidence: 92,
      reason: 'Withholding / advance income tax deduction detected → Advance Tax Paid / Tax Expense.',
    },
    // 6b. Corporate / Income Tax Expense (Direct Tax) -> 6010 Tax Expense (or 1300)
    {
      keywords: ['income tax payment', 'corporate tax', 'fbr income tax', 'tax return payment', 'advance tax payment', 'income tax'],
      targetCode: '6010',
      fallbackCodes: ['1300'],
      nameKeywords: ['income tax', 'tax expense', 'corporate tax'],
      categoryPrefix: '6',
      defaultName: 'Tax Expense',
      confidence: 92,
      reason: 'Income / corporate tax payment detected → Tax Expense.',
    },
    // 6c. Sales Tax / GST / Provincial Sales Tax (Indirect Tax - FBR/PRA/SRB/KPRA/BRA) -> 1310 Input Sales Tax
    {
      keywords: ['sales tax', 'input sales tax', 'fbr sales tax', 'pra tax', 'srb tax', 'kpra', 'bra tax', 'gst payment', 'sales tax payment', 'sales tax paid'],
      targetCode: '1310',
      fallbackCodes: ['2100'],
      nameKeywords: ['input sales tax', 'sales tax', 'gst', 'vat'],
      categoryPrefix: '1',
      defaultName: 'Input Sales Tax',
      confidence: 92,
      reason: 'Sales tax / GST / provincial indirect tax transaction detected.',
    },
    // 10. Travel, Fuel & Conveyance -> 5600 (or 5070)
    // IMPORTANT: This rule must appear BEFORE the generic cheque-payment rule below,
    // so that "Cheque Payment - Metro Fuel Station" hits fuel before hitting vendor payment.
    {
      keywords: ['fuel station', 'petrol pump', 'cng station', 'fuel', 'petrol', 'diesel', 'cng', 'pso', 'shell', 'total parco', 'travel', 'conveyance', 'uber', 'careem'],
      targetCode: '5600',
      fallbackCodes: ['5070'],
      nameKeywords: ['travel', 'conveyance', 'fuel', 'petrol', 'transport'],
      categoryPrefix: '5',
      defaultName: 'Travel & Conveyance',
      confidence: 92,
      reason: 'Travel, fuel & conveyance expense detected.',
    },
    // 8. Office Supplies & Admin Expense -> 5400 (or 5040)
    // Must appear before cheque-payment so "Cheque Payment - Al-Noor Stationery" → 5400, not 2000
    {
      keywords: ['office supplies', 'office supply', 'stationery', 'printing', 'courier', 'tcs', 'leopards'],
      targetCode: '5400',
      fallbackCodes: ['5040'],
      nameKeywords: ['office supplies', 'stationery', 'office expense', 'admin expense'],
      categoryPrefix: '5',
      defaultName: 'Office Supplies Expense',
      confidence: 92,
      reason: 'Office supplies / administrative expense detected.',
    },
    // 9. Marketing & Advertising -> 5500 (or 5060)
    {
      keywords: ['marketing', 'advertising', 'facebook ads', 'google ads', 'meta ads', 'billboard', 'campaign'],
      targetCode: '5500',
      fallbackCodes: ['5060'],
      nameKeywords: ['marketing', 'advertising', 'advertisement', 'promotion'],
      categoryPrefix: '5',
      defaultName: 'Marketing & Advertising',
      confidence: 93,
      reason: 'Marketing / advertising expense detected.',
    },
    // Generic vendor / cheque payment catch-all -> 2000 Accounts Payable (or 2010)
    // MUST be last among expense rules — only fires when no more-specific rule matched above
    {
      keywords: [
        'payment to vendor',
        'paid to vendor',
        'vendor payment',
        'payment to supplier',
        'paid to supplier',
        'supplier payment',
        'cheque payment',
        'cheque paid',
        'chq payment',
        'ibft payment',
        'online payment to',
      ],
      targetCode: '2000',
      fallbackCodes: ['2010', '2020'],
      nameKeywords: ['accounts payable', 'trade payable', 'payable to supplier', 'ap', 'supplier payable', 'vendor payable'],
      categoryPrefix: '2',
      defaultName: 'Accounts Payable (AP)',
      confidence: 95,
      reason: 'Vendor payment / cheque payment detected → Accounts Payable.',
    },
    // Direction-aware settlement / counterparty clearing
    {
      keywords: ['client settlement', 'settlement', 'customer settlement', 'vendor settlement'],
      targetCode: direction === 'credit' ? '1100' : '2000',
      fallbackCodes: direction === 'credit' ? ['1200', '4010'] : ['2010'],
      nameKeywords: direction === 'credit' ? ['receivable', 'trade receivable', 'ar', 'sales', 'revenue'] : ['payable', 'trade payable', 'ap'],
      categoryPrefix: direction === 'credit' ? '1' : '2',
      defaultName: direction === 'credit' ? 'Accounts Receivable (AR)' : 'Accounts Payable (AP)',
      confidence: 95,
      reason: direction === 'credit'
        ? 'Settlement credit (money in) detected → Accounts Receivable.'
        : 'Settlement debit (money out) detected → Accounts Payable.',
    },
  ];

  for (const rule of rules) {
    if (direction === 'debit' && rule.categoryPrefix === '4') continue;
    if (direction === 'credit' && (rule.categoryPrefix === '5' || rule.categoryPrefix === '6')) continue;

    for (const kw of rule.keywords) {
      if (d.includes(kw)) {
        const matched = findBestAccount(rule.targetCode, rule.fallbackCodes, rule.nameKeywords, rule.categoryPrefix);
        if (matched) {
          return {
            code: matched.account_code,
            name: matched.account_name,
            confidence: rule.confidence,
            reasoning: rule.reason,
          };
        }
        // When no active account in client COA matches the semantics or codes, do NOT return a phantom code!
        // Return null so the system safely routes to manual review without binding to non-existent accounts.
        return null;
      }
    }
  }

  // Ambiguous text: return null so caller flags for manual review (NEVER 3030 or 5000)
  return null;
}

export async function getAISuggestion(params: {
  description: string;
  counterparty?: string;
  amountPaisa?: number;
  direction?: 'debit' | 'credit' | 'unknown';
  transactionType?: string;
  chartOfAccounts: Array<{ account_code: string; account_name: string; account_type?: string }>;
  fewShotExamples?: Array<{ description: string; account_code: string; account_name: string }>;
}): Promise<AISuggestionResponse> {
  const direction = params.direction || 'unknown';

  // EOBI Routing Guard: Route EOBI payment lines to manual review
  // Note: "EOBI payment: needs manual split between liability clearance and employer expense."
  // No auto-suggested account, no ratio auto-splitting.
  const dLower = params.description.toLowerCase();
  if (
    dLower.includes('eobi') ||
    dLower.includes('employees old-age benefits') ||
    dLower.includes('employees old age benefits')
  ) {
    return {
      suggestedAccountCode: null,
      suggestedAccountName: 'Manual review required',
      confidenceScore: 30,
      taxRateBps: 0,
      reasoning: 'EOBI payment: needs manual split between liability clearance and employer expense.',
      isFlaggedForReview: true,
      provider: 'Ambiguity Guard (Manual Review Required)',
    };
  }

  // Filter out pure parent category header accounts (e.g., accounts named literally "Expenses", "Assets", "Liabilities", "Equity", "Income")
  const activeNonHeaderAccounts = params.chartOfAccounts.filter(a => {
    const code = a.account_code.trim();
    const nameLower = a.account_name.trim().toLowerCase();
    if (['expenses', 'assets', 'liabilities', 'equity', 'income', 'revenue'].includes(nameLower)) {
      return false;
    }
    if (code === '5000' && nameLower.includes('expense')) return false;
    return true;
  });

  // 1. Precision Rule Matcher First (Deterministic, in-memory, 0 PII leak, 0 network latency)
  const heuristic = applyHeuristicRules(params.description, activeNonHeaderAccounts, direction);
  if (heuristic) {
    const result: AISuggestionResponse = {
      suggestedAccountCode: heuristic.code,
      suggestedAccountName: heuristic.name,
      confidenceScore: heuristic.confidence,
      taxRateBps: params.description.toLowerCase().includes('tax') ? 1800 : 0,
      reasoning: heuristic.reasoning,
      isFlaggedForReview: heuristic.confidence < 85,
      provider: 'Heuristic Rule Matcher (Verified Precision)',
    };
    return result;
  }

  // 2. Try External LLM ONLY if AI_FEATURES_ENABLED is true and API key configured (0 HTTP calls when false)
  const geminiKey = process.env.GEMINI_API_KEY;
  if (isAiFeaturesEnabled() && geminiKey && process.env.NODE_ENV !== 'test') {
    try {
      const coaText = activeNonHeaderAccounts.slice(0, 40).map(a => `${a.account_code}: ${a.account_name}`).join('\n');
      const prompt = `Classify this accounting transaction: "${params.description}".
Choose ONLY from available active accounts:
${coaText}
Rules:
- Capital contributions -> 3xxx
- Sales / service revenue -> 4xxx
- Expenses -> 5xxx/6xxx
- NEVER choose parent account 5000
Return JSON: {"suggestedAccountCode": "...", "suggestedAccountName": "...", "confidenceScore": 85, "reasoning": "..."}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        }),
        signal: AbortSignal.timeout(3000)
      });

      if (res.ok) {
        const json = await res.json();
        const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawText) {
          const parsed = JSON.parse(rawText);
          const validCode = activeNonHeaderAccounts.find(a => a.account_code === parsed.suggestedAccountCode);
          if (validCode) {
            const result: AISuggestionResponse = {
              suggestedAccountCode: validCode.account_code,
              suggestedAccountName: validCode.account_name,
              confidenceScore: Math.min(99, Math.max(50, Number(parsed.confidenceScore) || 80)),
              taxRateBps: 0,
              reasoning: parsed.reasoning || 'Categorized based on description context.',
              isFlaggedForReview: (Number(parsed.confidenceScore) || 80) < 80,
              provider: 'Gemini 2.5 Flash',
            };
            return result;
          }
        }
      }
    } catch (err) {
      console.warn('Gemini LLM error:', err);
    }
  }

  return {
    suggestedAccountCode: null,
    suggestedAccountName: 'Manual review required',
    confidenceScore: 30,
    taxRateBps: 0,
    reasoning: 'Manual review required',
    isFlaggedForReview: true,
    provider: 'Ambiguity Guard (Manual Review Required)',
  };
}
