import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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
