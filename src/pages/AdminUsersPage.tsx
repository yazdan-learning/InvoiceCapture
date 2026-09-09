import { FormEvent, useEffect, useState } from 'react';
import { createUser, deactivateUser, getUsers, updateUser } from '../api';
import { Role, UserSummary } from '../types';
import { useTranslation } from '../i18n/LanguageContext';
import { Select } from '../components/Select';

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
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
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
  // Only active users who can actually be routed to as an approver — matches
  // the backend guard in expenses.service.ts submitForApproval.
  const possibleManagers = users.filter((u) => u.role !== 'EMPLOYEE' && u.active);

  const startEdit = (user: UserSummary) => {
    setEditingUserId(user.id);
    setForm({ name: user.name, email: user.email, password: '', role: user.role, managerId: user.managerId ?? '' });
    setError(null);
    setSuccessMessage(null);
  };

  const cancelEdit = () => {
    setEditingUserId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      if (editingUserId) {
        await updateUser(editingUserId, {
          name: form.name,
          email: form.email,
          role: form.role,
          managerId: form.managerId || null
        });
        setSuccessMessage(t('adminUsers.userUpdated', { name: form.name }));
        setEditingUserId(null);
      } else {
        await createUser({
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          managerId: form.managerId || null
        });
        setSuccessMessage(t('adminUsers.userAdded', { name: form.name }));
      }
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('adminUsers.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (user: UserSummary) => {
    if (!window.confirm(t('adminUsers.confirmDeactivate', { name: user.name }))) return;
    setError(null);
    setSuccessMessage(null);
    try {
      await deactivateUser(user.id);
      if (editingUserId === user.id) cancelEdit();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('adminUsers.deactivateFailed'));
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
        <h3 style={{ marginBottom: 12 }}>
          {editingUserId ? t('adminUsers.editUser') : t('adminUsers.addUser')}
        </h3>
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
            {!editingUserId && (
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
            )}
            <label className="form-field">
              <span>{t('adminUsers.role')}</span>
              <Select
                value={form.role}
                onChange={(value) => setForm({ ...form, role: value as Role })}
                options={[
                  { value: 'EMPLOYEE', label: t('adminUsers.roleEmployee') },
                  { value: 'APPROVER', label: t('adminUsers.roleApprover') },
                  { value: 'ADMIN', label: t('adminUsers.roleAdmin') }
                ]}
              />
            </label>
            <label className="form-field">
              <span>{t('adminUsers.manager')}</span>
              <Select
                value={form.managerId}
                onChange={(value) => setForm({ ...form, managerId: value })}
                options={[
                  { value: '', label: t('adminUsers.noManager') },
                  ...possibleManagers
                    .filter((m) => m.id !== editingUserId)
                    .map((m) => ({ value: m.id, label: `${m.name} (${m.role})` }))
                ]}
              />
            </label>
          </div>
          <div className="action-bar">
            {editingUserId && (
              <button className="button-outline" type="button" onClick={cancelEdit} disabled={saving}>
                {t('common.cancel')}
              </button>
            )}
            <button className="button-primary" type="submit" disabled={saving}>
              {saving
                ? t('common.saving')
                : editingUserId
                  ? t('adminUsers.saveChanges')
                  : t('adminUsers.addUserButton')}
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
                <th>{t('table.status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={u.active ? undefined : { opacity: 0.5 }}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td>{u.managerId ? usersById.get(u.managerId)?.name ?? '—' : '—'}</td>
                  <td>{u.active ? t('adminUsers.active') : t('adminUsers.deactivated')}</td>
                  <td>
                    <div className="row-actions">
                      <button className="button-outline" type="button" onClick={() => startEdit(u)}>
                        {t('common.edit')}
                      </button>
                      {u.active && (
                        <button
                          className="button-outline button-danger"
                          type="button"
                          onClick={() => handleDeactivate(u)}
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
