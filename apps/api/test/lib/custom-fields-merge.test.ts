import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '@dealflow/db';
import { startTestPostgres, type TestDatabase } from '../helpers/postgres.js';
import { validateAndMergeCustomFields } from '../../src/lib/custom-fields-merge.js';

describe('validateAndMergeCustomFields', () => {
  let testDb: TestDatabase;
  let orgId: string;
  let textFieldId: string;
  let selectFieldId: string;
  let requiredFieldId: string;

  beforeAll(async () => {
    testDb = await startTestPostgres();
    const [org] = await testDb.db
      .insert(schema.organizations)
      .values({ name: 'Org', slug: `o-${Date.now()}`, defaultCurrency: 'USD' })
      .returning();
    orgId = org!.id;

    const [textField] = await testDb.db
      .insert(schema.customFieldDefinitions)
      .values({
        organizationId: orgId,
        entityType: 'contact',
        name: 'Notes',
        type: 'text',
        options: null,
        required: false,
        position: 0,
      })
      .returning();
    textFieldId = textField!.id;

    const [selectField] = await testDb.db
      .insert(schema.customFieldDefinitions)
      .values({
        organizationId: orgId,
        entityType: 'contact',
        name: 'Lead Source',
        type: 'select',
        options: { values: [{ key: 'referral', label: 'Referral' }, { key: 'web', label: 'Web' }] },
        required: false,
        position: 1,
      })
      .returning();
    selectFieldId = selectField!.id;

    const [requiredField] = await testDb.db
      .insert(schema.customFieldDefinitions)
      .values({
        organizationId: orgId,
        entityType: 'contact',
        name: 'Priority',
        type: 'number',
        options: null,
        required: true,
        position: 2,
      })
      .returning();
    requiredFieldId = requiredField!.id;
  }, 30_000);

  afterAll(() => testDb.stop());

  it('merges a valid patch into the existing JSONB', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: { [textFieldId]: 'old' },
      patch: { [selectFieldId]: 'referral' },
      isCreate: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.merged).toEqual({
      [textFieldId]: 'old',
      [selectFieldId]: 'referral',
    });
  });

  it('rejects an unknown field key', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: {},
      patch: { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': 'x' },
      isCreate: false,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects a value that fails type validation', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: {},
      patch: { [selectFieldId]: 'bogus' },  // not in options
      isCreate: false,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects creation when a required field is missing', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: {},
      patch: { [textFieldId]: 'hi' },  // required Priority absent
      isCreate: true,
    });
    expect(result.ok).toBe(false);
  });

  it('allows update without touching the required field', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: { [requiredFieldId]: 5 },
      patch: { [textFieldId]: 'updated' },
      isCreate: false,
    });
    expect(result.ok).toBe(true);
  });

  it('passes through when patch is undefined', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: { [textFieldId]: 'keep' },
      patch: undefined,
      isCreate: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.merged).toEqual({ [textFieldId]: 'keep' });
  });

  it('rejects null on a required field at create time', async () => {
    const result = await validateAndMergeCustomFields({ db: testDb.db }, {
      orgId,
      entityType: 'contact',
      existing: {},
      patch: { [requiredFieldId]: null },
      isCreate: true,
    });
    expect(result.ok).toBe(false);
  });
});
