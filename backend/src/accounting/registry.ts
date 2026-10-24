import { env } from '../config/env';
import { AccountingConnector } from './ports';
import { NoAccountingSystem } from './connectors/no-accounting-system';
import { AsrConnector } from './connectors/asr';

// The one place that knows which accounting systems can be connected. Adding
// one (e.g. a client's API) = an adapter in ./connectors plus one entry here.
export const ACCOUNTING_CONNECTOR_IDS = ['NONE', 'ASR'] as const;
export type AccountingConnectorId = (typeof ACCOUNTING_CONNECTOR_IDS)[number];

export const ACCOUNTING_CONNECTOR_NAMES: Record<AccountingConnectorId, string> = {
  NONE: 'None',
  ASR: 'ASR'
};

const CONNECTORS: Record<AccountingConnectorId, () => AccountingConnector> = {
  NONE: () => new NoAccountingSystem(),
  ASR: () => new AsrConnector(env.accounting.asr)
};

/** Unknown ids throw: falling back to "none" would mark invoices as sent that never were. */
export function getAccountingConnector(id: string): AccountingConnector {
  const create = CONNECTORS[id as AccountingConnectorId];
  if (!create) throw new Error(`Unknown accounting connector "${id}"`);
  return create();
}
