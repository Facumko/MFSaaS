import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { FormErrorBanner } from '../../../components/ui/FormErrorBanner';
import { DatePickerCalendar } from '../../../components/ui/DatePickerCalendar';
import { PaginationControls, pageItems } from '../../../components/ui/PaginationControls';
import { logisticsService, Truck } from '../../../services/api/logisticsService';
import { clientsService } from '../../../services/api/clientsService';
import { ApiOrderStatus, OrderListItem, salesService } from '../../../services/api/salesService';
import { useAuthStore } from '../../../store/authStore';
import { colors, radius, spacing, typography } from '../../../theme';
import { parseApiError } from '../../../utils/apiErrors';
import { formatDate } from '../../../utils/formatters';

const statusLabel: Record<ApiOrderStatus, string> = { PENDING: 'Pendiente', IN_ROUTE: 'En reparto', DELIVERED: 'Entregado', CANCELLED: 'Cancelado' };
const money = (amount: number) => `$${amount.toLocaleString('es-AR')}`;

export default function AssignOrdersScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.user);
  const isDriver = user?.role === 'delivery' || /delivery|driver|chofer|repart/i.test(user?.roleName ?? '');
  useEffect(() => { if (isDriver) router.replace('/(tabs)/logistics' as any); }, [isDriver, router]);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderListItem | null>(null);
  const [localAssignments, setLocalAssignments] = useState<Record<string, string>>({});
  const [truckSearch, setTruckSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [datePicker, setDatePicker] = useState<'from' | 'to' | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [ordersPage, setOrdersPage] = useState(1);
  const [truckPage, setTruckPage] = useState(1);

  const visibleTrucks = useMemo(() => {
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
    const query = normalize(truckSearch.trim());
    if (!query) return trucks;
    return trucks.filter(truck =>
      normalize(truck.licensePlate).includes(query) ||
      normalize(truck.driverName ?? '').includes(query),
    );
  }, [truckSearch, trucks]);

  const visibleOrders = useMemo(() => {
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
    const customer = normalize(clientSearch.trim());
    return orders.filter(order => {
      const date = (order.deliveryDate ?? order.createdAt).slice(0, 10);
      const assignedId = localAssignments[order.id] ?? order.truckId;
      return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo) &&
        (!customer || normalize(order.customerName).startsWith(customer)) &&
        order.status === 'PENDING' && !assignedId;
    });
  }, [orders, localAssignments, dateFrom, dateTo, clientSearch]);
  const pageOrders = useMemo(() => pageItems(visibleOrders, ordersPage), [visibleOrders, ordersPage]);
  const pageTrucks = useMemo(() => pageItems(visibleTrucks, truckPage), [visibleTrucks, truckPage]);
  useEffect(() => setOrdersPage(1), [dateFrom, dateTo, clientSearch]);
  useEffect(() => setTruckPage(1), [truckSearch]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    if (user?.role === 'delivery') {
      setOrders([]); setTrucks([]);
      setError('Esta pantalla es para asignar pedidos. Como repartidor, consultá los pedidos asignados desde Pedidos.');
      setLoading(false);
      return;
    }
    try {
      const [orderList, truckList, firstClientPage] = await Promise.all([salesService.getOrdersWithTruckDetails(), logisticsService.getActiveTrucks(), clientsService.getClients('', 1)]);
      const clientPages = await Promise.all(Array.from({ length: Math.ceil(firstClientPage.total / 10) - 1 }, (_, index) => clientsService.getClients('', index + 2)));
      const customerNames = new Map<string, string>([firstClientPage, ...clientPages].flatMap(page => page.items).map(client => [client.id, client.businessName] as const));
      const completeOrders = orderList.map(order => ({ ...order, customerName: (order.customerName && order.customerName !== 'Cliente' ? order.customerName : customerNames.get(order.customerId ?? '') || 'Cliente sin identificar') }));
      setOrders(completeOrders); setTrucks(truckList.filter(truck => Boolean(truck.driverId || truck.driverName)));
    } catch (err) { setError(parseApiError(err, 'No se pudieron cargar pedidos y camiones.').message); }
    finally { setLoading(false); }
  }, [user?.role]);
  useEffect(() => { void load(); }, [load]);

  const assign = async (truck: Truck) => {
    if (!selectedOrder) return;
    const id = Number(selectedOrder.id);
    const truckId = Number(truck.id);
    if (!Number.isInteger(id) || id < 1 || !Number.isInteger(truckId) || truckId < 1) { setError('No se pudo identificar el pedido o el camión seleccionado. Actualizá la pantalla e intentá de nuevo.'); return; }
    setSaving(true); setError(null);
    try {
      const assignedOrderId = selectedOrder.id;
      await salesService.assignOrderToTruck(String(id), truckId);
      setLocalAssignments(current => ({ ...current, [assignedOrderId]: truck.id }));
      setOrders(current => current.filter(order => order.id !== assignedOrderId));
      setSelectedOrder(null);
      await load();
    } catch (err) { setError(parseApiError(err, 'No se pudo asignar el pedido.').message); }
    finally { setSaving(false); }
  };

  return <View style={styles.screen}>
    <View style={styles.header}><TouchableOpacity onPress={() => router.replace('/(tabs)/logistics' as any)} accessibilityLabel="Volver a camiones"><Ionicons name="chevron-back" size={24} color={colors.textPrimary} /></TouchableOpacity><View style={styles.headerTitleWrap}><Text style={styles.eyebrow}>LOGÍSTICA</Text><Text style={styles.title}>Asignar pedidos</Text></View><TouchableOpacity onPress={() => void load()}><Ionicons name="refresh" size={20} color={colors.primary} /></TouchableOpacity></View>
    <View style={styles.pageIntro}><Text style={styles.pageDescription}>Revisá los pedidos pendientes y elegí el camión de reparto.</Text></View>
    <View style={styles.historyFilters}><View style={styles.filterDates}><TouchableOpacity style={styles.dateFilterButton} onPress={() => setDatePicker('from')}><Ionicons name="calendar-outline" size={17} color={colors.primary} /><Text style={styles.dateFilterText}>{dateFrom ? `Desde ${formatDate(dateFrom)}` : 'Fecha desde'}</Text></TouchableOpacity><TouchableOpacity style={styles.dateFilterButton} onPress={() => setDatePicker('to')}><Ionicons name="calendar-outline" size={17} color={colors.primary} /><Text style={styles.dateFilterText}>{dateTo ? `Hasta ${formatDate(dateTo)}` : 'Fecha hasta'}</Text></TouchableOpacity></View><TextInput style={styles.filterInput} value={clientSearch} onChangeText={setClientSearch} placeholder="Buscar por cliente" placeholderTextColor={colors.textSecondary} maxLength={40} /></View>
    {!!error && <View style={styles.banner}><FormErrorBanner message={error} onRetry={load} /></View>}
    {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View> : <ScrollView contentContainerStyle={styles.list}>
      {pageOrders.map(order => {
        const assignedId = localAssignments[order.id] ?? order.truckId;
        const truck = trucks.find(item => item.id === assignedId);
        const canAssign = order.status === 'PENDING';
        return <View key={order.id || order.code} style={styles.card}>
          <View style={styles.orderTop}><View style={styles.orderIcon}><Ionicons name="receipt-outline" size={19} color={colors.primary} /></View><View style={styles.orderInfo}><Text style={styles.code}>{order.code}</Text><Text style={styles.customer}>{order.customerName}</Text></View><View style={styles.status}><Text style={styles.statusText}>{statusLabel[order.status] ?? order.status}</Text></View></View>
          <View style={styles.orderMeta}><Text style={styles.meta}>{order.itemCount} productos{order.deliveryDate ? ` · ${formatDate(order.deliveryDate)}` : ''}</Text><Text style={styles.total}>{money(order.total)}</Text></View>
          <View style={styles.assignmentRow}><View style={styles.assignmentCopy}><Text style={styles.assignmentLabel}>{assignedId ? 'Camión asignado' : 'Sin camión asignado'}</Text><Text style={[styles.assignmentText, assignedId && styles.assignmentSet]}>{truck ? `${truck.licensePlate}${truck.driverName ? ` · ${truck.driverName}` : ''}` : assignedId ? `Camión #${assignedId}` : 'Elegí una unidad para este pedido'}</Text></View></View>{canAssign && <TouchableOpacity style={styles.assignButton} onPress={() => { setError(null); setSelectedOrder(order); }}><Ionicons name={assignedId ? 'swap-horizontal-outline' : 'bus-outline'} size={18} color={colors.textInverse} /><Text style={styles.assignButtonText}>{assignedId ? 'Cambiar camión' : 'Asignar camión'}</Text></TouchableOpacity>}
        </View>;
      })}
      {!visibleOrders.length && <View style={styles.empty}><Ionicons name="file-tray-outline" size={30} color={colors.textSecondary} /><Text style={styles.emptyText}>{orders.length ? 'No hay pedidos que coincidan con los filtros.' : 'No hay pedidos para mostrar.'}</Text></View>}
      {!!orders.length && !trucks.length && <View style={styles.empty}><Text style={styles.emptyText}>No hay camiones activos disponibles. Activá o creá un camión para asignar pedidos.</Text></View>}
      <PaginationControls page={ordersPage} totalItems={visibleOrders.length} onPageChange={setOrdersPage} />
    </ScrollView>}
    <Modal visible={!!selectedOrder} transparent animationType="slide" onRequestClose={() => !saving && setSelectedOrder(null)}><View style={styles.modalBackdrop}><View style={styles.modal}>
      <View style={styles.modalHeader}><View><Text style={styles.modalEyebrow}>ASIGNACIÓN</Text><Text style={styles.modalTitle}>{selectedOrder?.code}</Text></View><TouchableOpacity onPress={() => setSelectedOrder(null)} disabled={saving}><Ionicons name="close" size={22} color={colors.textPrimary} /></TouchableOpacity></View>
      <Text style={styles.modalHint}>Seleccioná un camión activo</Text>
      <View style={styles.truckSearchBox}><Ionicons name="search-outline" size={18} color={colors.textSecondary} /><TextInput style={styles.truckSearchInput} value={truckSearch} onChangeText={setTruckSearch} placeholder="Buscar por patente o chofer" placeholderTextColor={colors.textSecondary} maxLength={40} autoCorrect={false} />{!!truckSearch && <TouchableOpacity onPress={() => setTruckSearch('')} accessibilityLabel="Borrar búsqueda de camiones"><Ionicons name="close-circle" size={19} color={colors.textSecondary} /></TouchableOpacity>}</View>
      <ScrollView style={styles.truckList}>{pageTrucks.map(truck => <TouchableOpacity key={truck.id} style={styles.truckOption} onPress={() => void assign(truck)} disabled={saving}><View style={styles.truckIcon}><Ionicons name="bus" size={18} color={colors.primary} /></View><View style={styles.truckOptionInfo}><Text style={styles.truckPlate}>{truck.licensePlate}</Text><Text style={styles.truckDriver}>{truck.driverName ?? (truck.driverId ? `Chofer ID ${truck.driverId}` : 'Sin chofer asignado')}</Text></View>{saving ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}</TouchableOpacity>)}{!visibleTrucks.length && <View style={styles.empty}><Text style={styles.emptyText}>No se encontraron camiones.</Text></View>}</ScrollView>
      <PaginationControls page={truckPage} totalItems={visibleTrucks.length} onPageChange={setTruckPage} />
    </View></View></Modal>
    <DatePickerCalendar visible={datePicker !== null} value={datePicker === 'from' ? dateFrom : dateTo} minDate={datePicker === 'to' ? dateFrom || undefined : undefined} title={datePicker === 'from' ? 'Fecha desde' : 'Fecha hasta'} onSelect={date => {
      if (datePicker === 'from') { setDateFrom(date); if (dateTo && dateTo < date) setDateTo(''); }
      else setDateTo(date);
    }} onClear={datePicker === 'from' ? () => setDateFrom('') : () => setDateTo('')} onClose={() => setDatePicker(null)} />
  </View>;
}

const styles = StyleSheet.create({
  pageIntro: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  pageDescription: { ...typography.body, color: colors.textSecondary },
  assignmentCopy: { flex: 1 },
  assignmentLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', marginBottom: 2 },
  historyFilters: { gap: spacing.sm, paddingHorizontal: spacing.lg }, filterDates: { flexDirection: 'row', gap: spacing.sm }, filterInput: { minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, ...typography.caption, color: colors.textPrimary }, dateFilterButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface }, dateFilterText: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  screen: { flex: 1, backgroundColor: colors.background }, header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.border }, headerTitleWrap: { flex: 1 }, eyebrow: { ...typography.caption, color: colors.primary, letterSpacing: 1 }, title: { ...typography.heading, color: colors.textPrimary }, notice: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, margin: spacing.lg, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.infoLight }, noticeText: { flex: 1, ...typography.caption, color: colors.textPrimary, lineHeight: 19 }, filters: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }, assignmentFilters: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }, filterChip: { flexGrow: 0, flexShrink: 0, alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: colors.surface }, filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, filterText: { ...typography.caption, color: colors.textSecondary }, filterTextActive: { color: colors.primary, fontWeight: '700' }, banner: { paddingHorizontal: spacing.lg }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, list: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxxl, gap: spacing.md }, card: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, orderTop: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }, orderIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.primaryLight }, orderInfo: { flex: 1 }, code: { ...typography.label, color: colors.textPrimary, fontWeight: '800' }, customer: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, status: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full, backgroundColor: colors.primaryLight }, statusText: { ...typography.caption, color: colors.primary, fontWeight: '700' }, orderMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderColor: colors.border }, meta: { ...typography.caption, color: colors.textSecondary }, total: { ...typography.label, color: colors.textPrimary }, assignmentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm }, assignmentText: { flex: 1, ...typography.caption, color: colors.textSecondary }, assignmentSet: { color: colors.success, fontWeight: '600' }, assignButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md }, assignButtonText: { ...typography.label, color: colors.textInverse, fontWeight: '700' }, empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm }, emptyText: { ...typography.body, color: colors.textSecondary, textAlign: 'center' }, modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }, modal: { backgroundColor: colors.surface, maxHeight: '78%', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg }, modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, modalEyebrow: { ...typography.caption, color: colors.primary, letterSpacing: 1 }, modalTitle: { ...typography.subheading, color: colors.textPrimary }, modalHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.sm }, truckSearchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }, truckSearchInput: { flex: 1, color: colors.textPrimary, ...typography.body }, truckList: { flexGrow: 0 }, truckOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1, borderColor: colors.border }, truckIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.primaryLight }, truckOptionInfo: { flex: 1 }, truckPlate: { ...typography.label, color: colors.textPrimary }, truckDriver: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
