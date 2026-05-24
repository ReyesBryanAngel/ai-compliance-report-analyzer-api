import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { scrypt, randomBytes } from 'crypto';
import { promisify } from 'util';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}

const SEED_DATA = [
  {
    slug: 'kyc',
    name: 'KYC (Know Your Customer)',
    description: 'Verifies income sources and financial consistency of the account holder.',
    checkpoints: [
      {
        slug: 'recurring-salary',
        name: 'Recurring Salary',
        description: 'Detects stable, recurring salary inflows using a 5-signal confidence model.',
      },
      {
        slug: 'income-consistency',
        name: 'Income Consistency',
        description: 'Measures month-over-month income stability via coefficient of variation and trend analysis.',
      },
      {
        slug: 'loan-stacking',
        name: 'Loan Stacking Indicators',
        description: 'Counts loan disbursement inflows to detect multiple concurrent credit facilities.',
      },
      {
        slug: 'low-balance-persistence',
        name: 'Low Balance Persistence',
        description: 'Counts months where the end-of-month balance was below 20% of average monthly inflow.',
      },
    ],
  },
  {
    slug: 'sg',
    name: 'Safer Gambling',
    description: 'Detects gambling-related transaction patterns to assess safer gambling risk.',
    checkpoints: [
      {
        slug: 'gambling-debits',
        name: 'Gambling Debits',
        description: 'Counts outflow (debit) transactions made to gambling merchants.',
      },
      {
        slug: 'gambling-days',
        name: 'Gambling Days',
        description: 'Counts the number of distinct calendar days with any gambling activity.',
      },
      {
        slug: 'gambling-activity',
        name: 'Gambling Activity',
        description: 'Counts total gambling-related transactions (both inflows and outflows).',
      },
      {
        slug: 'gambling-overdrafts',
        name: 'Gambling Overdrafts',
        description: 'Counts gambling outflow transactions that resulted in a negative account balance.',
      },
    ],
  },
  {
    slug: 'traml',
    name: 'Transaction Risk & AML',
    description: 'Detects Anti-Money Laundering (AML) patterns such as rapid movement of funds through an account.',
    checkpoints: [
      {
        slug: 'rapid-inflow-outflow',
        name: 'Rapid Inflow/Outflow',
        description: 'Counts cycles where a significant inflow is followed by outflows draining ≥80% of it within 72 hours — a layering indicator.',
      },
      {
        slug: 'rapid-movement-of-funds',
        name: 'Rapid Movement of Funds',
        description: 'Counts non-overlapping 24-hour windows where the total amount moved exceeds a velocity threshold — a structuring indicator.',
      },
      {
        slug: 'circular-transaction',
        name: 'Circular Transaction',
        description: 'Counts outflows that are returned to the account at a matching amount (±5%) within 72 hours — a round-trip / layering indicator.',
      },
      {
        slug: 'fragmented-transactions',
        name: 'Fragmented Transactions',
        description: 'Counts clusters of sub-threshold outflows to the same recipient that collectively breach the reporting limit within a rolling window — a structuring/smurfing indicator.',
      },
      {
        slug: 'ctr-threshold',
        name: 'CTR Threshold Detection',
        description: 'Flags single transactions and same-day aggregates that meet or exceed the Cash Transaction Reporting (CTR) limit per AMLC rules. Supports per-org overrides of singleTxLimit and dailyAggregateLimit via params.',
      },
      {
        slug: 'cross-border-transfer',
        name: 'Cross-Border Transfer',
        description: 'Flags transactions involving high-risk foreign jurisdictions and detects multi-currency mixing patterns within a rolling window — indicators of offshore layering.',
      },
      {
        slug: 'geographic-risk-scoring',
        name: 'Geographic Risk Scoring',
        description: 'Computes a weighted exposure ratio of transaction value flowing through elevated-risk jurisdictions to surface geographic concentration risk.',
      },
      {
        slug: 'sanctions-watchlist',
        name: 'Sanctions Watchlist',
        description: 'Matches transaction descriptions against a curated sanctions and watchlist database to flag dealings with prohibited entities or individuals.',
      },
    ],
  },
  {
    slug: 'document-integrity',
    name: 'Document Integrity',
    description: 'Validates that uploaded bank statements are authentic and have not been tampered with.',
    checkpoints: [
      {
        slug: 'statement-balance-discrepancy',
        name: 'Statement Balance Discrepancy',
        description: 'Counts transactions where the reported running balance does not match the computed balance from prior transactions — a strong indicator of statement forgery or manipulation.',
      },
      {
        slug: 'amount-digit-distribution',
        name: 'Amount Digit Distribution',
        description: "Applies Benford's Law to transaction amounts to detect digit-frequency anomalies that suggest fabricated or manipulated figures.",
      },
      {
        slug: 'cloned-transaction-pattern',
        name: 'Cloned Transaction Pattern',
        description: 'Detects duplicate transactions sharing the same amount, description, and direction within a short window — a common artifact of statement forgery where only reference codes are incremented.',
      },
    ],
  },
];

async function main() {
  console.log('Seeding workflows and checkpoints...');

  for (const wf of SEED_DATA) {
    const workflow = await prisma.workflow.upsert({
      where: { slug: wf.slug },
      update: { name: wf.name, description: wf.description },
      create: { slug: wf.slug, name: wf.name, description: wf.description },
    });

    for (const cp of wf.checkpoints) {
      await prisma.checkpoint.upsert({
        where: { workflowId_slug: { workflowId: workflow.id, slug: cp.slug } },
        update: { name: cp.name, description: cp.description },
        create: {
          workflowId: workflow.id,
          slug: cp.slug,
          name: cp.name,
          description: cp.description,
        },
      });
    }

    console.log(`  ✓ ${wf.name} (${wf.checkpoints.length} checkpoints)`);
  }

  console.log('Seeding default organization and admin user...');

  const defaultOrg = await prisma.organization.upsert({
    where: { slug: 'default' },
    update: { name: 'Default Organization' },
    create: { slug: 'default', name: 'Default Organization' },
  });

  const adminEmail = 'admin@example.com';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const hashed = await hashPassword('Admin1234!');
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Admin',
        password: hashed,
        organizationId: defaultOrg.id,
      },
    });
    console.log(`  ✓ Admin user created: ${adminEmail} / Admin1234!`);
  } else {
    console.log(`  ✓ Admin user already exists: ${adminEmail}`);
  }

  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
