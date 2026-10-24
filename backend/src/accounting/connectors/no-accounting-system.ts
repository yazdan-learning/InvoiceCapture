import { AccountingConnector, SentInvoice } from '../ports';

/** No accounting system connected: "sending" only records that the invoice is done. */
export class NoAccountingSystem implements AccountingConnector {
  async send(): Promise<SentInvoice> {
    return { reference: null };
  }
}
