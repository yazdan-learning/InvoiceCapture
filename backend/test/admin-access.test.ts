import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { signToken } from '../src/auth/token';

// Role checks run before any database access, so these need no database.
const tokenFor = (role: 'EMPLOYEE' | 'APPROVER' | 'ACCOUNTANT' | 'ADMIN') =>
  `Bearer ${signToken({ userId: 'u1', organizationId: 'o1', role }, 'test-secret')}`;

const adminOnly: [string, string][] = [
  ['get', '/api/organization/settings'],
  ['patch', '/api/organization/settings'],
  ['get', '/api/auth/users'],
  ['post', '/api/auth/users'],
  ['patch', '/api/auth/users/u2'],
  ['delete', '/api/auth/users/u2']
];

describe('admin-only routes', () => {
  it.each(adminOnly)('%s %s refuses employees, approvers and accountants', async (method, path) => {
    for (const role of ['EMPLOYEE', 'APPROVER', 'ACCOUNTANT'] as const) {
      const response = await request(app)[method as 'get'](path).set('Authorization', tokenFor(role)).send({});
      expect(response.status).toBe(403);
    }
  });

  it.each(adminOnly)('%s %s refuses anonymous requests', async (method, path) => {
    expect((await request(app)[method as 'get'](path)).status).toBe(401);
  });

  it('lets an admin through to validation', async () => {
    const response = await request(app).patch('/api/organization/settings').set('Authorization', tokenFor('ADMIN')).send({ country: 'XX' });
    expect(response.status).toBe(400);
  });

  it('refuses switching off every module', async () => {
    const response = await request(app).patch('/api/organization/settings').set('Authorization', tokenFor('ADMIN')).send({ modules: [] });
    expect(response.status).toBe(400);
  });

  it('keeps the approval queue from accountants', async () => {
    const response = await request(app).get('/api/expenses/approvals/queue').set('Authorization', tokenFor('ACCOUNTANT'));
    expect(response.status).toBe(403);
  });
});
