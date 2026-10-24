import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  approvePriceProposal,
  confirmMaterialMatch,
  createRawMaterial,
  deleteRawMaterial,
  IndexSeriesOption,
  listIndexSeries,
  listRawMaterials,
  loadSampleMaterials,
  PricingRunResult,
  RawMaterial,
  rejectPriceProposal,
  rematchRawMaterial,
  runPricing,
  updateRawMaterial
} from '../api';
import { AmountInput } from '../components/AmountInput';
import { DateInput } from '../components/DateInput';
import { Select } from '../components/Select';
import { useCountry } from '../country/CountryContext';
import { useTranslation } from '../i18n/LanguageContext';
import { formatAmount } from '../lib/money';

/** Picked in the "change category" dropdown to say no index fits. */
const NO_INDEX = '__none__';

const percent = (value: number) => `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
const todayIso = () => new Date().toISOString().slice(0, 10);

// Raw materials as named in the ERP. For each: the index category the AI
// suggested (a person accepts or changes it), the current price, and the new
// price computed from the index and the exchange rate (a person approves it).
export function PricingPage() {
  const { t } = useTranslation();
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [series, setSeries] = useState<IndexSeriesOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<PricingRunResult | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(() => listRawMaterials().then(setMaterials), []);

  useEffect(() => {
    Promise.all([reload(), listIndexSeries().then(setSeries)])
      .catch((err) => setError(err instanceof Error ? err.message : t('pricing.loadFailed')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Runs one action at a time, shows its error, and puts the changed material back into the list. */
  const act = async (key: string, action: () => Promise<RawMaterial | void>) => {
    setBusy(key);
    setError(null);
    try {
      const updated = await action();
      if (updated) setMaterials((list) => list.map((m) => (m.id === updated.id ? updated : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pricing.actionFailed'));
    } finally {
      setBusy(null);
    }
  };

  const handleRun = () =>
    act('run', async () => {
      setRunResult(await runPricing());
      await reload();
    });

  const handleSample = () =>
    act('sample', async () => {
      await loadSampleMaterials();
      await reload();
    });

  const reviewCount = materials.filter((m) => m.matchStatus === 'NEEDS_REVIEW').length;
  const proposalCount = materials.filter((m) => m.pendingProposal).length;

  return (
    <div className="list-page">
      <div className="page-heading">
        <h2>{t('pricing.title')}</h2>
        <div className="list-actions">
          <button className="button-secondary" type="button" onClick={() => setAdding((a) => !a)}>
            {t('pricing.addMaterial')}
          </button>
          <button className="button-primary" type="button" onClick={handleRun} disabled={busy !== null || materials.length === 0}>
            {busy === 'run' ? t('pricing.calculating') : t('pricing.calculate')}
          </button>
        </div>
      </div>

      <div className="alert alert-info">
        <span>{t('pricing.pocNotice')}</span>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}

      {runResult && (
        <div className={`alert ${runResult.failed.length ? 'alert-warning' : 'alert-success'}`}>
          <span>
            {t('pricing.runResult', { proposed: String(runResult.proposed), unchanged: String(runResult.unchanged) })}
            {runResult.failed.map((f) => (
              <span key={f.name} className="pricing-run-failure">
                {f.name}: {f.error}
              </span>
            ))}
          </span>
        </div>
      )}

      {adding && (
        <AddMaterialForm
          onCancel={() => setAdding(false)}
          onSave={(input) =>
            act('add', async () => {
              const created = await createRawMaterial(input);
              setMaterials((list) => [...list, created].sort((a, b) => a.name.localeCompare(b.name)));
              setAdding(false);
            })
          }
          saving={busy === 'add'}
        />
      )}

      {loading ? (
        <div className="list-loading">{t('common.loading')}</div>
      ) : materials.length === 0 ? (
        <div className="empty-state">
          <h3>{t('pricing.empty')}</h3>
          <p>{t('pricing.emptyHint')}</p>
          <button className="button-primary" type="button" onClick={handleSample} disabled={busy !== null}>
            {busy === 'sample' ? t('pricing.loadingSample') : t('pricing.loadSample')}
          </button>
        </div>
      ) : (
        <>
          <p className="field-hint">{t('pricing.summary', { review: String(reviewCount), proposals: String(proposalCount) })}</p>
          <div className="material-list">
            {materials.map((material) => (
              <MaterialCard
                key={material.id}
                material={material}
                series={series}
                busy={busy}
                act={act}
                onDeleted={() => setMaterials((list) => list.filter((m) => m.id !== material.id))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type NewMaterial = { name: string; unit: string | null; price: number; priceDate: string };

function AddMaterialForm({ onSave, onCancel, saving }: { onSave: (input: NewMaterial) => void; onCancel: () => void; saving: boolean }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [priceDate, setPriceDate] = useState(todayIso());

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const value = Number(price);
    if (!name.trim() || !Number.isFinite(value) || value <= 0 || !priceDate) return;
    onSave({ name: name.trim(), unit: unit.trim() || null, price: value, priceDate });
  };

  return (
    <form className="review-form settings-form" onSubmit={handleSubmit}>
      <div className="form-section">
        <h3>{t('pricing.newMaterial')}</h3>
        <div className="form-grid">
          <label className="form-field">
            <span>{t('pricing.name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required dir="auto" />
          </label>
          <label className="form-field">
            <span>{t('pricing.unit')}</span>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} dir="auto" />
          </label>
          <label className="form-field">
            <span>{t('pricing.price')}</span>
            <AmountInput value={price} onChange={setPrice} />
          </label>
          <label className="form-field">
            <span>{t('pricing.priceDate')}</span>
            <DateInput value={priceDate} onChange={setPriceDate} />
          </label>
        </div>
        <p className="field-hint">{t('pricing.newMaterialHint')}</p>
      </div>
      <div className="action-bar">
        <button className="button-secondary" type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="button-primary" type="submit" disabled={saving}>
          {saving ? t('common.saving') : t('pricing.addMaterial')}
        </button>
      </div>
    </form>
  );
}

type CardProps = {
  material: RawMaterial;
  series: IndexSeriesOption[];
  busy: string | null;
  act: (key: string, action: () => Promise<RawMaterial | void>) => Promise<void>;
  onDeleted: () => void;
};

function MaterialCard({ material, series, busy, act, onDeleted }: CardProps) {
  const { t } = useTranslation();
  const { formatDate } = useCountry();
  const [changing, setChanging] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(material.name);
  const { suggestion, pendingProposal: proposal } = material;
  const disabled = busy !== null;
  const key = (action: string) => `${action}:${material.id}`;

  const confirm = (seriesId: string | null) =>
    act(key('confirm'), async () => {
      setChanging(false);
      return confirmMaterialMatch(material.id, seriesId);
    });

  const rename = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim() === material.name) {
      setRenaming(false);
      return;
    }
    void act(key('rename'), async () => {
      setRenaming(false);
      return updateRawMaterial(material.id, { name: name.trim() });
    });
  };

  const options = [{ value: NO_INDEX, label: t('pricing.noIndex') }, ...series.map((s) => ({ value: s.id, label: s.label }))];

  return (
    <div className={`material-card material-card--${material.matchStatus.toLowerCase()}`}>
      <div className="material-card-head">
        {renaming ? (
          <form className="material-rename" onSubmit={rename}>
            <input value={name} onChange={(e) => setName(e.target.value)} dir="auto" autoFocus />
            <button className="button-primary" type="submit" disabled={disabled}>
              {t('common.save')}
            </button>
            <button className="button-secondary" type="button" onClick={() => setRenaming(false)}>
              {t('common.cancel')}
            </button>
          </form>
        ) : (
          <div>
            <span className="material-name" dir="auto">
              {material.name}
            </span>
            {material.unit && (
              <span className="material-unit" dir="auto">
                {' '}
                / {material.unit}
              </span>
            )}
          </div>
        )}
        <span className={`match-pill match-pill--${material.matchStatus.toLowerCase()}`}>{t(`pricing.status${material.matchStatus}`)}</span>
      </div>

      <div className="material-card-body">
        <div className="material-section">
          <span className="material-label">{t('pricing.category')}</span>
          <span>{material.series?.label ?? (material.matchStatus === 'NO_INDEX' ? t('pricing.noIndex') : '—')}</span>

          {material.matchError && <span className="material-error">{t('pricing.matchFailed', { error: material.matchError })}</span>}

          {suggestion && (
            <div className="material-suggestion">
              <span>
                {t('pricing.suggested')}: <strong>{suggestion.series?.label ?? t('pricing.noIndex')}</strong>
                {suggestion.confidence !== null && ` · ${Math.round(suggestion.confidence * 100)}%`}
                {suggestion.by && <span className="material-by"> · {suggestion.by}</span>}
              </span>
              {suggestion.reason && <small dir="auto">{suggestion.reason}</small>}
            </div>
          )}

          {changing ? (
            <div className="material-change">
              <Select
                value={material.series?.id ?? suggestion?.series?.id ?? ''}
                onChange={(value) => confirm(value === NO_INDEX ? null : value)}
                options={options}
                placeholder={t('pricing.chooseCategory')}
              />
              <button className="button-secondary" type="button" onClick={() => setChanging(false)}>
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <div className="material-actions">
              {suggestion && (
                <button className="button-primary" type="button" disabled={disabled} onClick={() => confirm(suggestion.series?.id ?? null)}>
                  {t('pricing.accept')}
                </button>
              )}
              <button className="button-secondary" type="button" disabled={disabled} onClick={() => setChanging(true)}>
                {t('pricing.change')}
              </button>
              <button
                className="button-secondary"
                type="button"
                disabled={disabled}
                onClick={() => act(key('rematch'), () => rematchRawMaterial(material.id))}
              >
                {busy === key('rematch') ? t('pricing.asking') : t('pricing.askAgain')}
              </button>
            </div>
          )}
        </div>

        <div className="material-section">
          <span className="material-label">{t('pricing.currentPrice')}</span>
          <span className="amount-cell">{formatAmount(material.currentPrice, material.currency)}</span>
          <small>{t('pricing.since', { date: formatDate(material.currentPriceDate) })}</small>
        </div>

        <div className="material-section">
          <span className="material-label">{t('pricing.proposedPrice')}</span>
          {proposal ? (
            <>
              <span className="amount-cell">
                {formatAmount(proposal.proposedPrice, material.currency)}{' '}
                <span className={proposal.change >= 0 ? 'change-up' : 'change-down'}>{percent(proposal.change)}</span>
              </span>
              <small>
                {t('pricing.indexMove', {
                  from: proposal.indexFrom.toFixed(1),
                  to: proposal.indexTo.toFixed(1),
                  period: proposal.indexPeriod,
                  change: percent(proposal.indexTo / proposal.indexFrom - 1)
                })}
              </small>
              <small>
                {t('pricing.fxMove', {
                  from: formatAmount(proposal.fxFrom, material.currency),
                  to: formatAmount(proposal.fxTo, material.currency),
                  change: percent(proposal.fxTo / proposal.fxFrom - 1)
                })}
              </small>
              <div className="material-actions">
                <button className="button-primary" type="button" disabled={disabled} onClick={() => act(key('approve'), () => approvePriceProposal(proposal.id))}>
                  {t('pricing.approve')}
                </button>
                <button className="button-secondary" type="button" disabled={disabled} onClick={() => act(key('reject'), () => rejectPriceProposal(proposal.id))}>
                  {t('pricing.reject')}
                </button>
              </div>
            </>
          ) : (
            <small>{material.series ? t('pricing.noProposal') : t('pricing.noProposalWithoutCategory')}</small>
          )}
        </div>
      </div>

      <div className="material-card-foot">
        <button className="material-link" type="button" disabled={disabled} onClick={() => setRenaming(true)}>
          {t('pricing.rename')}
        </button>
        <button
          className="material-link"
          type="button"
          disabled={disabled}
          onClick={() => {
            if (window.confirm(t('pricing.deleteConfirm', { name: material.name }))) {
              void act(key('delete'), async () => {
                await deleteRawMaterial(material.id);
                onDeleted();
              });
            }
          }}
        >
          {t('pricing.delete')}
        </button>
      </div>
    </div>
  );
}
