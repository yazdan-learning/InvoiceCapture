import { FormEvent, useEffect, useState } from 'react';
import { createUser, getUsers } from '../api';
import { Role, UserSummary } from '../types';

type FormState = {
  name: string;
  email: string;
  password: string;
  role: Role;
  managerId: string;
};

const EMPTY_FORM: FormState = { name: '', email: '', password: '', role: 'EMPLOYEE', managerId: '' };

export function AdminUsersPage() {
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
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load users'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const usersById = new Map(users.map((u) => [u.id, u]));
  // Only users who can actually be routed to as an approver — matches the
  // backend guard in invoices.service.ts submitForApproval.
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
      setSuccessMessage(`${form.name} was added.`);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="list-page">
      <div className="page-heading">
        <h2>Users</h2>
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
        <h3 style={{ marginBottom: 12 }}>Add a user</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <label className="form-field">
              <span>Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="form-field">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </label>
            <label className="form-field">
              <span>Password</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                minLength={8}
                required
              />
            </label>
            <label className="form-field">
              <span>Role</span>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                <option value="EMPLOYEE">Employee</option>
                <option value="APPROVER">Approver</option>
                <option value="ADMIN">Admin</option>
              </select>
            </label>
            <label className="form-field">
              <span>Manager (approver)</span>
              <select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })}>
                <option value="">No manager (self-certifies on submit)</option>
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
              {creating ? 'Adding…' : 'Add user'}
            </button>
          </div>
        </form>
      </div>

      {loading ? (
        <div className="list-loading">Loading users…</div>
      ) : (
        <div className="invoice-table-wrap">
          <table className="invoice-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Reports to</th>
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
