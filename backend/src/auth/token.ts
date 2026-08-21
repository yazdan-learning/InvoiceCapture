import jwt from 'jsonwebtoken';
import { Role } from '@prisma/client';

export type TokenPayload = {
  userId: string;
  organizationId: string;
  role: Role;
};

// Stateless on purpose: the payload carries everything requireAuth needs, so
// verifying a request never costs a DB round trip. No refresh-token flow yet —
// v1 stays out until real session revocation is needed.
export function signToken(payload: TokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

export function verifyToken(token: string, secret: string): TokenPayload {
  return jwt.verify(token, secret) as TokenPayload;
}
