import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UpdateIntegrationsInput } from '@dealflow/shared';
import { useIntegrations, useTestAI, useUpdateIntegrations } from './api';

type ProviderKey = 'anthropic' | 'gemini' | 'grok';

interface RowState {
  apiKey: string;
  model: string;
}

const PROVIDERS: { key: ProviderKey; label: string; defaultModel: string; placeholder: string }[] =
  [
    {
      key: 'anthropic',
      label: 'Anthropic (Claude)',
      defaultModel: 'claude-haiku-4-5',
      placeholder: 'sk-ant-...',
    },
    {
      key: 'gemini',
      label: 'Google (Gemini)',
      defaultModel: 'gemini-2.5-flash',
      placeholder: 'AIza...',
    },
    { key: 'grok', label: 'xAI (Grok)', defaultModel: 'grok-4', placeholder: 'xai-...' },
  ];

export function AIIntegrationsSection() {
  const integrations = useIntegrations();
  const update = useUpdateIntegrations();
  const test = useTestAI();

  const [rows, setRows] = useState<Record<ProviderKey, RowState>>({
    anthropic: { apiKey: '', model: '' },
    gemini: { apiKey: '', model: '' },
    grok: { apiKey: '', model: '' },
  });

  // When integrations load, seed each row's model from the saved value.
  useEffect(() => {
    if (!integrations.data) return;
    setRows((prev) => ({
      anthropic: { ...prev.anthropic, model: integrations.data!.anthropic.model ?? '' },
      gemini: { ...prev.gemini, model: integrations.data!.gemini.model ?? '' },
      grok: { ...prev.grok, model: integrations.data!.grok.model ?? '' },
    }));
  }, [integrations.data]);

  async function onSave(p: ProviderKey) {
    const row = rows[p];
    const apiKey = row.apiKey.trim();
    const model = row.model.trim();
    if (!apiKey) return; // require a fresh key to save
    const patch: UpdateIntegrationsInput = {
      [p]: { apiKey, model: model || undefined },
    } as UpdateIntegrationsInput;
    await update.mutateAsync(patch);
    setRows((prev) => ({ ...prev, [p]: { ...prev[p], apiKey: '' } }));
  }

  async function onClear(p: ProviderKey) {
    const patch: UpdateIntegrationsInput = { [p]: null } as UpdateIntegrationsInput;
    await update.mutateAsync(patch);
    setRows((prev) => ({ ...prev, [p]: { apiKey: '', model: '' } }));
  }

  async function onTest(p: ProviderKey) {
    await test.mutateAsync({ provider: p });
  }

  return (
    <section
      className="mt-4 rounded-md border border-neutral-200 p-4"
      data-testid="ai-integrations"
    >
      <h2 className="mb-3 text-base font-medium">AI integrations</h2>
      <p className="mb-4 text-sm text-neutral-500">
        Provide your own API keys for one or more providers. DealFlow tries them in order Anthropic
        → Gemini → Grok; any provider without a key is skipped.
      </p>

      {integrations.isPending && <p className="text-sm text-neutral-500">Loading…</p>}

      {integrations.data && (
        <div className="space-y-4">
          {PROVIDERS.map((p) => {
            const row = rows[p.key];
            const view = integrations.data![p.key];
            const lastTest = test.variables?.provider === p.key && test.data ? test.data : null;
            return (
              <div key={p.key} className="rounded-md border border-neutral-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium">{p.label}</span>
                  {view.configured ? (
                    <span className="text-xs text-green-700">
                      ✓ Configured · key ending in {view.apiKeyMask}
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-400">Not configured</span>
                  )}
                </div>
                <div className="grid grid-cols-[1fr_180px_auto] items-end gap-2">
                  <div>
                    <Label htmlFor={`${p.key}-key`} className="text-xs">
                      API key
                    </Label>
                    <Input
                      id={`${p.key}-key`}
                      type="password"
                      value={row.apiKey}
                      onChange={(e) =>
                        setRows((prev) => ({
                          ...prev,
                          [p.key]: { ...prev[p.key], apiKey: e.target.value },
                        }))
                      }
                      placeholder={view.configured ? '(unchanged)' : p.placeholder}
                      data-testid={`${p.key}-api-key`}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${p.key}-model`} className="text-xs">
                      Model
                    </Label>
                    <Input
                      id={`${p.key}-model`}
                      value={row.model}
                      onChange={(e) =>
                        setRows((prev) => ({
                          ...prev,
                          [p.key]: { ...prev[p.key], model: e.target.value },
                        }))
                      }
                      placeholder={p.defaultModel}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onSave(p.key)}
                    disabled={!row.apiKey.trim() || update.isPending}
                  >
                    Save
                  </Button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onTest(p.key)}
                    disabled={!view.configured || test.isPending}
                  >
                    {test.isPending && test.variables?.provider === p.key ? 'Testing…' : 'Test'}
                  </Button>
                  {view.configured && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onClear(p.key)}
                      disabled={update.isPending}
                    >
                      Clear
                    </Button>
                  )}
                  {lastTest && lastTest.ok && (
                    <span className="text-xs text-green-700">✓ Works</span>
                  )}
                  {lastTest && !lastTest.ok && (
                    <span className="text-xs text-red-600">✗ {lastTest.error}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
