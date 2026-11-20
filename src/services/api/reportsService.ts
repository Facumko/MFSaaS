import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { client } from './client';

type RawReport = Record<string, unknown>;

function unwrapReportList(payload: unknown): RawReport[] {
  if (Array.isArray(payload)) return payload as RawReport[];
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as RawReport;
  for (const key of ['items', 'content', 'data', 'reports', 'sales', 'salesHistory', 'deliveries', 'attempts', 'history', 'movements', 'results']) {
    if (Array.isArray(root[key])) return root[key] as RawReport[];
    if (root[key] && typeof root[key] === 'object') {
      const nested = unwrapReportList(root[key]);
      if (nested.length) return nested;
    }
  }
  return Object.keys(root).some(key => ['salesAmount', 'totalSales', 'totalRevenue', 'totalAmount', 'amount', 'revenue', 'revenueAmount', 'grossSales', 'total'].includes(key)) ? [root] : [];
}

function toSalesPeriod(item: RawReport, index: number): SalesPeriodReport {
  return {
    period: String(item.period ?? item.date ?? item.deliveryDate ?? item.month ?? item.year ?? index),
    orderCount: Number(item.orderCount ?? item.ordersCount ?? item.totalOrders ?? item.orders ?? 0),
    salesAmount: Number(item.salesAmount ?? item.totalSales ?? item.totalRevenue ?? item.totalAmount ?? item.amount ?? item.total ?? item.revenueAmount ?? item.grossSales ?? item.revenue ?? 0),
  };
}

export type ReportGroupBy = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR' | 'CUSTOM';

export interface SalesPeriodReport {
  period: string;
  orderCount: number;
  salesAmount: number;
}

export interface TopSellingProductReport {
  productId: number;
  productName: string;
  quantitySold: number;
  salesAmount: number;
}

export interface EmployeePerformanceReport {
  employeeId: number;
  employeeName: string;
  role: string;
  orderCount: number;
  salesAmount: number;
  deliveriesCompleted: number;
}

export interface HistoryOrderItem {
  productId: number;
  productName: string;
  productUnit: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface DeliveryHistoryItem {
  orderId: number;
  orderCode: string;
  customerId: number;
  customerBusinessName: string;
  deliveryAddressSnapshot: string;
  deliveryDate: string;
  deliveredAt?: string;
  truckId: number;
  truckLicensePlate: string;
  driverId: number;
  driverName: string;
  status: string;
  items: HistoryOrderItem[];
}

export interface SalesHistoryItem {
  orderId: number;
  orderCode: string;
  deliveredAt?: string;
  deliveredById?: number;
  deliveredByName?: string;
  status: string;
  paymentMethod?: string;
  cashAmount: number;
  transferAmount: number;
  totalAmount: number;
  amountPaid: number;
  pendingBalance: number;
  items: HistoryOrderItem[];
}

export interface DeliveryAttemptItem {
  id: number;
  orderId: number;
  attemptNumber: number;
  status: 'IN_PROGRESS' | 'FAILED' | 'DELIVERED' | string;
  failureReason?: string;
  deliveryDate?: string;
  attemptedAt: string;
  completedAt?: string;
  recordedById?: number;
  recordedByName?: string;
}

const historyItems = (payload: unknown): HistoryOrderItem[] => {
  if (!Array.isArray(payload)) return [];
  return payload.map((raw: RawReport) => ({
    productId: Number(raw.productId ?? 0),
    productName: String(raw.productName ?? 'Producto'),
    productUnit: String(raw.productUnit ?? raw.unit ?? 'unidad'),
    quantity: Number(raw.quantity ?? 0),
    unitPrice: Number(raw.unitPrice ?? raw.price ?? 0),
    subtotal: Number(raw.subtotal ?? (Number(raw.quantity ?? 0) * Number(raw.unitPrice ?? raw.price ?? 0))),
  }));
};

const toDeliveryHistoryItem = (raw: RawReport): DeliveryHistoryItem => ({
  orderId: Number(raw.orderId ?? raw.id ?? 0),
  orderCode: String(raw.orderCode ?? raw.code ?? raw.orderId ?? 'Pedido'),
  customerId: Number(raw.customerId ?? 0),
  customerBusinessName: String(raw.customerBusinessName ?? raw.customerName ?? 'Cliente'),
  deliveryAddressSnapshot: String(raw.deliveryAddressSnapshot ?? raw.deliveryAddress ?? ''),
  deliveryDate: String(raw.deliveryDate ?? ''),
  deliveredAt: String(raw.deliveredAt ?? '') || undefined,
  truckId: Number(raw.truckId ?? 0),
  truckLicensePlate: String(raw.truckLicensePlate ?? ''),
  driverId: Number(raw.driverId ?? raw.deliveredById ?? 0),
  driverName: String(raw.driverName ?? raw.deliveredByName ?? 'Repartidor'),
  status: String(raw.status ?? '').toUpperCase(),
  items: historyItems(raw.items),
});

const toSalesHistoryItem = (raw: RawReport): SalesHistoryItem => ({
  orderId: Number(raw.orderId ?? 0),
  orderCode: String(raw.orderCode ?? raw.orderId ?? 'Pedido'),
  deliveredAt: String(raw.deliveredAt ?? '') || undefined,
  deliveredById: raw.deliveredById == null ? undefined : Number(raw.deliveredById),
  deliveredByName: String(raw.deliveredByName ?? '') || undefined,
  status: String(raw.status ?? '').toUpperCase(),
  paymentMethod: String(raw.paymentMethod ?? '') || undefined,
  cashAmount: Number(raw.cashAmount ?? 0),
  transferAmount: Number(raw.transferAmount ?? 0),
  totalAmount: Number(raw.totalAmount ?? raw.total ?? 0),
  amountPaid: Number(raw.amountPaid ?? 0),
  pendingBalance: Number(raw.pendingBalance ?? 0),
  items: historyItems(raw.items),
});

const toDeliveryAttempt = (raw: RawReport): DeliveryAttemptItem => ({
  id: Number(raw.id ?? 0),
  orderId: Number(raw.orderId ?? 0),
  attemptNumber: Number(raw.attemptNumber ?? 0),
  status: String(raw.status ?? '').toUpperCase(),
  failureReason: String(raw.failureReason ?? '') || undefined,
  deliveryDate: String(raw.deliveryDate ?? '') || undefined,
  attemptedAt: String(raw.attemptedAt ?? ''),
  completedAt: String(raw.completedAt ?? '') || undefined,
  recordedById: raw.recordedById == null ? undefined : Number(raw.recordedById),
  recordedByName: String(raw.recordedByName ?? '') || undefined,
});

export interface ReportPeriodParams { fromDate: string; toDate: string }

export const reportsService = {
  async getSales(params: ReportPeriodParams & { groupBy: ReportGroupBy }): Promise<SalesPeriodReport[]> {
    const response = await client.get<SalesPeriodReport[]>('/reports/sales', { params });
    return unwrapReportList(response.data).map(toSalesPeriod);
  },

  async getTopSellingProducts(params: ReportPeriodParams & { limit?: number }): Promise<TopSellingProductReport[]> {
    const response = await client.get<TopSellingProductReport[]>('/reports/products/top-selling', { params });
    return response.data;
  },

  async getEmployeePerformance(params: ReportPeriodParams & { role?: string }): Promise<EmployeePerformanceReport[]> {
    const response = await client.get<EmployeePerformanceReport[]>('/reports/employees/performance', { params });
    return response.data;
  },

  async getDeliveryHistory(params: ReportPeriodParams): Promise<DeliveryHistoryItem[]> {
    const response = await client.get<unknown>('/orders/deliveries', { params });
    return unwrapReportList(response.data).map(toDeliveryHistoryItem);
  },

  async getSalesHistory(params: ReportPeriodParams & { dateType?: 'CREATED' | 'DELIVERED' | 'PAID'; userId?: number }): Promise<SalesHistoryItem[]> {
    const response = await client.get<unknown>('/orders/sales-history', { params });
    return unwrapReportList(response.data).map(toSalesHistoryItem);
  },

  async getDeliveryAttempts(orderId: string | number): Promise<DeliveryAttemptItem[]> {
    const response = await client.get<unknown>(`/orders/${orderId}/delivery-attempts`);
    return unwrapReportList(response.data).map(toDeliveryAttempt);
  },

  async exportPdf(path: string, filename: string, params: Record<string, string | number | undefined>): Promise<void> {
    const response = await client.get<ArrayBuffer>(path, { params, responseType: 'arraybuffer' });
    const bytes = new Uint8Array(response.data);

    if (Platform.OS === 'web') {
      const pdfBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    const file = new File(Paths.cache, filename);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    if (!(await Sharing.isAvailableAsync())) throw new Error('No se puede compartir archivos en este dispositivo.');
    await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
  },
};
