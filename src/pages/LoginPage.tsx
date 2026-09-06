import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useTranslation } from '../i18n/LanguageContext';

export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) {
    const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={redirectTo} replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-card">
      <h2>{t('login.title')}</h2>
      <p className="login-subtitle">{t('login.subtitle')}</p>
      <form onSubmit={handleSubmit} className="login-form">
        <label className="form-field">
          <span>{t('login.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="username"
          />
        </label>
        <label className="form-field">
          <span>{t('login.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>

        {error && (
          <div className="alert alert-error">
            <span>{error}</span>
          </div>
        )}

        <button className="button-primary login-submit" type="submit" disabled={submitting}>
          {submitting ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
    </div>
  );
}
