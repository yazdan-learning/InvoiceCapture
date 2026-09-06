import { Link } from 'react-router-dom';
import { IconCar, IconUpload } from '../components/icons';
import { useTranslation } from '../i18n/LanguageContext';

export function AddExpensePage() {
  const { t } = useTranslation();
  return (
    <div className="expense-type-chooser">
      <Link to="/upload/receipt" className="expense-type-card">
        <div className="expense-type-card-icon">
          <IconUpload />
        </div>
        <h3>{t('addExpense.uploadReceiptTitle')}</h3>
        <p>{t('addExpense.uploadReceiptDesc')}</p>
      </Link>

      <Link to="/upload/mileage" className="expense-type-card">
        <div className="expense-type-card-icon">
          <IconCar />
        </div>
        <h3>{t('addExpense.logMileageTitle')}</h3>
        <p>{t('addExpense.logMileageDesc')}</p>
      </Link>
    </div>
  );
}
