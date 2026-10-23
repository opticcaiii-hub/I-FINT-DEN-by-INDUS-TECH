# ⚡ I-FINT DEN by INDUS TECH
### *Autonomous AI Financial Ingestion Pipeline & Real-Time Statutory Accounting Engine*

[![Next.js 16](https://img.shields.io/badge/Next.js-16.3-black?logo=next.js)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19.2-blue?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%20%2F%20Neon-336791?logo=postgresql)](https://neon.tech/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 📌 Executive Summary

**I-FINT DEN by INDUS TECH** is an end-to-end autonomous financial intelligence platform built to eliminate the single most painful bottleneck in accounting: **converting messy, disorganized raw transaction data into clean, compliant, double-entry General Ledger records and instant financial statements.**

By unifying high-precision column normalization, machine-learning outlier detection (Isolation Forest & TreeSHAP), large language model categorizations, and automated Chart of Accounts resolution, **I-FINT DEN** cuts accounting ingestion cycles from hours to seconds.

---

## 🛑 The Problem: The Spreadsheet Chaos

Every business, accounting firm, and finance professional faces the same daily struggle:

1. **Unformatted, Inconsistent Data**: Raw exports from banks, POS terminals, payment gateways, and vendors arrive in chaotic formats with conflicting headers, mixed date conventions, and unstructured narrations.
2. **Exhausting Manual Categorization**: Accountants spend hours manually deciphering descriptions, guessing account codes, and keying in journal entries line by line.
3. **Hidden Anomalies & Outliers**: Dangerous typos, accidental duplicate charges, unusual weekend spikes, and unbalanced debits/credits slip past human reviewers and contaminate financial ledgers.
4. **Delayed Reporting**: Generating a Trial Balance, Balance Sheet, or Profit & Loss statement often requires days or weeks of manual reconciliation across disparate spreadsheets.

---

## 💡 The Solution: I-FINT DEN 4-Step Pipeline

**I-FINT DEN by INDUS TECH** automates this entire pipeline into a fast, intuitive, 4-step workflow:

```
[ Raw CSV / Bank Statement / Clipboard ]
                   │
                   ▼
   ⚡ Intelligent Column Auto-Mapper & Header Detector
                   │
                   ▼
  ┌────────────────────────────────────────────────────────┐
  │         📂 THE TWO-FOLDER PARTITIONING PIPELINE        │
  │                                                        │
  │  📁 Folder A: Ready to Post     📁 Folder B: Review    │
  │     (Clean, 0 errors, auto-        (Flagged with ML    │
  │      validated transactions)        TreeSHAP anomalies │
  │                                     & 1-Click AI Fixes)│
  └──────────────────────────┬─────────────────────────────┘
                             │
                  [ 🚀 1-Click POST Button ]
                             │
                             ▼
               🏛️ Core Double-Entry General Ledger
                 (Atomic PostgreSQL Transaction)
                             │
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │         📊 REAL-TIME STATUTORY FINANCIAL REPORTS       │
  │                                                        │
  │  • Trial Balance (Debits == Credits to the exact cent) │
  │  • Profit & Loss Statement (Income & Expense summary)  │
  │  • Balance Sheet (Assets = Liabilities + Equity)       │
  │  • Cash Flow Statement (IAS-7 Direct/Indirect flows)   │
  │  • Aged Accounts Receivable (AR Customer aging)        │
  │  • Aged Accounts Payable (AP Supplier aging)           │
  └────────────────────────────────────────────────────────┘
```

---

## 🧪 Ready-to-Use Quick Test Data

Want to test the platform instantly? Copy the standardized 50-transaction dataset below and paste it directly into the Studio:

```csv
rowIndex,date,description,accountCode,amount,counterparty,referenceNumber
1,2026-07-22,Service rendered to Apex Stationers (Demo),4020,23400.00,Apex Stationers (Demo),REF-A1001
2,2026-08-06,Service rendered to Northwind Advisory (Demo),4020,80300.00,Northwind Advisory (Demo),REF-A1002
3,2026-07-30,Business travel expense,5070,22100.00,,REF-A1003
4,2026-07-14,Sale of goods to Northwind Advisory (Demo),4010,18300.00,Northwind Advisory (Demo),REF-A1004
5,2026-07-17,Sale of goods to Harbor Consulting (Demo),4010,95400.00,Harbor Consulting (Demo),REF-A1005
6,2026-08-14,Collection from customer Skyline Retailers (Demo),,48000.00,Skyline Retailers (Demo),REF-A1006
7,2026-07-24,MailFlow (Demo) monthly subscription,5050,12800.00,MailFlow (Demo),REF-A1007
8,2026-08-26,Business travel expense,5070,17500.00,,REF-A1008
9,2026-07-30,CloudSuite Pro (Demo) monthly subscription,5050,5000.00,CloudSuite Pro (Demo),REF-A1009
10,2026-07-10,Sale of goods to Bluewave Tech (Demo),4010,78900.00,Bluewave Tech (Demo),REF-A1010
11,2026-07-24,Internet & phone bill payment,5020,23800.00,,REF-A1011
12,2026-07-17,Office supplies purchase from Crescent Cloud Services (Demo),5040,4800.00,Crescent Cloud Services (Demo),REF-A1012
13,2026-07-09,Miscellaneous other income received,4030,5300.00,,REF-A1013
14,2026-07-27,Payment to vendor Amberlight Studios (Demo),,54900.00,Amberlight Studios (Demo),REF-A1014
15,2026-08-04,Marketing and promotion expense,5060,20300.00,,REF-A1015
16,2026-08-13,Office supplies purchase from Golden Gate Foods (Demo),5040,17600.00,Golden Gate Foods (Demo),REF-A1016
17,2026-08-31,BizTrack Software (Demo) monthly subscription,5050,14300.00,BizTrack Software (Demo),REF-A1017
18,2026-08-12,Service rendered to Apex Stationers (Demo),4020,77600.00,Apex Stationers (Demo),REF-A1018
19,2026-07-23,Monthly staff salary disbursement,5030,288400.00,,REF-A1019
20,2026-07-15,Owner capital contribution,3010,389600.00,,REF-A1020
21,2026-07-06,Monthly office rent payment,5010,48600.00,,REF-A1021
22,2026-07-09,Payment to vendor Riverside Traders (Demo),,13500.00,Riverside Traders (Demo),REF-A1022
23,2026-08-10,Business travel expense,5070,19300.00,,REF-A1023
24,2026-07-01,Office supplies purchase from Zenith Print Co (Demo),5040,11700.00,Zenith Print Co (Demo),REF-A1024
25,2026-08-20,MailFlow (Demo) monthly subscription,5050,4400.00,MailFlow (Demo),REF-A1025
26,2026-07-13,Sale of goods to Skyline Retailers (Demo),4010,82900.00,Skyline Retailers (Demo),REF-A1026
27,2026-07-17,Marketing and promotion expense,5060,26300.00,,REF-A1027
28,2026-07-09,Sale of goods to Falcon Traders (Demo),4010,116100.00,Falcon Traders (Demo),REF-A1028
29,2026-08-03,Service rendered to Orchid Boutique (Demo),4020,39200.00,Orchid Boutique (Demo),REF-A1029
30,2026-08-06,Collection from customer Golden Gate Foods (Demo),,46300.00,Golden Gate Foods (Demo),REF-A1030
31,2026-07-21,Gas bill payment,5020,21100.00,,REF-A1031
32,2026-07-08,Service rendered to Silverline Logistics (Demo),4020,36200.00,Silverline Logistics (Demo),REF-A1032
33,2026-08-21,Business travel expense,5070,13600.00,,REF-A1033
34,2026-08-27,Service rendered to Apex Stationers (Demo),4020,13700.00,Apex Stationers (Demo),REF-A1034
35,2026-08-10,Internet & phone bill payment,5020,23400.00,,REF-A1035
36,2026-08-14,Monthly staff salary disbursement,5030,200700.00,,REF-A1036
37,2026-07-29,Sale of goods to Orchid Boutique (Demo),4010,105700.00,Orchid Boutique (Demo),REF-A1037
38,2026-08-24,Sale of goods to Riverside Traders (Demo),4010,73600.00,Riverside Traders (Demo),REF-A1038
39,2026-08-27,Marketing and promotion expense,5060,26800.00,,REF-A1039
40,2026-08-11,Office supplies purchase from Falcon Traders (Demo),5040,4600.00,Falcon Traders (Demo),REF-A1040
41,2026-08-04,Gas bill payment,5020,11300.00,,REF-A1041
42,2026-07-24,BizTrack Software (Demo) monthly subscription,5050,10700.00,BizTrack Software (Demo),REF-A1042
43,2026-07-24,Monthly staff salary disbursement,5030,238500.00,,REF-A1043
44,2026-07-30,Monthly office rent payment,5010,48800.00,,REF-A1044
45,2026-07-24,Office supplies purchase from Orchid Boutique (Demo),5040,17800.00,Orchid Boutique (Demo),REF-A1045
46,2026-07-13,Marketing and promotion expense,5060,3100.00,,REF-A1046
47,2026-08-31,Sale of goods to Pearl Logistics (Demo),4010,77800.00,Pearl Logistics (Demo),REF-A1047
48,2026-07-28,Office supplies purchase from Golden Gate Foods (Demo),5040,4700.00,Golden Gate Foods (Demo),REF-A1048
49,2026-07-07,Payment to vendor Pearl Logistics (Demo),,25700.00,Pearl Logistics (Demo),REF-A1049
50,2026-08-06,Service rendered to Riverside Traders (Demo),4020,60900.00,Riverside Traders (Demo),REF-A1050
```

> **Direct file access**: This dataset is also stored in the repository at [`test-data/sample-transactions.csv`](./test-data/sample-transactions.csv).

---

## 🌟 Key Capabilities & Features

### 1. Universal Clipboard & File Ingestion
- **Paste & Go**: Copy messy unformatted rows directly from your clipboard or upload any CSV/Excel (`.xlsx`, `.xls`) file.
- **Smart Header Detection**: Automatically identifies where table headers start, discarding noisy header banners, empty rows, or multi-line metadata.
- **Broad Alias Dictionary**: Intelligently auto-maps columns (dates, narrations, voucher IDs, debit/credit/withdrawal/deposit amounts) to standardized accounting fields.

### 2. The Two-Folder Intelligent Partitioning
Every transaction batch is automatically partitioned into two clear buckets:
- **Folder A (Ready to Post)**: Zero-defect transactions that are balanced, properly categorized with Chart of Accounts codes, and fully validated.
- **Folder B (Review Required)**: Transactions that have missing Chart of Accounts codes, unusual statistical outliers, or ambiguous fields that require accountant confirmation.

### 3. Machine Learning Anomaly Detection & AI Suggestions
- **In-Process Isolation Forest**: Calculates statistical anomaly scores based on tree depth and historical volume patterns.
- **TreeSHAP Explanations**: Human-readable explanations for why a transaction was flagged (e.g., *"Amount is 6x larger than account median"*).
- **1-Click AI Categorization**: Real-time AI recommendations with confidence ratings (e.g., *"Suggest Account 5040 - Utilities (93% confidence)"*).
- **Batch Acceptance**: 1-click batch accept all high-confidence suggestions ($\ge 85\%$) to immediately clear Folder B into Folder A.

### 4. Zero-Leak Atomic Ledger Posting
- **Atomic Transactions**: When you click **Post to Ledger**, all entries are written into PostgreSQL within a single ACID transaction. If a single line fails validation, the entire batch rolls back cleanly.
- **Integer Paisa Precision**: All amounts are computed in integer paisa/cents ($1.00 = 100 paisa) to eliminate JavaScript floating-point rounding errors.
- **SHA-256 Cryptographic Audit Chain**: Every transaction is cryptographically linked with its prior hash to guarantee SOC2/IFRS auditability.

### 5. Instant Real-Time Financial Statements
The moment you post, your financial reports update automatically:
- **Trial Balance**: Instant verification of debit and credit equality across the Chart of Accounts.
- **Profit & Loss (P&L)**: Real-time calculation of gross revenue, operational expenses, and net profit.
- **Balance Sheet**: Dynamically calculates assets, liabilities, owner equity, and current period retained earnings.
- **Cash Flow Statement**: Compliant with IAS-7 guidelines, categorizing operating, investing, and financing flows.
- **Aging Reports**: Granular age bucket breakdown (0-30, 31-60, 61-90, 90+ days) for receivables and payables.

---

## 🛠️ Technology Stack

| Component | Technology |
| :--- | :--- |
| **Framework** | Next.js 16 (App Router) |
| **Frontend UI** | React 19, Custom Dark Metallic Finance Design System |
| **Language** | TypeScript 5 (Strict Mode) |
| **Database** | PostgreSQL / Neon Serverless with Connection Pooling |
| **Machine Learning** | In-Process Isolation Forest, TreeSHAP & Jaro-Winkler Matching |
| **AI Integration** | Google Gemini 2.5 Flash / Groq / OpenAI Fallback Engine |
| **Spreadsheet Engine**| XLSX SheetJS Parser |
| **Security & Auth** | JOSE JWT Session Authentication, BCrypt Password Hashing |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 20+ installed
- PostgreSQL connection string (e.g. free serverless database from [Neon.tech](https://neon.tech))

### 1. Clone the Repository
```bash
git clone https://github.com/opticcaiii-hub/I-FINT-DEN-by-INDUS-TECH.git
cd I-FINT-DEN-by-INDUS-TECH
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Create a `.env.local` file in the root directory:
```env
# Database Connection (Neon Serverless PostgreSQL)
DATABASE_URL=postgresql://user:password@ep-sample-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require

# Authentication Key
JWT_SECRET=super-secret-jwt-token-key-indus-tech-2026

# AI Engine Configuration
AI_FEATURES_ENABLED=true
GEMINI_API_KEY=your-gemini-api-key
```

### 4. Initialize Database Schema & Seed Data
Run the self-contained database setup script:
```bash
npm run init-db
```
This automatically creates the core tables (`firms`, `clients`, `account_types`, `chart_of_accounts`, `accounting_periods`, `journal_entries`, `journal_lines`, `ai_feedback`, `audit_log`) and seeds the standard general ledger Chart of Accounts.

### 5. Launch Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ☁️ Deploying to Vercel

1. Push your repository to GitHub:
   ```bash
   git add .
   git commit -m "feat: complete I-FINT DEN standalone engine"
   git push origin main
   ```
2. Go to [Vercel](https://vercel.com) and click **"Add New Project"**.
3. Import the `I-FINT-DEN-by-INDUS-TECH` repository.
4. In the **Environment Variables** section, add:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `AI_FEATURES_ENABLED=true`
   - `GEMINI_API_KEY`
5. Click **Deploy**. Your application is live within 60 seconds!

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.

Developed with pride by **INDUS TECH**.
