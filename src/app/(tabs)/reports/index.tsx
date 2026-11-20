import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { FormErrorBanner } from '../../../components/ui/FormErrorBanner';
import { PaginationControls, pageItems } from '../../../components/ui/PaginationControls';
import { reportsService, ReportGroupBy, SalesPeriodReport, TopSellingProductReport, EmployeePerformanceReport } from '../../../services/api/reportsService';
import { salesService } from '../../../services/api/salesService';
import { usePermissions } from '../../../hooks/usePermissions';
import { colors, radius, spacing, typography } from '../../../theme';
import { parseApiError } from '../../../utils/apiErrors';
import { formatDate } from '../../../utils/formatters';

type PeriodPreset = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
type ReportKey = 'sales' | 'products' | 'employees';
const roleFilters = [
  { value: '', label: 'Todos' },
  { value: 'OWNER', label: 'Dueño' },
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'VENDEDOR', label: 'Vendedor' },
  { value: 'REPARTIDOR', label: 'Repartidor' },
];
const dateString = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const currency = (amount: number) => `$${Number(amount ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const periodLabel = (value: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDate(value);
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) return new Date(Number(month[1]), Number(month[2]) - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  return value;
};
const isDateString = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
};

function getPresetRange(preset: PeriodPreset, reference = new Date()) {
  const date = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  if (preset === 'DAY') return { fromDate: dateString(date), toDate: dateString(date) };
  if (preset === 'WEEK') {
    const monday = new Date(date);
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { fromDate: dateString(monday), toDate: dateString(sunday) };
  }
  if (preset === 'MONTH') return { fromDate: dateString(new Date(date.getFullYear(), date.getMonth(), 1)), toDate: dateString(new Date(date.getFullYear(), date.getMonth() + 1, 0)) };
  return { fromDate: dateString(new Date(date.getFullYear(), 0, 1)), toDate: dateString(new Date(date.getFullYear(), 11, 31)) };
}

export default function ReportsScreen() {
  const router = useRouter();
  const { canViewReports } = usePermissions();
  const todayRange = useMemo(() => getPresetRange('DAY'), []);
  const [preset, setPreset] = useState<PeriodPreset>('MONTH');
  const [referenceDate, setReferenceDate] = useState(() => new Date());
  const range = useMemo(() => getPresetRange(preset, referenceDate), [preset, referenceDate]);
  const [role, setRole] = useState('');
  const [sales, setSales] = useState<SalesPeriodReport[]>([]);
  const [products, setProducts] = useState<TopSellingProductReport[]>([]);
  const [employees, setEmployees] = useState<EmployeePerformanceReport[]>([]);
  const [todaySales, setTodaySales] = useState(0);
  const [pendingOrders, setPendingOrders] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ReportKey | null>(null);
  const [salesPage, setSalesPage] = useState(1);
  const [employeePage, setEmployeePage] = useState(1);

  useEffect(() => { if (!canViewReports) router.replace('/(tabs)/catalog' as any); }, [canViewReports, router]);

  const groupBy: ReportGroupBy = preset;
  const periodTitle = useMemo(() => {
    if (preset === 'DAY') return formatDate(range.fromDate);
    if (preset === 'WEEK') return `Semana del ${formatDate(range.fromDate)}`;
    if (preset === 'MONTH') return referenceDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    return String(referenceDate.getFullYear());
  }, [preset, range, referenceDate]);
  const load = useCallback(async () => {
    if (!canViewReports) return;
    if (!isDateString(range.fromDate) || !isDateString(range.toDate) || range.fromDate > range.toDate) return;
    setLoading(true);
    setError(null);
    try {
      const [salesData, productsData, employeeData, todayData, pendingData] = await Promise.all([
        reportsService.getSales({ ...range, groupBy }),
        reportsService.getTopSellingProducts({ ...range, limit: 10 }),
        reportsService.getEmployeePerformance({ ...range, role: role || undefined }),
        reportsService.getSales({ ...todayRange, groupBy: 'DAY' }),
        salesService.getOrders({ status: 'PENDING' }),
      ]);
      setSales(salesData);
      setProducts(productsData);
      setEmployees(employeeData);
      setTodaySales(todayData.reduce((sum, item) => sum + Number(item.salesAmount || 0), 0));
      setPendingOrders(pendingData.length);
    } catch (cause) {
      setError(parseApiError(cause, 'No se pudieron cargar los reportes.').message);
    } finally { setLoading(false); }
  }, [canViewReports, range, groupBy, role, todayRange]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSalesPage(1); setEmployeePage(1); }, [range, role]);
  const pageSales = useMemo(() => pageItems(sales, salesPage), [sales, salesPage]);
  const pageEmployees = useMemo(() => pageItems(employees, employeePage), [employees, employeePage]);

  const selectPreset = (value: PeriodPreset) => {
    setPreset(value);
  };

  const movePeriod = (direction: -1 | 1) => setReferenceDate(current => {
    const next = new Date(current);
    if (preset === 'DAY') next.setDate(next.getDate() + direction);
    else if (preset === 'WEEK') next.setDate(next.getDate() + direction * 7);
    else if (preset === 'MONTH') return new Date(next.getFullYear(), next.getMonth() + direction, 1);
    else return new Date(next.getFullYear() + direction, 0, 1);
    return next;
  });

  const exportReport = async (key: ReportKey) => {
    const config = key === 'sales'
      ? { path: '/reports/sales/pdf', filename: 'reporte-ventas.pdf', params: { ...range, groupBy } }
      : key === 'products'
        ? { path: '/reports/products/top-selling/pdf', filename: 'ranking-productos.pdf', params: { ...range, limit: 10 } }
        : { path: '/reports/employees/performance/pdf', filename: 'rendimiento-empleados.pdf', params: { ...range, role: role || undefined } };
    setExporting(key);
    try { await reportsService.exportPdf(config.path, config.filename, config.params); }
    catch (cause) { Alert.alert('No se pudo exportar', cause instanceof Error ? cause.message : 'Intentá nuevamente.'); }
    finally { setExporting(null); }
  };

  if (!canViewReports) return null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <View><Text style={styles.eyebrow}>ADMINISTRACIÓN</Text><Text style={styles.title}>Reportes</Text><Text style={styles.subtitle}>Ventas, productos y rendimiento del equipo</Text></View>
        <TouchableOpacity style={styles.refreshButton} onPress={() => void load()} disabled={loading} accessibilityLabel="Actualizar reportes"><Ionicons name="refresh-outline" size={21} color={colors.primary} /></TouchableOpacity>
      </View>

      {!!error && <View style={styles.errorWrap}><FormErrorBanner message={error} onRetry={() => void load()} /></View>}

      <View style={styles.metricsRow}>
        <MetricCard label="VENTAS DE HOY" value={currency(todaySales)} loading={loading} />
        <MetricCard label="PEDIDOS PENDIENTES" value={String(pendingOrders)} loading={loading} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Período</Text>
        <View style={styles.presetRow}>
          {([['DAY', 'Día'], ['WEEK', 'Semana'], ['MONTH', 'Mes'], ['YEAR', 'Año']] as [PeriodPreset, string][]).map(([value, label]) => <TouchableOpacity key={value} onPress={() => selectPreset(value)} style={[styles.presetChip, preset === value && styles.presetChipActive]}><Text style={[styles.presetText, preset === value && styles.presetTextActive]}>{label}</Text></TouchableOpacity>)}
        </View>
        <View style={styles.periodNavigator}><TouchableOpacity style={styles.periodArrow} onPress={() => movePeriod(-1)} accessibilityLabel="Período anterior"><Ionicons name="chevron-back" size={20} color={colors.primary} /></TouchableOpacity><Text style={styles.periodTitle}>{periodTitle}</Text><TouchableOpacity style={styles.periodArrow} onPress={() => movePeriod(1)} accessibilityLabel="Período siguiente"><Ionicons name="chevron-forward" size={20} color={colors.primary} /></TouchableOpacity></View>
      </View>

      <ReportCard title="Ventas" subtitle="Pedidos entregados e importe vendido" icon="bar-chart-outline" exporting={exporting === 'sales'} onExport={() => void exportReport('sales')}>
        {loading ? <SectionLoading /> : sales.length ? pageSales.map(row => <DataRow key={row.period} title={periodLabel(row.period)} detail={`${row.orderCount} ${Number(row.orderCount) === 1 ? 'pedido' : 'pedidos'}`} value={currency(row.salesAmount)} />) : <EmptyState text="No hay ventas para este período." />}<PaginationControls page={salesPage} totalItems={sales.length} onPageChange={setSalesPage} />
      </ReportCard>

      <ReportCard title="Productos más vendidos" subtitle="Ranking por unidades e importe" icon="trophy-outline" exporting={exporting === 'products'} onExport={() => void exportReport('products')}>
        {loading ? <SectionLoading /> : products.length ? products.map((row, index) => <DataRow key={row.productId} title={`${index + 1}. ${row.productName}`} detail={`${row.quantitySold} unidades`} value={currency(row.salesAmount)} />) : <EmptyState text="No hay productos vendidos para este período." />}
      </ReportCard>

      <ReportCard title="Rendimiento por empleado" subtitle="Pedidos, ventas y entregas realizadas" icon="people-outline" exporting={exporting === 'employees'} onExport={() => void exportReport('employees')}>
        <View style={styles.roleFilters}>{roleFilters.map(option => <TouchableOpacity key={option.value || 'all'} onPress={() => setRole(option.value)} style={[styles.roleChip, role === option.value && styles.roleChipActive]}><Text style={[styles.roleText, role === option.value && styles.roleTextActive]}>{option.label}</Text></TouchableOpacity>)}</View>
        {loading ? <SectionLoading /> : employees.length ? pageEmployees.map(row => <DataRow key={row.employeeId} title={row.employeeName} detail={`${row.role} · ${row.orderCount} pedidos · ${row.deliveriesCompleted} entregas`} value={currency(row.salesAmount)} />) : <EmptyState text="No hay actividad de empleados para este período." />}<PaginationControls page={employeePage} totalItems={employees.length} onPageChange={setEmployeePage} />
      </ReportCard>
      <Text style={styles.footerNote}>Los reportes se calculan a partir de los pedidos entregados.</Text>
    </ScrollView>
  );
}

function MetricCard({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return <View style={styles.metricCard}><Text style={styles.metricLabel}>{label}</Text>{loading ? <ActivityIndicator color={colors.primary} size="small" style={{ alignSelf: 'flex-start', marginTop: spacing.md }} /> : <Text style={styles.metricValue}>{value}</Text>}<View style={styles.metricRule} /></View>;
}

function ReportCard({ title, subtitle, icon, exporting, onExport, children }: { title: string; subtitle: string; icon: React.ComponentProps<typeof Ionicons>['name']; exporting: boolean; onExport: () => void; children: React.ReactNode }) {
  return <View style={styles.card}><View style={styles.reportHeader}><View style={styles.reportIcon}><Ionicons name={icon} size={20} color={colors.primary} /></View><View style={styles.reportTitleWrap}><Text style={styles.cardTitle}>{title}</Text><Text style={styles.reportSubtitle}>{subtitle}</Text></View><TouchableOpacity style={styles.exportButton} onPress={onExport} disabled={exporting}><Ionicons name="download-outline" size={17} color={colors.primary} />{exporting ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.exportText}>PDF</Text>}</TouchableOpacity></View>{children}</View>;
}

function DataRow({ title, detail, value }: { title: string; detail: string; value: string }) {
  return <View style={styles.dataRow}><View style={styles.dataCopy}><Text style={styles.dataTitle}>{title}</Text><Text style={styles.dataDetail}>{detail}</Text></View><Text style={styles.dataValue}>{value}</Text></View>;
}

function SectionLoading() { return <ActivityIndicator color={colors.primary} style={styles.sectionLoader} />; }
function EmptyState({ text }: { text: string }) { return <Text style={styles.emptyText}>{text}</Text>; }

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  eyebrow: { ...typography.caption, color: colors.primary, fontWeight: '800', letterSpacing: 1.3 },
  title: { ...typography.heading, color: colors.textPrimary, marginTop: 3 },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  refreshButton: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  errorWrap: { marginBottom: spacing.md },
  metricsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  metricCard: { flex: 1, minHeight: 112, justifyContent: 'space-between', padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  metricLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', letterSpacing: 0.7 },
  metricValue: { ...typography.heading, color: colors.textPrimary, fontWeight: '700', marginTop: spacing.md },
  metricRule: { height: 2, width: 34, marginTop: spacing.md, borderRadius: 1, backgroundColor: colors.primary },
  card: { padding: spacing.md, marginBottom: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  cardTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '800' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.md },
  presetChip: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full },
  presetChipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  presetText: { ...typography.caption, color: colors.textSecondary },
  presetTextActive: { color: colors.primary, fontWeight: '700' },
  periodNavigator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.background },
  periodArrow: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.surface },
  periodTitle: { ...typography.subheading, color: colors.textPrimary, textTransform: 'capitalize' },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  reportIcon: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  reportTitleWrap: { flex: 1 },
  reportSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  exportButton: { minWidth: 54, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  exportText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  dataRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  dataCopy: { flex: 1 },
  dataTitle: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  dataDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2, fontSize: 11 },
  dataValue: { ...typography.caption, color: colors.textPrimary, fontWeight: '800' },
  roleFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  roleChip: { paddingHorizontal: spacing.sm, paddingVertical: 5, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full },
  roleChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  roleText: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
  roleTextActive: { color: colors.primary, fontWeight: '700' },
  sectionLoader: { paddingVertical: spacing.lg },
  emptyText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.md },
  footerNote: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
});
