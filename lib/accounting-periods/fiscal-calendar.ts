/**
 * lib/accounting-periods/fiscal-calendar.ts
 *
 * Helper functions to determine client fiscal year boundaries,
 * calculate missing calendar months, and validate date eligibility for auto-creation.
 */

export interface FiscalYearBoundary {
  fiscalYearName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
}

export interface MonthPeriod {
  name: string; // e.g. "March 2026"
  startDate: string; // "2026-03-01"
  endDate: string; // "2026-03-31"
  monthKey: string; // "2026-03"
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Calculates the fiscal year boundary for a given reference date and client's fiscal_year_start_month.
 * 
 * E.g., for Pakistan standard (fiscalYearStartMonth = 7, July):
 * - Date 2026-03-15 (Month 3 < 7) -> FY 2025-26: Start 2025-07-01, End 2026-06-30
 * - Date 2026-08-15 (Month 8 >= 7) -> FY 2026-27: Start 2026-07-01, End 2027-06-30
 */
export function getFiscalYearBoundary(
  dateStr: string,
  fiscalYearStartMonth: number = 7
): FiscalYearBoundary {
  const [yearStr, monthStr] = dateStr.slice(0, 10).split('-');
  const year = parseInt(yearStr || '2026', 10);
  const month = parseInt(monthStr || '1', 10);

  let fyStartYear: number;
  let fyEndYear: number;
  let fyEndMonth: number;

  if (fiscalYearStartMonth === 1) {
    // Calendar year: Jan 1 to Dec 31
    fyStartYear = year;
    fyEndYear = year;
    fyEndMonth = 12;
  } else if (month >= fiscalYearStartMonth) {
    fyStartYear = year;
    fyEndYear = year + 1;
    fyEndMonth = fiscalYearStartMonth - 1;
  } else {
    fyStartYear = year - 1;
    fyEndYear = year;
    fyEndMonth = fiscalYearStartMonth - 1;
  }

  const startMonthPadded = String(fiscalYearStartMonth).padStart(2, '0');
  const endMonthPadded = String(fyEndMonth).padStart(2, '0');
  
  // Last day of fyEndMonth
  const lastDay = new Date(Date.UTC(fyEndYear, fyEndMonth, 0)).getUTCDate();
  const lastDayPadded = String(lastDay).padStart(2, '0');

  const startDate = `${fyStartYear}-${startMonthPadded}-01`;
  const endDate = `${fyEndYear}-${endMonthPadded}-${lastDayPadded}`;
  const fiscalYearName = fiscalYearStartMonth === 1
    ? `FY ${fyStartYear}`
    : `FY ${fyStartYear}-${String(fyEndYear).slice(-2)}`;

  return {
    fiscalYearName,
    startDate,
    endDate,
  };
}

/**
 * Given a date string (YYYY-MM-DD), returns the month period info.
 */
export function getMonthPeriodForDate(dateStr: string): MonthPeriod {
  const [yearStr, monthStr] = dateStr.slice(0, 10).split('-');
  const year = parseInt(yearStr || '2026', 10);
  const month = parseInt(monthStr || '1', 10);

  const monthName = MONTH_NAMES[month - 1] || 'Month';
  const monthPadded = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDayPadded = String(lastDay).padStart(2, '0');

  return {
    name: `${monthName} ${year}`,
    startDate: `${year}-${monthPadded}-01`,
    endDate: `${year}-${monthPadded}-${lastDayPadded}`,
    monthKey: `${year}-${monthPadded}`,
  };
}

/**
 * Returns the one-click batch creation date bounds:
 * From the first day of the fiscal year two years prior to the reference fiscal year,
 * up to the last day of the current reference fiscal year.
 * 
 * For reference date in Oct 2026 with fiscalYearStartMonth = 7:
 * Current FY: 2026-07-01 to 2027-06-30
 * Lower bound (2 FYs prior): 2024-07-01
 * Upper bound (current FY end): 2027-06-30
 */
export function getOneClickPeriodBounds(
  referenceDate: string | Date = new Date(),
  fiscalYearStartMonth: number = 7
): { minStartDate: string; maxEndDate: string } {
  const refDateStr = typeof referenceDate === 'string'
    ? referenceDate.slice(0, 10)
    : referenceDate.toISOString().slice(0, 10);

  const currentFy = getFiscalYearBoundary(refDateStr, fiscalYearStartMonth);

  const currentFyStartYear = parseInt(currentFy.startDate.slice(0, 4), 10);
  const minFyStartYear = currentFyStartYear - 2;
  const startMonthPadded = String(fiscalYearStartMonth).padStart(2, '0');
  const minStartDate = `${minFyStartYear}-${startMonthPadded}-01`;
  const maxEndDate = currentFy.endDate;

  return { minStartDate, maxEndDate };
}
