/**
 * Journal Entry Reversal Engine — P0 Hardened
 * 
 * Reversal, not deletion. Posts a reversing entry via the central
 * postJournalEntry() engine inside a row-locked transaction.
 */

import { transaction, type TransactionClient } from '@/lib/db';
import { postJournalEntry, type JournalEntryRow, type JournalLineRow } from './post-entry';

/**
 * Reverse a posted journal entry.
 * 
 * Rules:
 *   1. Row lock original entry via SELECT ... FOR UPDATE (prevents concurrency double-reversal)
 *   2. Reverses via central postJournalEntry() inside the same transaction
 *   3. Links original.reversed_by_entry_id and reversal.reversal_of_entry_id
 *   4. BigInt safe debit/credit swap
 */
export async function reverseJournalEntry(
  entryId: number,
  clientId: number,
  reversedBy: number, // staff_id
  reason: string,
  reversalDate?: string, // YYYY-MM-DD
  tx?: TransactionClient
): Promise<number> {
  const executeReversal = async (client: TransactionClient): Promise<number> => {
    // 1. Lock original entry row (prevents concurrent double-reversals)
    const lockedEntry = await client.query<JournalEntryRow>(
      `SELECT * FROM journal_entries WHERE id = $1 AND client_id = $2 FOR UPDATE`,
      [entryId, clientId]
    );

    const entry = lockedEntry.rows[0];
    if (!entry) {
      throw new Error(`Journal entry ID ${entryId} not found for this client`);
    }

    if (entry.status !== 'posted') {
      throw new Error(`Only posted journal entries can be reversed. Current status: ${entry.status}`);
    }

    if (entry.reversed_by_entry_id !== null) {
      throw new Error(`Journal entry ${entry.entry_number} has already been reversed by entry ID ${entry.reversed_by_entry_id}`);
    }

    if (!reason || reason.trim().length === 0) {
      throw new Error('A reason is required to reverse a journal entry');
    }

    const dateToUse = reversalDate || new Date().toISOString().substring(0, 10);

    // 2. Fetch original lines
    const linesResult = await client.query<JournalLineRow>(
      `SELECT * FROM journal_lines WHERE journal_entry_id = $1 ORDER BY line_order`,
      [entryId]
    );

    const lines = linesResult.rows;
    if (lines.length === 0) {
      throw new Error(`No journal lines found for entry ID ${entryId}`);
    }

    // 3. Build swapped lines safely (debit <-> credit swap using BigInt)
    const swappedLines = lines.map((line) => {
      const swappedDebit = BigInt(line.credit_paisa);
      const swappedCredit = BigInt(line.debit_paisa);

      return {
        accountId: line.account_id,
        debitPaisa: Number(swappedDebit),
        creditPaisa: Number(swappedCredit),
        memo: `Reversal of entry ${entry.entry_number}${line.memo ? `: ${line.memo}` : ''}`,
      };
    });

    // 4. Post reversal entry via CENTRAL posting engine in SAME transaction
    const reversalId = await postJournalEntry(
      {
        clientId,
        entryDate: dateToUse,
        description: `Reversal of ${entry.entry_number}: ${reason}`,
        sourceType: 'reversal',
        sourceId: entryId,
        lines: swappedLines,
        postedBy: reversedBy,
      },
      client
    );

    // 5. Link original entry to reversal entry
    await client.query(
      `UPDATE journal_entries SET reversed_by_entry_id = $1 WHERE id = $2`,
      [reversalId, entryId]
    );

    // 6. Link reversal entry to original entry via reversal_of_entry_id
    await client.query(
      `UPDATE journal_entries SET reversal_of_entry_id = $1 WHERE id = $2`,
      [entryId, reversalId]
    );

    return reversalId;
  };

  if (tx) {
    return executeReversal(tx);
  }
  return transaction(executeReversal);
}
