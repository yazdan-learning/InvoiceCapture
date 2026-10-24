import { describe, expect, it } from 'vitest';
import { formatAmount, formatQuantity, groupDigits, stripGrouping, toAmountInput } from './money';

describe('money formatting', () => {
  it('uses comma separators and the currency decimals', () => {
    expect(formatAmount('1250000.00', 'IRR')).toBe('1,250,000 IRR');
    expect(formatAmount('1234.5', 'EUR')).toBe('1,234.50 EUR');
    expect(formatAmount(1234.5, 'EUR', { withCode: false })).toBe('1,234.50');
    expect(formatAmount(null, 'EUR')).toBe('—');
  });

  it('keeps unknown units and missing currencies at two decimals', () => {
    expect(formatAmount('1000', 'IRT')).toBe('1,000.00 IRT');
    expect(formatAmount('1000', null)).toBe('1,000.00');
  });

  it('shows quantities without forced decimals', () => {
    expect(formatQuantity('2.000')).toBe('2');
    expect(formatQuantity('1200.5')).toBe('1,200.5');
  });

  it('groups and ungroups what is typed into an amount field', () => {
    expect(groupDigits('1250000.5')).toBe('1,250,000.5');
    expect(groupDigits('1250.')).toBe('1,250.');
    expect(groupDigits('-1000')).toBe('-1,000');
    expect(stripGrouping('1,250,000.5')).toBe('1250000.5');
    expect(stripGrouping('1 250 000')).toBe('1250000');
    expect(stripGrouping('1.2.3')).toBe('1.23');
    expect(toAmountInput('1250000.00')).toBe('1250000');
  });
});
