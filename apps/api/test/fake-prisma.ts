// A small in-memory stand-in for PrismaService, covering only what the Nest
// services under test call. The Prisma-backed code paths are type-checked against
// the generated client; behaviour is covered here.

import type { PrismaService } from '../src/prisma/prisma.service';

type Row = Record<string, any>;
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (k === 'NOT') return !matches(row, v as Row);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      const o = v as Row;
      if ('gt' in o) return row[k] != null && row[k] > o.gt;
      if ('in' in o) return o.in.includes(row[k]);
      if (Object.keys(o).length === 0) return true;
      return false;
    }
    return row[k] === v;
  });
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  const specs = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Row[];
  if (specs.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [field, dir] = Object.entries(spec)[0] as [string, any];
      const sort = typeof dir === 'string' ? dir : dir.sort;
      const nullsLast = typeof dir === 'object' && dir.nulls === 'last';
      const av = a[field], bv = b[field];
      if (av == null || bv == null) {
        if (av == null && bv == null) continue;
        return (av == null ? 1 : -1) * (nullsLast ? 1 : -1);
      }
      if (av < bv) return sort === 'asc' ? -1 : 1;
      if (av > bv) return sort === 'asc' ? 1 : -1;
    }
    return 0;
  });
}

function table(name: string, fake: FakePrisma) {
  const rows: Row[] = [];
  fake.tables[name] = rows;
  const find = (where?: Row) => rows.find((r) => matches(r, where));
  return {
    rows,
    findUnique: async (a: { where: Row }) => {
      const [k, v] = Object.entries(a.where)[0] as [string, any];
      if (v && typeof v === 'object') return rows.find((r) => Object.entries(v).every(([kk, vv]) => r[kk] === vv)) ?? null;
      return rows.find((r) => r[k] === v) ?? null;
    },
    findFirst: async (a: { where?: Row; orderBy?: unknown } = {}) =>
      sortRows(rows.filter((r) => matches(r, a.where)), a.orderBy)[0] ?? null,
    findMany: async (a: { where?: Row; orderBy?: unknown } = {}) =>
      sortRows(rows.filter((r) => matches(r, a.where)), a.orderBy),
    create: async (a: { data: Row }) => {
      const row = { id: uid(), createdAt: new Date(), ...a.data };
      rows.push(row);
      return row;
    },
    update: async (a: { where: Row; data: Row }) => {
      const row = find(a.where);
      if (!row) throw new Error(`${name}: not found`);
      applyData(row, a.data);
      return row;
    },
    updateMany: async (a: { where: Row; data: Row }) => {
      const hit = rows.filter((r) => matches(r, a.where));
      hit.forEach((r) => applyData(r, a.data));
      return { count: hit.length };
    },
    upsert: async (a: { where: Row; create: Row; update: Row }) => {
      const [, v] = Object.entries(a.where)[0] as [string, any];
      const row = rows.find((r) => (v && typeof v === 'object'
        ? Object.entries(v).every(([kk, vv]) => r[kk] === vv)
        : Object.values(a.where).includes(r.id) || Object.values(a.where).some((x) => Object.values(r).includes(x))));
      if (row) { applyData(row, a.update); return row; }
      const created = { id: uid(), createdAt: new Date(), ...a.create };
      rows.push(created);
      return created;
    },
    deleteMany: async (a: { where?: Row } = {}) => {
      const keep = rows.filter((r) => !matches(r, a.where));
      const count = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return { count };
    },
    delete: async (a: { where: Row }) => {
      const i = rows.findIndex((r) => matches(r, a.where));
      if (i >= 0) rows.splice(i, 1);
      return {};
    },
  };
}

function applyData(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && !(v instanceof Date) && ('increment' in v || 'decrement' in v)) {
      const o = v as Row;
      row[k] = (row[k] ?? 0) + (o.increment ?? 0) - (o.decrement ?? 0);
    } else row[k] = v;
  }
}

export class FakePrisma {
  tables: Record<string, Row[]> = {};
  user = table('user', this);
  profile = table('profile', this);
  jobDescription = table('jobDescription', this);
  baseResume = table('baseResume', this);
  run = table('run', this);
  runLog = table('runLog', this);
  validationFlag = table('validationFlag', this);
  keywordSet = table('keywordSet', this);
  alignedCompany = table('alignedCompany', this);
  document = table('document', this);
  userSettings = table('userSettings', this);
  usageCounter = table('usageCounter', this);
  runCredit = table('runCredit', this);
  adminAction = table('adminAction', this);
  ruleSet = { upsert: async () => ({ id: 'ruleset-1', version: 'v3.1' }) };
  promptVersion = { upsert: async () => ({}) };

  constructor() {
    // Support `include: { jd, profile }` on run reads, as the real client does.
    const attach = (rows: Row[], include?: Row) => rows.map((r) => ({
      ...r,
      ...(include?.jd ? { jd: this.jobDescription.rows.find((j) => j.id === r.jdId) } : {}),
      ...(include?.profile ? { profile: this.profile.rows.find((p) => p.id === r.profileId) } : {}),
    }));
    const { findFirst, findMany } = this.run;
    (this.run as any).findFirst = async (a: any = {}) => {
      const row = await findFirst(a);
      return row ? attach([row], a.include)[0]! : null;
    };
    (this.run as any).findMany = async (a: any = {}) => {
      let rows = await findMany(a);
      if (a.cursor) rows = rows.slice(rows.findIndex((r) => r.id === a.cursor.id) + (a.skip ?? 0));
      if (a.take) rows = rows.slice(0, a.take);
      return attach(rows, a.include);
    };
  }

  async $transaction(arg: unknown) {
    if (typeof arg === 'function') return (arg as (tx: FakePrisma) => Promise<unknown>)(this);
    return Promise.all(arg as Promise<unknown>[]);
  }

  asService(): PrismaService { return this as unknown as PrismaService; }
}
