const relativeTime = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

function dateOrOriginal(iso: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Formatea número como moneda argentina: 12500 → "$12.500" */
export function formatCurrency(amount: number): string {
  return `$${amount.toLocaleString('es-AR')}`;
}

/** Mantiene solo hasta 11 dígitos y los muestra agrupados como pesos argentinos. */
export function formatArgentineAmountInput(value: string | number): string {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 11);
  return digits ? Number(digits).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
}

/** Convierte un importe editado con separadores a su valor numérico. */
export function parseArgentineAmountInput(value: string): number {
  return Number(value.replace(/\D/g, ''));
}

/** Formatea fecha ISO al formato corto DD-MM-AA. */
export function formatDate(iso: string): string {
  const date = dateOrOriginal(iso);
  if (!date) return iso;
  return `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getFullYear()).slice(-2)}`;
}

/** Formatea fecha ISO con hora en formato DD-MM-AA · HH:mm. */
export function formatDateTime(iso: string): string {
  const date = dateOrOriginal(iso);
  if (!date) return iso;
  const datePart = formatDate(iso);
  const timePart = date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${datePart} · ${timePart}`;
}

/** Muestra campos de fecha como DD-MM-AA sin cambiar el ISO que usa la API. */
export function formatDateInput(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}-${match[2]}-${match[1].slice(-2)}` : value;
}

/** Convierte DD-MM-AA a YYYY-MM-DD para guardar y filtrar con la API. */
export function parseDateInput(value: string): string {
  const match = /^(\d{2})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const day = Number(match[1]); const month = Number(match[2]); const year = 2000 + Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return value;
  return `${year}-${match[2]}-${match[1]}`;
}

/** Tiempo relativo: "hace 2 horas" */
export function fromNow(iso: string): string {
  const date = dateOrOriginal(iso);
  if (!date) return iso;
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000], ['month', 2_592_000], ['week', 604_800],
    ['day', 86_400], ['hour', 3_600], ['minute', 60], ['second', 1],
  ];
  const [unit, duration] = units.find(([, duration]) => Math.abs(seconds) >= duration) ?? ['second', 1];
  return relativeTime.format(Math.round(seconds / duration), unit);
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
