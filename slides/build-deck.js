// DealFlow — Client Pitch Deck (build script)
// Run: node build-deck.js
// Output: DealFlow-Pitch.pptx
//
// Design: 16:9, slate-900 dark for opening/closing slides + white content slides.
// Brand: indigo primary, emerald for "speed" wedge, purple for "AI" wedge, amber accent.

const pptxgen = require('pptxgenjs');

// ============ Palette & typography ============
const C = {
  bgDark: '0F172A',
  bgLight: 'FFFFFF',
  cardBg: 'F8FAFC',
  textDark: '0F172A',
  textMuted: '64748B',
  textLight: 'F1F5F9',
  textLightMuted: '94A3B8',
  primary: '6366F1', // indigo
  speed: '10B981', // emerald
  ai: 'A855F7', // purple
  amber: 'F59E0B', // accent
  border: 'E2E8F0',
  red: 'EF4444',
  good: '10B981',
};
const FONT = 'Calibri';

// ============ Helpers ============
const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9'; // 10" x 5.625"
pres.author = 'DealFlow';
pres.title = "DealFlow — A CRM That Doesn't Suck";
pres.company = 'DealFlow';

function footer(slide, page, total) {
  slide.addText('DealFlow · github.com/LimHuanYang/DealFlow', {
    x: 0.5,
    y: 5.3,
    w: 7,
    h: 0.25,
    fontSize: 9,
    fontFace: FONT,
    color: C.textMuted,
    align: 'left',
    margin: 0,
  });
  slide.addText(`${page} / ${total}`, {
    x: 8.5,
    y: 5.3,
    w: 1,
    h: 0.25,
    fontSize: 9,
    fontFace: FONT,
    color: C.textMuted,
    align: 'right',
    margin: 0,
  });
}

function slideTitle(slide, title, subtitle) {
  slide.addText(title, {
    x: 0.5,
    y: 0.35,
    w: 9,
    h: 0.65,
    fontSize: 30,
    fontFace: FONT,
    bold: true,
    color: C.textDark,
    align: 'left',
    margin: 0,
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5,
      y: 1.0,
      w: 9,
      h: 0.4,
      fontSize: 14,
      fontFace: FONT,
      color: C.textMuted,
      align: 'left',
      margin: 0,
    });
  }
}

// Reusable shadow factory — pptxgenjs mutates shadow objects in-place.
const shadow = () => ({
  type: 'outer',
  color: '000000',
  blur: 8,
  offset: 2,
  angle: 90,
  opacity: 0.08,
});

// ============ Slide 1 — Title (dark) ============
function s1_title() {
  const s = pres.addSlide();
  s.background = { color: C.bgDark };

  // Vertical accent stripe (no underline / no decorative bar across)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 0.18,
    h: 5.625,
    fill: { color: C.primary },
    line: { color: C.primary, width: 0 },
  });

  s.addText('DealFlow', {
    x: 0.8,
    y: 1.5,
    w: 8.5,
    h: 1.4,
    fontSize: 88,
    fontFace: FONT,
    bold: true,
    color: C.textLight,
    align: 'left',
    margin: 0,
    charSpacing: -1,
  });

  s.addText("A CRM that doesn't suck.", {
    x: 0.8,
    y: 2.9,
    w: 8.5,
    h: 0.55,
    fontSize: 26,
    fontFace: FONT,
    color: C.primary,
    align: 'left',
    margin: 0,
    italic: true,
  });

  s.addText('Speed-first. AI-native. Built for the modern team.', {
    x: 0.8,
    y: 3.5,
    w: 8.5,
    h: 0.4,
    fontSize: 15,
    fontFace: FONT,
    color: C.textLightMuted,
    align: 'left',
    margin: 0,
  });

  s.addText('Pitch · May 2026', {
    x: 0.8,
    y: 5.0,
    w: 5,
    h: 0.3,
    fontSize: 11,
    fontFace: FONT,
    color: C.textLightMuted,
    align: 'left',
    margin: 0,
  });
}

// ============ Slide 2 — The problem ============
function s2_problem(page, total) {
  const s = pres.addSlide();
  s.background = { color: C.bgLight };
  slideTitle(s, 'Every CRM today makes you choose.', 'And nobody wins.');

  const cards = [
    {
      label: 'HubSpot, Salesforce',
      tag: 'Powerful but bloated',
      color: C.red,
      issues: [
        'Steep learning curve',
        'Sluggish UI; modals on modals',
        'Expensive at scale',
        'Locked-in data',
      ],
    },
    {
      label: 'Pipedrive, Close',
      tag: 'Simple but limited',
      color: C.amber,
      issues: [
        'No real AI workflow',
        'Rigid data model',
        'Reporting is shallow',
        'Per-seat pricing punishes growth',
      ],
    },
    {
      label: 'Vtiger OSS, SuiteCRM',
      tag: 'Self-host but ugly',
      color: C.textMuted,
      issues: [
        'Looks like 2008',
        'Maintenance burden',
        'No modern UX patterns',
        'Smaller community',
      ],
    },
  ];

  const startX = 0.5;
  const cardW = 2.95;
  const gap = 0.3;
  const cardY = 1.6;
  const cardH = 3.3;

  cards.forEach((card, i) => {
    const x = startX + i * (cardW + gap);
    // Card body
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y: cardY,
      w: cardW,
      h: cardH,
      fill: { color: C.cardBg },
      line: { color: C.border, width: 1 },
      shadow: shadow(),
    });
    // Left accent stripe (use RECTANGLE, not rounded — clean alignment)
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y: cardY,
      w: 0.08,
      h: cardH,
      fill: { color: card.color },
      line: { color: card.color, width: 0 },
    });
    s.addText(card.label, {
      x: x + 0.25,
      y: cardY + 0.2,
      w: cardW - 0.4,
      h: 0.4,
      fontSize: 16,
      fontFace: FONT,
      bold: true,
      color: C.textDark,
      align: 'left',
      margin: 0,
    });
    s.addText(card.tag, {
      x: x + 0.25,
      y: cardY + 0.6,
      w: cardW - 0.4,
      h: 0.35,
      fontSize: 12,
      fontFace: FONT,
      italic: true,
      color: card.color,
      align: 'left',
      margin: 0,
    });
    s.addText(
      card.issues.map((t, j) => ({
        text: t,
        options: { bullet: true, breakLine: j < card.issues.length - 1 },
      })),
      {
        x: x + 0.25,
        y: cardY + 1.05,
        w: cardW - 0.4,
        h: cardH - 1.2,
        fontSize: 12,
        fontFace: FONT,
        color: C.textDark,
        align: 'left',
        valign: 'top',
        paraSpaceAfter: 4,
      },
    );
  });

  // Bottom punchline
  s.addText('You shouldn’t have to.', {
    x: 0.5,
    y: 5.0,
    w: 9,
    h: 0.35,
    fontSize: 14,
    fontFace: FONT,
    bold: true,
    color: C.primary,
    align: 'right',
    margin: 0,
  });

  footer(s, page, total);
}

// ============ Slide 3 — Two wedges ============
function s3_wedges(page, total) {
  const s = pres.addSlide();
  s.background = { color: C.bgLight };
  slideTitle(s, 'DealFlow wins on two things.', 'Not five. Two.');

  const halfW = 4.3;
  const gap = 0.4;
  const x1 = 0.5;
  const x2 = x1 + halfW + gap;
  const y = 1.55;
  const h = 3.6;

  // Left — Speed (emerald)
  s.addShape(pres.shapes.RECTANGLE, {
    x: x1,
    y,
    w: halfW,
    h,
    fill: { color: C.cardBg },
    line: { color: C.border, width: 1 },
    shadow: shadow(),
  });
  s.addShape(pres.shapes.OVAL, {
    x: x1 + 0.3,
    y: y + 0.3,
    w: 0.55,
    h: 0.55,
    fill: { color: C.speed },
    line: { color: C.speed, width: 0 },
  });
  s.addText('1', {
    x: x1 + 0.3,
    y: y + 0.3,
    w: 0.55,
    h: 0.55,
    fontSize: 24,
    fontFace: FONT,
    bold: true,
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
  s.addText('Speed & keyboard-first', {
    x: x1 + 1.0,
    y: y + 0.32,
    w: halfW - 1.2,
    h: 0.5,
    fontSize: 20,
    fontFace: FONT,
    bold: true,
    color: C.textDark,
    align: 'left',
    margin: 0,
  });
  s.addText('"HubSpot feels like a mainframe. DealFlow feels like Linear."', {
    x: x1 + 0.3,
    y: y + 1.1,
    w: halfW - 0.6,
    h: 0.7,
    fontSize: 13,
    fontFace: FONT,
    italic: true,
    color: C.speed,
    align: 'left',
    margin: 0,
  });
  s.addText(
    [
      { text: 'Cmd-K runs every action', options: { bullet: true, breakLine: true } },
      { text: 'Page transitions under 100 ms', options: { bullet: true, breakLine: true } },
      { text: 'Optimistic updates everywhere', options: { bullet: true, breakLine: true } },
      { text: 'Inline edit. No modal-per-field nonsense.', options: { bullet: true } },
    ],
    {
      x: x1 + 0.3,
      y: y + 1.9,
      w: halfW - 0.6,
      h: 1.6,
      fontSize: 13,
      fontFace: FONT,
      color: C.textDark,
      paraSpaceAfter: 6,
    },
  );

  // Right — AI native (purple)
  s.addShape(pres.shapes.RECTANGLE, {
    x: x2,
    y,
    w: halfW,
    h,
    fill: { color: C.cardBg },
    line: { color: C.border, width: 1 },
    shadow: shadow(),
  });
  s.addShape(pres.shapes.OVAL, {
    x: x2 + 0.3,
    y: y + 0.3,
    w: 0.55,
    h: 0.55,
    fill: { color: C.ai },
    line: { color: C.ai, width: 0 },
  });
  s.addText('2', {
    x: x2 + 0.3,
    y: y + 0.3,
    w: 0.55,
    h: 0.55,
    fontSize: 24,
    fontFace: FONT,
    bold: true,
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    margin: 0,
  });
  s.addText('AI-native', {
    x: x2 + 1.0,
    y: y + 0.32,
    w: halfW - 1.2,
    h: 0.5,
    fontSize: 20,
    fontFace: FONT,
    bold: true,
    color: C.textDark,
    align: 'left',
    margin: 0,
  });
  s.addText('"Incumbents bolt AI on. DealFlow is built around it."', {
    x: x2 + 0.3,
    y: y + 1.1,
    w: halfW - 0.6,
    h: 0.7,
    fontSize: 13,
    fontFace: FONT,
    italic: true,
    color: C.ai,
    align: 'left',
    margin: 0,
  });
  s.addText(
    [
      { text: 'Summarize long notes in 2 bullets', options: { bullet: true, breakLine: true } },
      {
        text: 'Draft follow-up emails from deal context',
        options: { bullet: true, breakLine: true },
      },
      {
        text: 'Natural-language filters ("stalled >14d, >$10k")',
        options: { bullet: true, breakLine: true },
      },
      { text: 'Extract contacts from pasted email signatures', options: { bullet: true } },
    ],
    {
      x: x2 + 0.3,
      y: y + 1.9,
      w: halfW - 0.6,
      h: 1.6,
      fontSize: 13,
      fontFace: FONT,
      color: C.textDark,
      paraSpaceAfter: 6,
    },
  );

  footer(s, page, total);
}

// ============ Slide 4 — Four audiences (2x2 grid) ============
function s4_audiences(page, total) {
  const s = pres.addSlide();
  s.background = { color: C.bgLight };
  slideTitle(
    s,
    'One kernel. Four audiences.',
    'All share the same core. Each gets dedicated features over Phases 2-4.',
  );

  const audiences = [
    {
      label: 'Solo founders & 2-10 person startups',
      color: C.primary,
      pain: 'HubSpot is bloated. Pipedrive is overkill. Notion isn’t a CRM.',
    },
    {
      label: 'Agencies & consultancies',
      color: C.speed,
      pain: 'Need pipeline + client projects + time-tracking in one place.',
    },
    {
      label: 'B2B sales teams (10-50 reps)',
      color: C.ai,
      pain: 'Want automation + reporting without a Salesforce admin.',
    },
    {
      label: 'Self-hosted / privacy-first companies',
      color: C.amber,
      pain: 'Modern UX, on their own infrastructure. Vtiger looks like 2008.',
    },
  ];

  const cellW = 4.35;
  const cellH = 1.65;
  const gap = 0.25;
  const startX = 0.5;
  const startY = 1.65;

  audiences.forEach((a, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = startX + col * (cellW + gap);
    const y = startY + row * (cellH + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: cellW,
      h: cellH,
      fill: { color: C.cardBg },
      line: { color: C.border, width: 1 },
      shadow: shadow(),
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: 0.08,
      h: cellH,
      fill: { color: a.color },
      line: { color: a.color, width: 0 },
    });
    s.addText(a.label, {
      x: x + 0.25,
      y: y + 0.22,
      w: cellW - 0.4,
      h: 0.55,
      fontSize: 15,
      fontFace: FONT,
      bold: true,
      color: C.textDark,
      align: 'left',
      margin: 0,
    });
    s.addText(a.pain, {
      x: x + 0.25,
      y: y + 0.85,
      w: cellW - 0.4,
      h: 0.65,
      fontSize: 12,
      fontFace: FONT,
      color: C.textMuted,
      align: 'left',
      margin: 0,
    });
  });

  footer(s, page, total);
}

// ============ Slide 5 — Phase 1 kernel ============
function s5_kernel(page, total) {
  const s = pres.addSlide();
  s.background = { color: C.bgLight };
  slideTitle(
    s,
    'Phase 1 — The kernel.',
    'Everything our four audiences share. Built first, polished, then expanded.',
  );

  const left = [
    { head: 'Core CRM data', items: ['Contacts', 'Companies', 'Deals', 'Pipelines & stages'] },
    {
      head: 'Workflow',
      items: ['Kanban with drag-drop', 'Activities, Notes, Tasks', 'Inline editing everywhere'],
    },
  ];
  const right = [
    {
      head: 'Foundation',
      items: [
        'Email + password auth',
        'Google OAuth',
        'Multi-tenant isolation',
        'Team invitations',
      ],
    },
    {
      head: 'Differentiators',
      items: ['4 AI actions in v1', 'Cmd-K command palette', 'SaaS + self-host from one codebase'],
    },
  ];

  const colW = 4.35;
  const startY = 1.55;

  function drawColumn(x, blocks) {
    let y = startY;
    blocks.forEach((b) => {
      s.addShape(pres.shapes.RECTANGLE, {
        x,
        y,
        w: 0.08,
        h: 0.4,
        fill: { color: C.primary },
        line: { color: C.primary, width: 0 },
      });
      s.addText(b.head, {
        x: x + 0.2,
        y,
        w: colW - 0.2,
        h: 0.4,
        fontSize: 17,
        fontFace: FONT,
        bold: true,
        color: C.textDark,
        align: 'left',
        margin: 0,
        valign: 'middle',
      });
      y += 0.45;
      s.addText(
        b.items.map((t, i) => ({
          text: t,
          options: { bullet: { code: '25CF' }, breakLine: i < b.items.length - 1 },
        })),
        {
          x: x + 0.2,
          y,
          w: colW - 0.2,
          h: 0.32 * b.items.length + 0.1,
          fontSize: 13,
          fontFace: FONT,
          color: C.textDark,
          paraSpaceAfter: 3,
        },
      );
      y += 0.32 * b.items.length + 0.3;
    });
  }

  drawColumn(0.5, left);
  drawColumn(5.15, right);

  footer(s, page, total);
}

// ============ Slide 6 — Roadmap ============
function s6_roadmap(page, total) {
  const s = pres.addSlide();
  s.background = { color: C.bgLight };
  slideTitle(
    s,
    'The road from kernel to category leader.',
    'Each phase ships something real. No 12-month silent builds.',
  );

  const phases = [
    {
      label: 'Phase 1',
      tag: 'Now',
      color: C.primary,
      items: ['Contacts', 'Deals + Pipeline', 'Activities, Notes', 'Auth + Orgs', '4 AI actions'],
    },
    {
      label: 'Phase 2',
      tag: '+3 months',
      color: C.speed,
      items: ['Email sync', 'Calendar', 'Reporting', 'Magic links', 'Microsoft OAuth'],
    },
    {
      label: 'Phase 3',
      tag: '+6 months',
      color: C.ai,
      items: [
        'Workflow automation',
        'Custom objects + fields',
        'Mobile app',
        'Time-tracking',
        'Client projects',
      ],
    },
    {
      label: 'Phase 4',
      tag: '+12 months',
      color: C.amber,
      items: [
        'Public API + webhooks',
        'Native integrations',
        'Marketplace',
        'SSO / SAML',
        'Multi-region',
      ],
    },
  ];

  const cardW = 2.2;
  const gap = 0.15;
  const startX = 0.5;
  const y = 1.6;
  const h = 3.4;

  phases.forEach((p, i) => {
    const x = startX + i * (cardW + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: cardW,
      h,
      fill: { color: C.cardBg },
      line: { color: C.border, width: 1 },
      shadow: shadow(),
    });
    // Phase tag pill
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x + 0.2,
      y: y + 0.25,
      w: 1.0,
      h: 0.35,
      fill: { color: p.color },
      line: { color: p.color, width: 0 },
      rectRadius: 0.1,
    });
    s.addText(p.tag, {
      x: x + 0.2,
      y: y + 0.25,
      w: 1.0,
      h: 0.35,
      fontSize: 10,
      fontFace: FONT,
      bold: true,
      color: 'FFFFFF',
      align: 'center',
      valign: 'middle',
      margin: 0,
    });
    s.addText(p.label, {
      x: x + 0.2,
      y: y + 0.7,
      w: cardW - 0.4,
      h: 0.4,
      fontSize: 17,
      fontFace: FONT,
      bold: true,
      color: C.textDark,
      align: 'left',
      margin: 0,
    });
    s.addText(
      p.items.map((t, j) => ({
        text: t,
        options: { bullet: { code: '25CF' }, breakLine: j < p.items.length - 1 },
      })),
      {
        x: x + 0.2,
        y: y + 1.15,
        w: cardW - 0.4,
        h: h - 1.3,
        fontSize: 11,
        fontFace: FONT,
        color: C.textDark,
        paraSpaceAfter: 3,
        valign: 'top',
      },
    );
  });

  footer(s, page, total);
}

// ============ Slide 7 — Deployment flexibility ============
function s7_deployment(page, total) {
  const s = pres.addSlide();
  s.background = { color: C.bgLight };
  slideTitle(
    s,
    'SaaS or self-host. Same code.',
    'One env var switches modes. No fork, no two products.',
  );

  const halfW = 4.3;
  const gap = 0.4;
  const x1 = 0.5;
  const x2 = x1 + halfW + gap;
  const y = 1.55;
  const h = 3.0;

  function modeCard(x, title, tag, color, items) {
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: halfW,
      h,
      fill: { color: C.cardBg },
      line: { color: C.border, width: 1 },
      shadow: shadow(),
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: halfW,
      h: 0.7,
      fill: { color },
      line: { color, width: 0 },
    });
    s.addText(title, {
      x: x + 0.3,
      y: y + 0.0,
      w: halfW - 0.6,
      h: 0.7,
      fontSize: 22,
      fontFace: FONT,
      bold: true,
      color: 'FFFFFF',
      align: 'left',
      valign: 'middle',
      margin: 0,
    });
    s.addText(tag, {
      x: x + 0.3,
      y: y + 0.85,
      w: halfW - 0.6,
      h: 0.3,
      fontSize: 11,
      fontFace: FONT,
      italic: true,
      color: C.textMuted,
      align: 'left',
      margin: 0,
    });
    s.addText(
      items.map((t, j) => ({
        text: t,
        options: { bullet: true, breakLine: j < items.length - 1 },
      })),
      {
        x: x + 0.3,
        y: y + 1.25,
        w: halfW - 0.6,
        h: h - 1.4,
        fontSize: 13,
        fontFace: FONT,
        color: C.textDark,
        paraSpaceAfter: 5,
      },
    );
  }

  modeCard(x1, 'SaaS', 'dealflow.app · multi-tenant · hosted', C.primary, [
    'Many organizations in one DB',
    'AI provider configured by us',
    'Billing routes (Stripe, post-Phase-1)',
    'Auto-updates, no ops for users',
  ]);

  modeCard(x2, 'Self-host', 'Single-org Docker image · your infra', C.speed, [
    'Customer owns their data + DB',
    'Optional AI (or AI_PROVIDER=none)',
    'No billing, no telemetry by default',
    'Perfect for privacy-first companies',
  ]);

  // Center divider note
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 1.5,
    y: 4.75,
    w: 7,
    h: 0.5,
    fill: { color: C.bgDark },
    line: { color: C.bgDark, width: 0 },
    rectRadius: 0.1,
  });
  s.addText('DEPLOYMENT_MODE=saas | self-host', {
    x: 1.5,
    y: 4.75,
    w: 7,
    h: 0.5,
    fontSize: 14,
    fontFace: 'Consolas',
    bold: true,
    color: C.textLight,
    align: 'center',
    valign: 'middle',
    margin: 0,
  });

  footer(s, page, total);
}

// ============ Slide 8 — Tech foundation ============
function s8_tech(page, total) {
  const s = pres.addSlide();
  s.background = { color: C.bgLight };
  slideTitle(s, 'Boring, modern tech.', 'The interesting parts go in the product, not the stack.');

  const techs = [
    { label: 'Node 22 + Fastify', desc: 'API runtime' },
    { label: 'PostgreSQL 16 + Drizzle', desc: 'Database + typed ORM' },
    { label: 'React 19 + TanStack', desc: 'UI + routing + queries' },
    { label: 'Tailwind v4 + shadcn/ui', desc: 'Styling + accessible primitives' },
    { label: 'pg-boss', desc: 'Background jobs (in Postgres)' },
    { label: 'Anthropic + OpenAI', desc: 'Pluggable AI providers' },
    { label: 'Docker + WSL 2', desc: 'Dev environment + self-host image' },
    { label: 'TypeScript (strict)', desc: 'End-to-end type safety' },
  ];

  const cellW = 2.15;
  const cellH = 1.0;
  const gap = 0.2;
  const startX = 0.5;
  const startY = 1.7;

  techs.forEach((t, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    const x = startX + col * (cellW + gap);
    const y = startY + row * (cellH + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: cellW,
      h: cellH,
      fill: { color: C.cardBg },
      line: { color: C.border, width: 1 },
      shadow: shadow(),
    });
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.2,
      y: y + 0.2,
      w: 0.25,
      h: 0.25,
      fill: { color: C.primary },
      line: { color: C.primary, width: 0 },
    });
    s.addText(t.label, {
      x: x + 0.55,
      y: y + 0.18,
      w: cellW - 0.65,
      h: 0.35,
      fontSize: 12,
      fontFace: FONT,
      bold: true,
      color: C.textDark,
      align: 'left',
      margin: 0,
    });
    s.addText(t.desc, {
      x: x + 0.55,
      y: y + 0.55,
      w: cellW - 0.65,
      h: 0.35,
      fontSize: 10,
      fontFace: FONT,
      color: C.textMuted,
      align: 'left',
      margin: 0,
    });
  });

  // Pull-quote at bottom
  s.addText(
    'No exotic dependencies. No Redis. No Kubernetes for v1. A single junior dev should be able to read this stack and ship.',
    {
      x: 0.5,
      y: 4.7,
      w: 9,
      h: 0.6,
      fontSize: 12,
      fontFace: FONT,
      italic: true,
      color: C.textMuted,
      align: 'center',
      margin: 0,
    },
  );

  footer(s, page, total);
}

// ============ Slide 9 — Where we are now (honest) ============
function s9_status(page, total) {
  const s = pres.addSlide();
  s.background = { color: C.bgLight };
  slideTitle(s, 'Honest status — May 2026.', 'Public repo from day one. No vaporware.');

  // Big stat on left
  s.addText('4', {
    x: 0.5,
    y: 1.5,
    w: 2.2,
    h: 2.0,
    fontSize: 180,
    fontFace: FONT,
    bold: true,
    color: C.primary,
    align: 'center',
    valign: 'middle',
    margin: 0,
    charSpacing: -3,
  });
  s.addText('of 12', {
    x: 0.5,
    y: 3.4,
    w: 2.2,
    h: 0.4,
    fontSize: 14,
    fontFace: FONT,
    color: C.textMuted,
    align: 'center',
    margin: 0,
  });
  s.addText('foundation tasks complete', {
    x: 0.5,
    y: 3.75,
    w: 2.2,
    h: 0.35,
    fontSize: 11,
    fontFace: FONT,
    color: C.textMuted,
    align: 'center',
    margin: 0,
  });

  // Two status columns on right
  const doneItems = [
    'pnpm monorepo + TypeScript strict',
    '@dealflow/shared (Zod schemas)',
    '@dealflow/db (Drizzle scaffold)',
    '@dealflow/ai (provider + Noop)',
    '8 unit tests passing',
    'GitHub repo + CI plan',
    'Design + plan docs (20 + 1937 lines)',
    'TESTING.md + SETUP.md for non-devs',
  ];
  const nextItems = [
    'Docker dev environment',
    'Fastify API + integration tests',
    'React + Tailwind + shadcn skeleton',
    'Playwright E2E smoke',
    'GitHub Actions CI green',
    '→ Sub-Plan 2: Auth + Multi-tenancy',
    '→ Sub-Plan 3: Contacts + Companies',
    '→ Sub-Plan 4: Pipeline + Deals (kanban)',
  ];

  const colW = 3.3;
  const colY = 1.5;
  const colH = 3.5;
  const x1 = 2.9;
  const x2 = x1 + colW + 0.2;

  // Done column
  s.addShape(pres.shapes.RECTANGLE, {
    x: x1,
    y: colY,
    w: colW,
    h: colH,
    fill: { color: C.cardBg },
    line: { color: C.border, width: 1 },
    shadow: shadow(),
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: x1,
    y: colY,
    w: colW,
    h: 0.5,
    fill: { color: C.good },
    line: { color: C.good, width: 0 },
  });
  s.addText('Done', {
    x: x1 + 0.2,
    y: colY,
    w: colW - 0.4,
    h: 0.5,
    fontSize: 14,
    fontFace: FONT,
    bold: true,
    color: 'FFFFFF',
    align: 'left',
    valign: 'middle',
    margin: 0,
  });
  s.addText(
    doneItems.map((t, j) => ({
      text: t,
      options: { bullet: { code: '2713' }, breakLine: j < doneItems.length - 1 },
    })),
    {
      x: x1 + 0.2,
      y: colY + 0.6,
      w: colW - 0.4,
      h: colH - 0.7,
      fontSize: 11,
      fontFace: FONT,
      color: C.textDark,
      paraSpaceAfter: 4,
    },
  );

  // Next column
  s.addShape(pres.shapes.RECTANGLE, {
    x: x2,
    y: colY,
    w: colW,
    h: colH,
    fill: { color: C.cardBg },
    line: { color: C.border, width: 1 },
    shadow: shadow(),
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: x2,
    y: colY,
    w: colW,
    h: 0.5,
    fill: { color: C.primary },
    line: { color: C.primary, width: 0 },
  });
  s.addText('Next (Sub-Plans 1-4)', {
    x: x2 + 0.2,
    y: colY,
    w: colW - 0.4,
    h: 0.5,
    fontSize: 14,
    fontFace: FONT,
    bold: true,
    color: 'FFFFFF',
    align: 'left',
    valign: 'middle',
    margin: 0,
  });
  s.addText(
    nextItems.map((t, j) => ({
      text: t,
      options: { bullet: { code: '25CB' }, breakLine: j < nextItems.length - 1 },
    })),
    {
      x: x2 + 0.2,
      y: colY + 0.6,
      w: colW - 0.4,
      h: colH - 0.7,
      fontSize: 11,
      fontFace: FONT,
      color: C.textDark,
      paraSpaceAfter: 4,
    },
  );

  footer(s, page, total);
}

// ============ Slide 10 — Competitive matrix ============
function s10_matrix(page, total) {
  const s = pres.addSlide();
  s.background = { color: C.bgLight };
  slideTitle(
    s,
    'How we stack up.',
    'Where we plan to land once Phase 1 ships. Be honest, not greedy.',
  );

  const rows = [
    ['', 'DealFlow', 'HubSpot', 'Pipedrive', 'Vtiger OSS'],
    ['Speed / keyboard UX', '✓✓', '—', '✓', '—'],
    ['AI-native', '✓✓', '✓ (bolt-on)', '—', '—'],
    ['Self-hostable', '✓', '✗', '✗', '✓'],
    ['Modern, accessible UI', '✓✓', '✓', '✓', '✗'],
    ['Public, open development', '✓', '✗', '✗', '✓'],
    ['Price (SMB tier)', 'Free → low', 'High', 'Mid', 'Free'],
  ];

  const tableData = rows.map((r, ri) =>
    r.map((cell, ci) => {
      const isHeader = ri === 0;
      const isLabel = ci === 0;
      const isUs = ci === 1;
      let fill = isHeader ? C.bgDark : ri % 2 === 0 ? 'F1F5F9' : 'FFFFFF';
      let color = isHeader ? 'FFFFFF' : C.textDark;
      let bold = isHeader || isLabel || isUs;
      // Highlight "us" column
      if (!isHeader && isUs) fill = 'EEF2FF'; // indigo-50
      if (!isHeader && isUs) color = C.primary;
      return {
        text: cell,
        options: {
          fill: { color: fill },
          color,
          bold,
          align: isLabel ? 'left' : 'center',
          valign: 'middle',
          fontSize: isHeader ? 12 : 11,
          fontFace: FONT,
          margin: 0.1,
        },
      };
    }),
  );

  s.addTable(tableData, {
    x: 0.5,
    y: 1.55,
    w: 9,
    colW: [2.6, 1.6, 1.6, 1.6, 1.6],
    rowH: 0.42,
    border: { pt: 0.75, color: C.border },
  });

  // Legend
  s.addText('✓✓ = strong differentiator     ✓ = supported     — = weak     ✗ = not supported', {
    x: 0.5,
    y: 4.85,
    w: 9,
    h: 0.3,
    fontSize: 10,
    fontFace: FONT,
    italic: true,
    color: C.textMuted,
    align: 'center',
    margin: 0,
  });

  footer(s, page, total);
}

// ============ Slide 11 — The ask (dark) ============
function s11_ask() {
  const s = pres.addSlide();
  s.background = { color: C.bgDark };

  s.addShape(pres.shapes.RECTANGLE, {
    x: 0,
    y: 0,
    w: 0.18,
    h: 5.625,
    fill: { color: C.primary },
    line: { color: C.primary, width: 0 },
  });

  s.addText('Want in?', {
    x: 0.8,
    y: 0.7,
    w: 8.5,
    h: 1.1,
    fontSize: 64,
    fontFace: FONT,
    bold: true,
    color: C.textLight,
    align: 'left',
    margin: 0,
    charSpacing: -1,
  });

  const ctas = [
    {
      title: 'Follow along',
      color: C.primary,
      lines: [
        'github.com/LimHuanYang/DealFlow',
        'Public repo. Watch / star for updates as Phase 1 ships.',
      ],
    },
    {
      title: 'Be a design partner',
      color: C.speed,
      lines: [
        'Early access + your feedback shapes the product.',
        'Best fit: small B2B sales team, agency, or solo founder.',
      ],
    },
    {
      title: 'Build something custom',
      color: C.ai,
      lines: [
        'Custom CRM work or DealFlow-on-your-infra deployments.',
        'Get in touch to discuss scope.',
      ],
    },
  ];

  const cardW = 2.95;
  const gap = 0.25;
  const startX = 0.5;
  const y = 2.3;
  const h = 2.0;

  ctas.forEach((c, i) => {
    const x = startX + i * (cardW + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: cardW,
      h,
      fill: { color: '1E293B' },
      line: { color: '334155', width: 1 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x,
      y,
      w: cardW,
      h: 0.08,
      fill: { color: c.color },
      line: { color: c.color, width: 0 },
    });
    s.addText(c.title, {
      x: x + 0.25,
      y: y + 0.2,
      w: cardW - 0.4,
      h: 0.45,
      fontSize: 17,
      fontFace: FONT,
      bold: true,
      color: c.color,
      align: 'left',
      margin: 0,
    });
    s.addText(
      c.lines.map((t, j) => ({
        text: t,
        options: { breakLine: j < c.lines.length - 1 },
      })),
      {
        x: x + 0.25,
        y: y + 0.75,
        w: cardW - 0.4,
        h: h - 0.85,
        fontSize: 12,
        fontFace: FONT,
        color: C.textLight,
        paraSpaceAfter: 4,
        valign: 'top',
      },
    );
  });

  // Contact line
  s.addText('limhuanyang@hotmail.com  ·  github.com/LimHuanYang', {
    x: 0.8,
    y: 4.85,
    w: 8.5,
    h: 0.35,
    fontSize: 13,
    fontFace: FONT,
    color: C.textLightMuted,
    align: 'left',
    margin: 0,
  });

  s.addText('DealFlow · May 2026', {
    x: 0.8,
    y: 5.15,
    w: 8.5,
    h: 0.3,
    fontSize: 10,
    fontFace: FONT,
    color: C.textLightMuted,
    align: 'left',
    margin: 0,
  });
}

// ============ Run ============
const total = 11;
s1_title();
s2_problem(2, total);
s3_wedges(3, total);
s4_audiences(4, total);
s5_kernel(5, total);
s6_roadmap(6, total);
s7_deployment(7, total);
s8_tech(8, total);
s9_status(9, total);
s10_matrix(10, total);
s11_ask();

pres
  .writeFile({ fileName: 'DealFlow-Pitch.pptx' })
  .then((fileName) => console.log(`Wrote ${fileName}`))
  .catch((err) => {
    console.error('Failed to write deck:', err);
    process.exit(1);
  });
