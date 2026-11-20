import { client } from './client';

export interface LedgerEntry {
  id: string;
  amount: number;
  type: string;
  description: string;
  date: string;
}

export interface CustomerLedger {
  balance: number | null;
  entries: LedgerEntry[];
}
export type LedgerPaymentMethod = 'cash' | 'transfer' | 'mixed';

type Raw = Record<string, any>;

function unwrap(payload: unknown): { root: Raw; entries: Raw[] } {
  if (Array.isArray(payload)) return { root: {}, entries: payload as Raw[] };
  if (!payload || typeof payload !== 'object') return { root: {}, entries: [] };
  const root = payload as Raw;
  for (const key of ['items', 'content', 'entries', 'movements', 'ledger', 'data']) {
    if (Array.isArray(root[key])) return { root, entries: root[key] };
    if (root[key] && typeof root[key] === 'object' && !Array.isArray(root[key])) {
      const nested = root[key] as Raw;
      for (const nestedKey of ['items', 'content', 'entries', 'movements']) {
        if (Array.isArray(nested[nestedKey])) return { root: nested, entries: nested[nestedKey] };
      }
    }
  }
  if ('amount' in root || 'balance' in root || 'currentBalance' in root) return { root, entries: [root] };
  return { root, entries: [] };
}

function toEntry(item: Raw): LedgerEntry {
  const rawType = String(item.type ?? item.entryType ?? item.operation ?? 'MOVEMENT').toUpperCase();
  const typeLabels: Record<string, string> = { CHARGE: 'Cargo', PAYMENT: 'Pago', ADJUSTMENT: 'Ajuste', MOVEMENT: 'Movimiento' };
  const rawDescription = String(item.description ?? item.concept ?? '');
  const localizedDescription = rawDescription.replace(/ADJUSTMENT/gi, 'Ajuste').replace(/CHARGE/gi, 'Cargo').replace(/PAYMENT/gi, 'Pago');
  const description = typeLabels[rawDescription.replace(/\*/g, '').toUpperCase()] ?? typeLabels[rawType] ?? (localizedDescription || 'Movimiento de cuenta');
  return {
    id: String(item.id ?? item.entryId ?? item.ledgerId ?? `${item.createdAt ?? item.date ?? ''}-${item.amount ?? 0}`),
    amount: Number(item.amount ?? item.value ?? 0),
    type: typeLabels[rawType] ?? 'Movimiento',
    description,
    date: String(item.createdAt ?? item.date ?? item.timestamp ?? ''),
  };
}

export const ledgerService = {
  async getCustomerLedger(customerId: string): Promise<CustomerLedger> {
    const response = await client.get<unknown>(`/customers/${customerId}/ledger`);
    const { root, entries } = unwrap(response.data);
    const balanceValue = root.balance ?? root.currentBalance ?? root.totalBalance ?? root.debt;
    const calculatedBalance = entries.reduce((sum, entry) => sum + Number(entry.amount ?? entry.value ?? 0), 0);
    return {
      balance: balanceValue == null ? calculatedBalance : Number(balanceValue),
      entries: entries.map(toEntry),
    };
  },

  async registerPayment(customerId: string, amount: number, _paymentMethod?: LedgerPaymentMethod): Promise<void> {
    // LedgerEntryRequest only accepts `amount`; payment method is stored on delivered orders.
    await client.post(`/customers/${customerId}/ledger/payments`, { amount });
  },
};
