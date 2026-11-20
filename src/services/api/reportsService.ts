import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { client } from './client';

type RawReport = Record<string, unknown>;

function unwrapReportList(payload: unknown): RawReport[] {
  if (Array.isArray(payload)) return payload as RawReport[];
  if (!payload || typeof payload !== 'object') return [];
  const root = payload as RawReport;
  for (const key of ['items', 'content', 'data', 'reports', 'sales', 'results']) {
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
