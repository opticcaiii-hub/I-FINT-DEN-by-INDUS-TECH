import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { transaction, query } from '@/lib/db';
import { postJournalEntry } from '@/lib/ledger/post-entry';
import { appendAuditRecord } from '@/lib/data-cleaning/audit-chain';
import { saveHumanCorrection } from '@/lib/data-cleaning/active-learning';
import crypto from 'crypto';

const processedBatches = new Set<string>();

export async function POST(req: NextRequest) {
  try {
    const session = await verifySession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!['partner', 'manager'].includes(session.role || '')) {
      return NextResponse.json({ error: 'Only Partners and Managers can approve postings' }, { status: 403 });
    }

    const body = await req.json();
    const { clientId, rows, resolvedReviews, batchId } = body;

    if (batchId && processedBatches.has(batchId)) {
      return NextResponse.json({
        success: true,
        message: 'Batch already processed',
        batchId,
        postedCount: 0,
        journalEntryIds: [],
        excludedCount: 0,
        failedCount: 0,
        totalDebitPaisa: 0,
        totalCreditPaisa: 0,
      });
    }

    const targetClientId = Number(clientId);
    if (!targetClientId || isNaN(targetClientId)) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 });
    }

    // Get chart of accounts mapping with normal_balance
    const coaRes = await query<{
      id: number;
      account_code: string;
      account_name: string;
      type_code: string;
      normal_balance: string;
    }>(
      `SELECT coa.id, coa.account_code, coa.account_name, at.code as type_code, at.normal_balance
       FROM chart_of_accounts coa
       JOIN account_types at ON coa.account_type_id = at.id
       WHERE coa.client_id = $1 AND coa.is_active = true`,
      [targetClientId]
    );

    const coaMap = new Map<string, { id: number; name: string; normalBalance: 'debit' | 'credit'; typeCode: string }>();
    for (const c of coaRes.rows) {
      coaMap.set(c.account_code, {
        id: c.id,
        name: c.account_name,
        normalBalance: (c.normal_balance?.toLowerCase() === 'credit' ? 'credit' : 'debit'),
        typeCode: (c.type_code || '').toLowerCase(),
      });
    }

    // Default cash/bank account for balancing lines
    const defaultBankId = coaMap.get('1020')?.id || coaMap.get('1010')?.id || coaRes.rows[0]?.id || 1;

    let totalDebit = 0;
    let totalCredit = 0;
    const failedRows: any[] = [];
    const excludedRows: any[] = [];

    // Run in atomic transaction
    const postResult = await transaction(async (tx) => {
      const postedEntries: Array<{ rowIndex: number; journalEntryId: number; currentHash: string }> = [];

      // Group rows: group by transactionId if present, else single item
      interface TxGroup {
        transactionId?: string;
        items: Array<{ item: any; index: number; data: any }>;
      }

      const txGroups: TxGroup[] = [];
      const txGroupMap = new Map<string, TxGroup>();

      for (let i = 0; i < rows.length; i++) {
        const item = rows[i];
        const data = item.normalizedData || item;

        if (item.excluded) {
          excludedRows.push(item);
          continue;
        }

        const txId = (
          data.transactionGroupId ||
          data.transaction_group_id ||
          data.transaction_external_id ||
          data.transactionExternalId ||
          data.transactionId ||
          data.transaction_id ||
          item.transactionGroupId ||
          item.transaction_group_id ||
          item.transaction_external_id ||
          item.transactionId ||
          item.transaction_id ||
          ''
        ).toString().trim();
        if (txId) {
          let grp = txGroupMap.get(txId);
          if (!grp) {
            grp = { transactionId: txId, items: [] };
            txGroupMap.set(txId, grp);
            txGroups.push(grp);
          }
          grp.items.push({ item, index: i, data });
        } else {
          txGroups.push({ items: [{ item, index: i, data }] });
        }
      }

      for (const grp of txGroups) {
        if (grp.items.length > 1) {
          // Multi-line balanced entry: sort by line_number
          grp.items.sort((a, b) => {
            const lineA = Number(a.data.lineNumber ?? a.data.line_number ?? a.item.lineNumber ?? a.item.line_number ?? a.index);
            const lineB = Number(b.data.lineNumber ?? b.data.line_number ?? b.item.lineNumber ?? b.item.line_number ?? b.index);
            return lineA - lineB;
          });

          const first = grp.items[0]!;
          const entryDate = first.data.date || new Date().toISOString().slice(0, 10);
          const description = first.data.transactionDescription || first.data.description || `Transaction ${grp.transactionId}`;

          const lines = grp.items.map(({ data }) => {
            const accountCode = data.accountCode || '5010';
            const coaEntry = coaMap.get(accountCode);
            const accountId = coaEntry?.id || defaultBankId;
            const debitPaisa = Number(data.debitPaisa) || 0;
            const creditPaisa = Number(data.creditPaisa) || 0;
            const lineMemoParts = [data.lineDescription, data.memo].filter(Boolean);
            const memo = lineMemoParts.length > 0 ? lineMemoParts.join(' – ') : (data.description || description);
            return { accountId, debitPaisa, creditPaisa, memo };
          });

          const grpDebit = lines.reduce((s, l) => s + l.debitPaisa, 0);
          const grpCredit = lines.reduce((s, l) => s + l.creditPaisa, 0);
          const hasDebit = lines.some(l => l.debitPaisa > 0);
          const hasCredit = lines.some(l => l.creditPaisa > 0);

          if (grpDebit !== grpCredit || lines.length < 2 || !hasDebit || !hasCredit) {
            throw new Error(`Transaction "${grp.transactionId}" is unbalanced or invalid: total debits (${(grpDebit / 100).toFixed(2)}) != total credits (${(grpCredit / 100).toFixed(2)}), lines: ${lines.length}`);
          }

          totalDebit += grpDebit;
          totalCredit += grpCredit;

          try {
            const journalEntryId = await postJournalEntry(
              {
                clientId: targetClientId,
                entryDate,
                sourceType: 'manual',
                sourceId: first.item.rowIndex || first.index + 1,
                description,
                lines,
                postedBy: session.staffId,
              },
              tx
            );

            for (const { item, index, data } of grp.items) {
              const accountCode = data.accountCode || '5010';
              const currentHash = await appendAuditRecord({
                firmId: session.firmId,
                clientId: targetClientId,
                actorId: session.staffId,
                actorRole: session.role || 'Staff',
                action: 'batch_import_post',
                entityType: 'journal_entry',
                entityId: journalEntryId,
                jobId: item.jobId,
                sourceRow: item.rowIndex || index + 1,
                aiConfidence: item.aiSuggestion?.confidenceScore,
                aiSuggestedValue: item.aiSuggestion,
                appliedValue: { accountCode, debitPaisa: data.debitPaisa, creditPaisa: data.creditPaisa, entryDate, description },
                reason: item.flagReasons?.join('; ') || 'Approved via intelligent two-folder review',
                tx,
              });

              if (item.reviewDecision) {
                await saveHumanCorrection({
                  firmId: session.firmId,
                  clientId: targetClientId,
                  jobId: item.jobId || 1,
                  rowIndex: item.rowIndex || index + 1,
                  rawInput: item.rawInput || {},
                  aiProvider: item.aiSuggestion?.provider || 'ensemble',
                  predictedCode: item.aiSuggestion?.suggestedAccountCode,
                  confidenceScore: item.aiSuggestion?.confidenceScore || 0,
                  isAnomaly: Boolean(item.anomalyScore && item.anomalyScore >= 40),
                  anomalyScore: item.anomalyScore || 0,
                  humanAction: item.reviewDecision.action || 'accepted',
                  humanCorrectedCode: item.reviewDecision.correctedCode || accountCode,
                  reviewedBy: session.staffId,
                });
              }

              postedEntries.push({ rowIndex: item.rowIndex || index + 1, journalEntryId, currentHash });
            }
          } catch (rowError: any) {
            failedRows.push({ rowIndex: first.item.rowIndex || first.index + 1, error: rowError.message });
            throw new Error(`Transaction ${grp.transactionId} failed: ${rowError.message}`);
          }
        } else {
          // Single-line item with rule-based/default balancing line
          const { item, index, data } = grp.items[0]!;
          const accountCode = data.accountCode || '5010';
          const coaEntry = coaMap.get(accountCode);
          const accountId = coaEntry?.id || defaultBankId;
          const amountPaisa = Number(data.amountPaisa) || 0;
          const entryDate = data.date || new Date().toISOString().slice(0, 10);
          const description = data.description || 'Imported Transaction';

          const typeCode = coaEntry?.typeCode || '';
          const isExpenseAccount = typeCode === 'expense' || typeCode === 'cost_of_sales' || typeCode === 'cogs'
            || accountCode.startsWith('5') || accountCode.startsWith('6');
          const isRevenueAccount = typeCode === 'income' || typeCode === 'revenue'
            || accountCode.startsWith('4');
          const normalBalance = coaEntry?.normalBalance ||
            (accountCode.startsWith('4') || accountCode.startsWith('3') || accountCode.startsWith('2') ? 'credit' : 'debit');

          let targetDebit = Number(data.debitPaisa) || 0;
          let targetCredit = Number(data.creditPaisa) || 0;

          if (targetDebit === 0 && targetCredit === 0) {
            if (normalBalance === 'credit') {
              targetCredit = amountPaisa;
              targetDebit = 0;
            } else {
              targetDebit = amountPaisa;
              targetCredit = 0;
            }
          }

          if (isExpenseAccount && targetCredit > 0 && targetDebit === 0) {
            targetDebit = targetCredit;
            targetCredit = 0;
          } else if (isRevenueAccount && targetDebit > 0 && targetCredit === 0) {
            targetCredit = targetDebit;
            targetDebit = 0;
          }

          const txnAmount = Math.max(targetDebit, targetCredit, amountPaisa);
          totalDebit += txnAmount;
          totalCredit += txnAmount;

          const bankDebit = targetCredit;
          const bankCredit = targetDebit;

          const lines = [
            { accountId, debitPaisa: targetDebit, creditPaisa: targetCredit, memo: description },
            { accountId: defaultBankId, debitPaisa: bankDebit, creditPaisa: bankCredit, memo: 'Balancing Cash/Bank' },
          ];

          try {
            const journalEntryId = await postJournalEntry(
              {
                clientId: targetClientId,
                entryDate,
                sourceType: 'manual',
                sourceId: item.rowIndex || index + 1,
                description,
                lines,
                postedBy: session.staffId,
              },
              tx
            );

            const currentHash = await appendAuditRecord({
              firmId: session.firmId,
              clientId: targetClientId,
              actorId: session.staffId,
              actorRole: session.role || 'Staff',
              action: 'batch_import_post',
              entityType: 'journal_entry',
              entityId: journalEntryId,
              jobId: item.jobId,
              sourceRow: item.rowIndex || index + 1,
              aiConfidence: item.aiSuggestion?.confidenceScore,
              aiSuggestedValue: item.aiSuggestion,
              appliedValue: { accountCode, amountPaisa: txnAmount, entryDate, description },
              reason: item.flagReasons?.join('; ') || 'Approved via intelligent two-folder review',
              tx,
            });

            if (item.reviewDecision) {
              await saveHumanCorrection({
                firmId: session.firmId,
                clientId: targetClientId,
                jobId: item.jobId || 1,
                rowIndex: item.rowIndex || index + 1,
                rawInput: item.rawInput || {},
                aiProvider: item.aiSuggestion?.provider || 'ensemble',
                predictedCode: item.aiSuggestion?.suggestedAccountCode,
                confidenceScore: item.aiSuggestion?.confidenceScore || 0,
                isAnomaly: Boolean(item.anomalyScore && item.anomalyScore >= 40),
                anomalyScore: item.anomalyScore || 0,
                humanAction: item.reviewDecision.action || 'accepted',
                humanCorrectedCode: item.reviewDecision.correctedCode || accountCode,
                reviewedBy: session.staffId,
              });
            }

            postedEntries.push({ rowIndex: item.rowIndex || index + 1, journalEntryId, currentHash });
          } catch (rowError: any) {
            failedRows.push({ rowIndex: item.rowIndex || index + 1, error: rowError.message });
            throw new Error(`Row #${item.rowIndex || index + 1} failed: ${rowError.message}`);
          }
        }
      }

      return postedEntries;
    });

    const newBatchId = batchId || crypto.randomUUID();
    if (newBatchId) {
      processedBatches.add(newBatchId);
    }

    return NextResponse.json({
      success: true,
      batchId: newBatchId,
      postedCount: postResult.length,
      excludedCount: excludedRows.length,
      failedCount: failedRows.length,
      totalDebitPaisa: totalDebit,
      totalCreditPaisa: totalCredit,
      journalEntryIds: postResult.map(r => r.journalEntryId),
      auditTrailHash: postResult[postResult.length - 1]?.currentHash || '',
      links: {
        trialBalance: `/clients/${targetClientId}/reports`,
        profitAndLoss: `/clients/${targetClientId}/reports`,
        auditTrail: `/api/import/review?clientId=${targetClientId}`,
      },
      message: `Successfully posted ${postResult.length} transactions.`,
    });
  } catch (error: any) {
    console.error('Batch approve & post failed:', error);
    return NextResponse.json({ error: error.message || 'Post failed' }, { status: 500 });
  }
}
