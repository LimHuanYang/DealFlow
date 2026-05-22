import { describe, expect, it } from 'vitest';
import { dashboardResponseSchema } from './reports.js';

describe('dashboardResponseSchema', () => {
  const valid = {
    kpis: {
      totalContacts: 12,
      totalCompanies: 3,
      openDeals: 7,
      openPipelineValue: '125000.00',
      overdueTasks: 2,
      currency: 'USD',
    },
    pipelineByStage: [
      {
        stageId: '11111111-1111-1111-1111-111111111111',
        stageName: 'Lead',
        value: '40000.00',
        dealCount: 4,
      },
    ],
    dealsTrend: [
      { month: '2026-01-01', won: 2, lost: 1, wonValue: '50000.00', lostValue: '12000.00' },
    ],
    activityVolume: [{ weekStart: '2026-01-06', count: 8 }],
    topOpenDeals: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Acme renewal',
        value: '80000.00',
        currency: 'USD',
        stageName: 'Negotiation',
        companyName: 'Acme',
      },
    ],
  };

  it('accepts a valid dashboard payload', () => {
    expect(() => dashboardResponseSchema.parse(valid)).not.toThrow();
  });

  it('rejects negative KPI counts', () => {
    expect(() =>
      dashboardResponseSchema.parse({ ...valid, kpis: { ...valid.kpis, totalContacts: -1 } }),
    ).toThrow();
  });

  it('allows companyName to be null on top-deal rows', () => {
    const v = { ...valid, topOpenDeals: [{ ...valid.topOpenDeals[0]!, companyName: null }] };
    expect(() => dashboardResponseSchema.parse(v)).not.toThrow();
  });
});
