const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const dateTimeFormatter = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Formatea número como moneda argentina: 12500 → "$12.500" */
export function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString('es-AR')}`;
}

/** Formatea fecha ISO a formato legible: "15 jun 2026" */
export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

/** Formatea fecha ISO con hora: "15 jun 2026 · 14:30" */
export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso)).replace(',', ' ·');
}

/** Tiempo relativo: "hace 2 horas" */
export function fromNow(iso: string): string {
  const elapsedSeconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year'],
  ];
  let value = elapsedSeconds;
  for (const [limit, unit] of units) {
    if (Math.abs(value) < limit) {
      return new Intl.RelativeTimeFormat('es', { numeric: 'auto' }).format(Math.round(value), unit);
    }
    value /= limit;
  }
  return '';
}

/** Formatea CUIT con guiones: "20123456781" → "20-12345678-1" */
export function formatCuit(cuit: string): string {
  const clean = cuit.replace(/\D/g, '');
  if (clean.length !== 11) return cuit;
  return `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10)}`;
}

/** Capitaliza primera letra */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
