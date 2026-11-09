import { useLocation } from 'react-router-dom';
import type { TemplateLearned } from '../api';
import { useTranslation } from '../i18n/LanguageContext';

/** Where a page was opened from right after a send: what the invoice taught the vendor's template. */
export type TemplateNoteState = { templateLearned?: TemplateLearned };

// After an invoice is sent (or an expense submitted), the next page says that
// the vendor's template was created or updated: its next invoice gets its boxes from it.
export function TemplateNote() {
  const text = useTemplateNoteText();
  if (!text) return null;
  return (
    <div className="alert alert-success" role="status">
      <span>{text}</span>
    </div>
  );
}

/** The same note as text (null: nothing was just learned), for pages that show it elsewhere (the review page's header line). */
export function useTemplateNoteText(): string | null {
  const { t } = useTranslation();
  const learned = (useLocation().state as TemplateNoteState | null)?.templateLearned;
  if (!learned) return null;
  return t(learned.created ? 'review.templateCreated' : 'review.templateUpdated', { vendor: learned.vendorName?.trim() || t('review.untitled') });
}
