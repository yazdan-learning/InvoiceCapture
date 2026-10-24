import { Link, Navigate } from 'react-router-dom';
import { IconCar, IconInvoice, IconUpload } from '../components/icons';
import { useTranslation } from '../i18n/LanguageContext';
import { useAuth } from '../auth/AuthContext';
import { useModules } from '../workspace/ModulesContext';
import { seesPurchaseInvoices } from '../workspace/navigation';

export function AddExpensePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { modules } = useModules();
  const invoices = Boolean(user && seesPurchaseInvoices(user.role, modules));

  // Without the expenses module the only thing to add is a purchase invoice.
  if (!modules.includes('EXPENSES')) return <Navigate to={invoices ? '/invoices/upload' : '/'} replace />;

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

      {invoices && (
        <Link to="/invoices/upload" className="expense-type-card">
          <div className="expense-type-card-icon">
            <IconInvoice />
          </div>
          <h3>{t('addExpense.purchaseInvoiceTitle')}</h3>
          <p>{t('addExpense.purchaseInvoiceDesc')}</p>
        </Link>
      )}
    </div>
  );
}
