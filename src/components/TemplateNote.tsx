import { useLocation } from 'react-router-dom';
import type { TemplateLearned } from '../api';
import { useTranslation } from '../i18n/LanguageContext';

/** Where a page was opened from right after a send: what the invoice taught the vendor's template. */
export type TemplateNoteState = { templateLearned?: TemplateLearned };

// After an invoice is sent (or an expense submitted), the next page says that
// the vendor's template was created or updated: its next invoice gets its boxes from it.
export function TemplateNote() {
  const { t } = useTranslation();
  const learned = (useLocation().state as TemplateNoteState | null)?.templateLearned;
  if (!learned) return null;
  const vendor = learned.vendorName?.trim() || t('review.untitled');
  return (
    <div className="alert alert-success" role="status">
      <span>{t(learned.created ? 'review.templateCreated' : 'review.templateUpdated', { vendor })}</span>
    </div>
  );
}
