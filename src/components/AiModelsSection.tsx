import { AiModelChoice, AiModelSettings, AiUseCaseId } from '../api';
import { useTranslation } from '../i18n/LanguageContext';
import { Select } from './Select';

export type AiChoiceDraft = Partial<Record<AiUseCaseId, AiModelChoice>>;

const DEFAULT = 'DEFAULT';
const OFF = 'OFF';

type Props = {
  settings: AiModelSettings;
  choices: AiChoiceDraft;
  onChange: (choices: AiChoiceDraft) => void;
};

/**
 * Settings → AI models: for every outside AI use case, the server's own setup (.env) or a provider and model.
 * The API keys stay on the server; only providers with a key are offered.
 */
export function AiModelsSection({ settings, choices, onChange }: Props) {
  const { t } = useTranslation();
  const providerName = (id: string) => settings.providers.find((p) => p.id === id)?.name ?? id;

  const setProvider = (useCase: AiModelSettings['useCases'][number], provider: string) => {
    const next = { ...choices };
    if (provider === DEFAULT) delete next[useCase.id];
    else if (provider === OFF) next[useCase.id] = { provider: OFF };
    else next[useCase.id] = { provider, model: useCase.suggestions[provider]?.[0] ?? '' };
    onChange(next);
  };
  const setModel = (useCase: AiUseCaseId, model: string) => {
    const current = choices[useCase];
    if (current) onChange({ ...choices, [useCase]: { ...current, model } });
  };

  return (
    <div className="form-section">
      <h3>{t('adminSettings.aiSection')}</h3>
      <p className="field-hint">{t('adminSettings.aiHint')}</p>
      {settings.useCases.map((useCase) => {
        const choice = choices[useCase.id];
        const provider = choice?.provider ?? DEFAULT;
        const listId = `ai-models-${useCase.id}`;
        return (
          <div key={useCase.id}>
            <div className="form-grid">
              <label className="form-field">
                <span>{t(`adminSettings.ai${useCase.id}`)}</span>
                <Select
                  value={provider}
                  onChange={(value) => setProvider(useCase, value)}
                  options={[
                    { value: DEFAULT, label: t('adminSettings.aiServerDefault', { model: useCase.serverDefault || t('adminSettings.aiOff') }) },
                    ...(useCase.canTurnOff ? [{ value: OFF, label: t('adminSettings.aiOff') }] : []),
                    ...useCase.providers.map((id) => ({ value: id, label: providerName(id) }))
                  ]}
                />
              </label>
              {choice && choice.provider !== OFF && (
                <label className="form-field">
                  <span>{t('adminSettings.aiModel')}</span>
                  <input list={listId} value={choice.model ?? ''} onChange={(e) => setModel(useCase.id, e.target.value)} required />
                  <datalist id={listId}>
                    {(useCase.suggestions[choice.provider] ?? []).map((model) => (
                      <option key={model} value={model} />
                    ))}
                  </datalist>
                </label>
              )}
            </div>
            <p className="field-hint">{t(`adminSettings.ai${useCase.id}Hint`)}</p>
          </div>
        );
      })}
    </div>
  );
}
