import { FormEvent, useEffect, useState } from 'react';
import { createUser, getUsers } from '../api';
import { Role, UserSummary } from '../types';
import { useTranslation } from '../i18n/LanguageContext';

type FormState = {
  name: string;
  email: string;
  password: string;
  role: Role;
  managerId: string;
};

const EMPTY_FORM: FormState = { name: '', email: '', password: '', role: 'EMPLOYEE', managerId: '' };

export function AdminUsersPage() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getUsers()
      .then(setUsers)
      .catch((err) => setError(err instanceof Error ? err.message : t('adminUsers.loadFailed')))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const usersById = new Map(users.map((u) => [u.id, u]));
  // Only users who can actually be routed to as an approver — matches the
  // backend guard in expenses.service.ts submitForApproval.
  const possibleManagers = users.filter((u) => u.role !== 'EMPLOYEE');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await createUser({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        managerId: form.managerId || null
      });
      setSuccessMessage(t('adminUsers.userAdded', { name: form.name }));
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('adminUsers.createFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="list-page">
      <div className="page-heading">
        <h2>{t('adminUsers.title')}</h2>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      )}
      {successMessage && (
        <div className="alert alert-success">
          <span>{successMessage}</span>
        </div>
      )}

      <div className="review-form">
        <h3 style={{ marginBottom: 12 }}>{t('adminUsers.addUser')}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <label className="form-field">
              <span>{t('adminUsers.name')}</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="form-field">
              <span>{t('adminUsers.email')}</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </label>
            <label className="form-field">
              <span>{t('adminUsers.password')}</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                minLength={8}
                required
              />
            </label>
            <label className="form-field">
              <span>{t('adminUsers.role')}</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="EMPLOYEE">{t('adminUsers.roleEmployee')}</option>
                <option value="APPROVER">{t('adminUsers.roleApprover')}</option>
                <option value="ADMIN">{t('adminUsers.roleAdmin')}</option>
              </select>
            </label>
            <label className="form-field">
              <span>{t('adminUsers.manager')}</span>
              <select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
                <option value="">{t('adminUsers.noManager')}</option>
                {possibleManagers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="action-bar">
            <button className="button-primary" type="submit" disabled={creating}>
              {creating ? t('adminUsers.adding') : t('adminUsers.addUserButton')}
            </button>
          </div>
        </form>
      </div>

      {loading ? (
        <div className="list-loading">{t('adminUsers.loading')}</div>
      ) : (
        <div className="invoice-table-wrap">
          <table className="invoice-table">
            <thead>
              <tr>
                <th>{t('adminUsers.name')}</th>
                <th>{t('adminUsers.email')}</th>
                <th>{t('adminUsers.role')}</th>
                <th>{t('adminUsers.reportsTo')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.managerId ? usersById.get(u.managerId)?.name ?? '—' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
