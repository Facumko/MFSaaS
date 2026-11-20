import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FormErrorBanner } from '../../../components/ui/FormErrorBanner';
import { DatePickerCalendar } from '../../../components/ui/DatePickerCalendar';
import { PaginationControls, pageItems } from '../../../components/ui/PaginationControls';
import { clientsService } from '../../../services/api/clientsService';
import { logisticsService, Truck, TruckStockItem } from '../../../services/api/logisticsService';
import { productsService } from '../../../services/api/productsService';
import { ApiOrderStatus, DeliveryAttempt, DeliveryPaymentMethod, OrderListItem, salesService } from '../../../services/api/salesService';
import { ReceiptChannel, ReceiptData, receiptService } from '../../../services/api/receiptService';
import { ManagedUser, usersService } from '../../../services/api/usersService';
import { authService } from '../../../services/api/authService';
import { SelectField } from '../../../components/ui/SelectField';
import { useAuthStore } from '../../../store';
import { usePermissions } from '../../../hooks/usePermissions';
import { IProduct } from '../../../types';
import { colors, radius, spacing, typography } from '../../../theme';
import { parseApiError } from '../../../utils/apiErrors';
import { formatArgentineAmountInput, formatDate, formatDateTime } from '../../../utils/formatters';

type DeleteTarget = { kind: 'truck' | 'stock'; id: string; label: string } | null;
type DriverPaymentChoice = 'full' | 'account' | 'partial';
type DriverReceiptPrompt = { data: ReceiptData; email?: string; phone?: string };
const deliveryFailureReasons = ['Local cerrado', 'Cliente ausente', 'No había nadie para recibir', 'Rechazó recibir el pedido', 'Dirección incorrecta', 'Problema con el vehículo', 'Otro'];

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const orderStatusLabel: Record<ApiOrderStatus, string> = { PENDING: 'Pendiente', IN_ROUTE: 'En reparto', DELIVERED: 'Entregado', CANCELLED: 'No entregado' };
const money = (value: number) => `$${value.toLocaleString('es-AR')}`;
const latestAttemptForScheduledDate = (order: OrderListItem, attempts: DeliveryAttempt[] = []) => {
  const scheduledDate = (order.deliveryDate || today()).slice(0, 10);
  const matching = attempts
    .filter(attempt => (attempt.deliveryDate || attempt.attemptedAt.slice(0, 10) || scheduledDate) === scheduledDate)
    .sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt) || a.attemptNumber - b.attemptNumber);
  return matching[matching.length - 1];
};
const hasFailedAttemptForScheduledDate = (order: OrderListItem, attempts: DeliveryAttempt[] = []) => latestAttemptForScheduledDate(order, attempts)?.status === 'FAILED';
const isDeliveryRole = (roleName: string, roleId?: string) => /delivery|driver|chofer|repartidor/i.test(roleName) || roleId === '4';

export default function LogisticsScreen() {
  const router = useRouter();
  const user = useAuthStore(state => state.user);
  const { canViewLogistics, canManageLogistics, canAssignTruckToDriver, canLoadTruckStock, isDelivery, isDepot } = usePermissions();
  const isDriver = isDelivery;
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [truckSearch, setTruckSearch] = useState('');
  const [truckDriverFilter, setTruckDriverFilter] = useState<'all' | 'assigned' | 'unassigned'>('all');
  const [truckPage, setTruckPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [stockPage, setStockPage] = useState(1);
  const [employeePage, setEmployeePage] = useState(1);
  const [productPage, setProductPage] = useState(1);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [employees, setEmployees] = useState<ManagedUser[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [selectedTruck, setSelectedTruck] = useState<Truck | null>(null);
  const [ordersModalOpen, setOrdersModalOpen] = useState(false);
  const [truckOrders, setTruckOrders] = useState<OrderListItem[]>([]);
  const [driverDeliveryAttempts, setDriverDeliveryAttempts] = useState<Record<string, DeliveryAttempt[]>>({});
  const [driverOrderSearch, setDriverOrderSearch] = useState('');
  const [expandedDriverOrderId, setExpandedDriverOrderId] = useState<string | null>(null);
  const [driverCancelOrder, setDriverCancelOrder] = useState<OrderListItem | null>(null);
  const [driverCancelStage, setDriverCancelStage] = useState<'confirm' | 'reason'>('confirm');
  const [driverCancelReasonOption, setDriverCancelReasonOption] = useState<string | null>(null);
  const [driverCancelReasonText, setDriverCancelReasonText] = useState('');
  const [driverCancelIdempotencyKey, setDriverCancelIdempotencyKey] = useState('');
  const [driverCancellationReasons, setDriverCancellationReasons] = useState<Record<string, string>>({});
  const [driverTab, setDriverTab] = useState<'orders' | 'products'>('orders');
  const [driverStatusFilter, setDriverStatusFilter] = useState<'PENDING' | 'DELIVERED' | 'CANCELLED'>('PENDING');
  const [driverToday, setDriverToday] = useState(today());
  const [driverLoadedProductPage, setDriverLoadedProductPage] = useState(1);
  const [driverOrderBusyId, setDriverOrderBusyId] = useState<string | null>(null);
  const [driverOrderError, setDriverOrderError] = useState<string | null>(null);
  const [driverDeliveryOrder, setDriverDeliveryOrder] = useState<OrderListItem | null>(null);
  const [driverDeliveryIdempotencyKey, setDriverDeliveryIdempotencyKey] = useState('');
  const [driverPaymentChoice, setDriverPaymentChoice] = useState<DriverPaymentChoice | null>(null);
  const [driverPaymentAmount, setDriverPaymentAmount] = useState('');
  const [driverPaymentMethod, setDriverPaymentMethod] = useState<'cash' | 'transfer' | 'mixed'>('cash');
  const [driverMixedCashAmount, setDriverMixedCashAmount] = useState('');
  const [driverDeliveryError, setDriverDeliveryError] = useState<string | null>(null);
  const [driverDeliverySubmitting, setDriverDeliverySubmitting] = useState(false);
  const [driverReceiptPrompt, setDriverReceiptPrompt] = useState<DriverReceiptPrompt | null>(null);
  const [driverReceiptSharing, setDriverReceiptSharing] = useState<ReceiptChannel | null>(null);
  const [driverReceiptError, setDriverReceiptError] = useState<string | null>(null);
  const [stock, setStock] = useState<TruckStockItem[]>([]);
  const [products, setProducts] = useState<IProduct[]>([]);
  const [loadingTrucks, setLoadingTrucks] = useState(true);
  const [loadingTruckOrders, setLoadingTruckOrders] = useState(false);
  const [loadingStock, setLoadingStock] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truckOrdersError, setTruckOrdersError] = useState<string | null>(null);
  const [truckStock, setTruckStock] = useState<TruckStockItem[]>([]);
  const [stockProducts, setStockProducts] = useState<{ id: string; name: string; unit: string }[]>([]);
  const [selectedStockProductId, setSelectedStockProductId] = useState<string | null>(null);
  const [stockQuantity, setStockQuantity] = useState('');
  const [stockDate, setStockDate] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });
  const [savingStock, setSavingStock] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [truckModal, setTruckModal] = useState(false);
  const [driverAssignmentTruck, setDriverAssignmentTruck] = useState<Truck | null>(null);
  const [editingTruck, setEditingTruck] = useState<Truck | null>(null);
  const [plate, setPlate] = useState('');
  const [driverId, setDriverId] = useState('');
  const [addStockModal, setAddStockModal] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantityToLoad, setQuantityToLoad] = useState('');
  const [stockDatePickerOpen, setStockDatePickerOpen] = useState(false);
  const [editingStock, setEditingStock] = useState<TruckStockItem | null>(null);
  const [editLoaded, setEditLoaded] = useState('');
  const [editReturned, setEditReturned] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const visibleTrucks = useMemo(() => {
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
    const query = normalize(truckSearch.trim());
    return trucks.filter(truck =>
      (truckDriverFilter === 'all' || (truckDriverFilter === 'assigned' ? Boolean(truck.driverId || truck.driverName) : !truck.driverId && !truck.driverName)) &&
      (!query ||
      normalize(truck.licensePlate).includes(query) ||
      normalize(truck.driverName ?? '').includes(query)),
    );
  }, [truckSearch, truckDriverFilter, trucks]);
  const pageTrucks = useMemo(() => pageItems(visibleTrucks, truckPage), [visibleTrucks, truckPage]);
  const pageTruckOrders = useMemo(() => pageItems(truckOrders, orderPage), [truckOrders, orderPage]);
  const pageStock = useMemo(() => pageItems(stock, stockPage), [stock, stockPage]);
  const pageEmployees = useMemo(() => pageItems(employees, employeePage), [employees, employeePage]);
  const pageProducts = useMemo(() => pageItems(products, productPage), [products, productPage]);
  const visibleDriverOrders = useMemo(() => {
    const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim();
    const query = normalize(driverOrderSearch);
    return truckOrders.filter(order => {
      const hasFailedAttempt = hasFailedAttemptForScheduledDate(order, driverDeliveryAttempts[order.id]) || Boolean(driverCancellationReasons[order.id]);
      const matchesStatus = driverStatusFilter === 'PENDING'
        ? (order.status === 'PENDING' || order.status === 'IN_ROUTE') && !hasFailedAttempt
        : driverStatusFilter === 'CANCELLED'
          ? order.status === 'CANCELLED' || hasFailedAttempt
          : order.status === driverStatusFilter;
      return matchesStatus && (!query || normalize(order.customerName).startsWith(query));
    });
  }, [driverCancellationReasons, driverDeliveryAttempts, driverOrderSearch, driverStatusFilter, truckOrders]);
  const loadedOrderProducts = useMemo(() => {
    const totals = new Map<string, { productId: string; productName: string; unit?: string; quantity: number; notDeliveredQuantity: number; notDeliveredReason?: string }>();
    truckOrders.filter(order =>
      (order.status === 'PENDING' || order.status === 'IN_ROUTE' || order.status === 'CANCELLED') &&
      (order.deliveryDate || order.createdAt).slice(0, 10) === driverToday,
    ).forEach(order => order.items?.forEach(item => {
      const key = item.productId || item.productName;
      const current = totals.get(key);
      if (current) {
        current.quantity += item.quantity;
        const currentAttempt = latestAttemptForScheduledDate(order, driverDeliveryAttempts[order.id]);
        const notDelivered = order.status === 'CANCELLED' || hasFailedAttemptForScheduledDate(order, driverDeliveryAttempts[order.id]) || Boolean(driverCancellationReasons[order.id]);
        if (notDelivered) {
          current.notDeliveredQuantity += item.quantity;
          const reason = currentAttempt?.failureReason ?? driverCancellationReasons[order.id];
          if (reason) current.notDeliveredReason = [current.notDeliveredReason, reason].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join(' · ');
        }
      } else {
        const currentAttempt = latestAttemptForScheduledDate(order, driverDeliveryAttempts[order.id]);
        const notDelivered = order.status === 'CANCELLED' || hasFailedAttemptForScheduledDate(order, driverDeliveryAttempts[order.id]) || Boolean(driverCancellationReasons[order.id]);
        totals.set(key, { ...item, notDeliveredQuantity: notDelivered ? item.quantity : 0, notDeliveredReason: notDelivered ? currentAttempt?.failureReason ?? driverCancellationReasons[order.id] : undefined });
      }
    }));
    return [...totals.values()].sort((a, b) => a.productName.localeCompare(b.productName));
  }, [driverCancellationReasons, driverDeliveryAttempts, driverToday, truckOrders]);
  const pageLoadedOrderProducts = useMemo(() => pageItems(loadedOrderProducts, driverLoadedProductPage), [driverLoadedProductPage, loadedOrderProducts]);
  const driverCashTotals = useMemo(() => truckOrders
    .filter(order => order.status === 'DELIVERED' && (order.deliveredAt || order.deliveryDate || order.createdAt).slice(0, 10) === driverToday)
    .reduce((totals, order) => ({ cash: totals.cash + (order.cashAmount ?? 0), transfer: totals.transfer + (order.transferAmount ?? 0) }), { cash: 0, transfer: 0 }), [driverToday, truckOrders]);
  useEffect(() => setTruckPage(1), [truckSearch, truckDriverFilter]);
  useEffect(() => { if (!canViewLogistics) router.replace('/(tabs)/catalog' as any); }, [canViewLogistics, router]);
  useEffect(() => {
    const timer = setInterval(() => setDriverToday(today()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setDriverLoadedProductPage(1), [driverToday, loadedOrderProducts.length]);

  const loadTrucks = useCallback(async () => {
    setLoadingTrucks(true);
    setError(null);
    try {
      const result = isDriver
        ? user?.truckId
          ? [await logisticsService.getTruck(user.truckId)]
          : []
        : isDepot
          ? await logisticsService.getActiveTrucks()
          : await logisticsService.getTrucks();
      setTrucks(result);
      setSelectedTruck(current => current ? result.find(truck => truck.id === current.id) ?? null : null);
    } catch (err) {
      setError(parseApiError(err, 'No se pudieron cargar los camiones.').message);
    } finally {
      setLoadingTrucks(false);
    }
  }, [isDriver, isDepot, user?.truckId]);

  const loadEmployees = useCallback(async () => {
    setLoadingEmployees(true);
    try { setEmployees((await usersService.getUsers()).filter(user => user.active && isDeliveryRole(user.roleName, user.roleId))); setEmployeePage(1); }
    catch { setEmployees([]); }
    finally { setLoadingEmployees(false); }
  }, []);

  const loadStock = useCallback(async (truck: Truck, date?: string) => {
    setLoadingStock(true);
    setError(null);
    try { setStock(await logisticsService.getTruckStock(truck.id, date)); setStockPage(1); }
    catch (err) { setError(parseApiError(err, 'No se pudo consultar el stock del camión.').message); setStock([]); }
    finally { setLoadingStock(false); }
  }, []);

  const loadTruckOrders = useCallback(async (truck: Truck) => {
    setLoadingTruckOrders(true);
    setTruckOrdersError(null);
    try {
      const truckId = Number(truck.id);
      if (!Number.isInteger(truckId) || truckId < 1) throw new Error('No se pudo identificar el camión seleccionado. Actualizá la pantalla e intentá de nuevo.');
      setExpandedOrderId(null); setOrderPage(1);
      const orders = await salesService.getOrdersByTruck(truckId);
      setTruckOrders(orders);
      if (isDriver) {
        const attempts = await Promise.all(orders.filter(order => order.status === 'PENDING' || order.status === 'IN_ROUTE').map(async order => [order.id, await salesService.getDeliveryAttempts(order.id).catch(() => [])] as const));
        setDriverDeliveryAttempts(Object.fromEntries(attempts));
      }
    } catch (err) {
      setTruckOrdersError(parseApiError(err, 'No se pudieron cargar los pedidos de este camión.').message);
      setTruckOrders([]);
    } finally { setLoadingTruckOrders(false); }
  }, [isDriver]);

  const loadTruckStock = useCallback(async (truck: Truck) => {
    setLoadingStock(true);
    setStockError(null);
    try {
      const [records, products] = await Promise.all([
        logisticsService.getTruckStock(truck.id, stockDate),
        productsService.getProducts('', [], [], true),
      ]);
      setTruckStock(records);
      setStockProducts(products.items.map(product => ({ id: product.id, name: product.name, unit: product.unit })));
    } catch (err) {
      setStockError(parseApiError(err, 'No se pudo cargar el stock del camión.').message);
    } finally { setLoadingStock(false); }
  }, [stockDate]);

  const selectTruck = (truck: Truck) => {
    setSelectedTruck(truck);
    setOrdersModalOpen(true);
    setExpandedOrderId(null); setOrderPage(1); setStockPage(1);
    void loadTruckOrders(truck);
    void loadStock(truck, stockDate);
  };

  useEffect(() => {
    if (!canViewLogistics) return;
    void loadTrucks();
    if (!isDriver) void loadEmployees();
  }, [canViewLogistics, isDriver, loadTrucks, loadEmployees]);

  useEffect(() => {
    if (!isDriver || !trucks.length) return;
    const assignedTruck = trucks.find(truck => truck.id === user?.truckId);
    if (!assignedTruck) return;
    setSelectedTruck(assignedTruck);
    void loadTruckOrders(assignedTruck);
  }, [isDriver, trucks, user?.truckId, loadTruckOrders]);

  const openDriverDelivery = (order: OrderListItem) => {
    setDriverDeliveryOrder(order);
    setDriverDeliveryIdempotencyKey(`driver-delivery-${order.id}-${Date.now()}`);
    setDriverPaymentChoice(null);
    setDriverPaymentAmount('');
    setDriverPaymentMethod('cash');
    setDriverMixedCashAmount('');
    setDriverDeliveryError(null);
  };

  const cancelAssignedOrder = async () => {
    const order = driverCancelOrder;
    if (!order) return;
    const reason = driverCancelReasonText.trim() || driverCancelReasonOption;
    if (!reason || (driverCancelReasonOption === 'Otro' && !driverCancelReasonText.trim())) { setDriverOrderError('Seleccioná o escribí el motivo por el que no se entregó.'); return; }
    setDriverOrderBusyId(order.id);
    setDriverOrderError(null);
    try {
      await salesService.markDeliveryAttemptFailed(order.id, reason, driverCancelIdempotencyKey);
      setDriverCancellationReasons(current => ({ ...current, [order.id]: reason }));
      setDriverCancelOrder(null);
      setDriverCancelStage('confirm');
      setDriverCancelReasonOption(null);
      setDriverCancelReasonText('');
      setDriverCancelIdempotencyKey('');
      if (selectedTruck) await loadTruckOrders(selectedTruck);
    } catch (err) {
      setDriverOrderError(parseApiError(err, 'No se pudo registrar el intento de entrega fallido.').message);
    } finally {
      setDriverOrderBusyId(null);
    }
  };

  const confirmDriverDelivery = async () => {
    const order = driverDeliveryOrder;
    if (!order || !driverPaymentChoice) { setDriverDeliveryError('Elegí cómo se resolvió el pago para continuar.'); return; }
    const amount = driverPaymentChoice === 'account' ? 0 : driverPaymentChoice === 'full' ? order.total : Number(driverPaymentAmount.trim().replace(',', '.'));
    if (!Number.isFinite(order.total) || order.total <= 0) { setDriverDeliveryError('El total del pedido no es válido.'); return; }
    if (driverPaymentChoice === 'partial' && (!Number.isFinite(amount) || amount <= 0 || amount >= order.total)) { setDriverDeliveryError(`Ingresá un pago mayor que cero y menor que el total (${money(order.total)}).`); return; }
    const cashPart = driverPaymentMethod === 'mixed' ? Number(driverMixedCashAmount.trim().replace(',', '.')) : driverPaymentMethod === 'cash' ? amount : 0;
    const transferPart = driverPaymentMethod === 'mixed' ? amount - cashPart : driverPaymentMethod === 'transfer' ? amount : 0;
    if (driverPaymentChoice !== 'account' && driverPaymentMethod === 'mixed' && (!Number.isFinite(cashPart) || !Number.isFinite(transferPart) || cashPart <= 0 || transferPart <= 0)) { setDriverDeliveryError('Para un pago mixto, ingresá efectivo mayor que cero y menor que el importe recibido.'); return; }
    const method: DeliveryPaymentMethod = driverPaymentChoice === 'account'
      ? 'CURRENT_ACCOUNT'
      : driverPaymentMethod === 'cash' ? 'CASH'
        : driverPaymentMethod === 'transfer' ? 'TRANSFER'
          : 'MIXED';
    const payload: { paymentMethod: DeliveryPaymentMethod; cashAmount?: number; transferAmount?: number; amountPaid: number; idempotencyKey: string } = {
      paymentMethod: method,
      amountPaid: driverPaymentChoice === 'account' ? 0 : amount,
      idempotencyKey: driverDeliveryIdempotencyKey,
      ...(method === 'CASH' ? { cashAmount: cashPart } : {}),
      ...(method === 'TRANSFER' ? { transferAmount: transferPart } : {}),
      ...(method === 'MIXED' ? { cashAmount: cashPart, transferAmount: transferPart } : {}),
    };

    setDriverDeliverySubmitting(true);
    setDriverDeliveryError(null);
    try {
      // El endpoint de entrega acepta pedidos en reparto. El repartidor puede confirmar
      // directamente desde su lista de pendientes, así que avanzamos el estado primero.
      if (order.status === 'PENDING') await salesService.markInRoute(order.id);
      await salesService.markDelivered(order.id, payload);
      const raw = await salesService.getOrder(order.id).catch(() => ({} as Record<string, any>));
      const customer = raw.customer ?? raw.client ?? {};
      const customerId = String(raw.customerId ?? raw.clientId ?? customer.id ?? order.customerId ?? '');
      const linkedClient = /^\d+$/.test(customerId) ? await clientsService.getClientById(customerId).catch(() => null) : null;
      const rawItems = raw.items ?? raw.orderItems ?? raw.details ?? order.items ?? [];
      const methodLabel = driverPaymentChoice === 'account' ? 'Cuenta corriente'
        : driverPaymentChoice === 'partial' ? `Pago parcial (${driverPaymentMethod === 'cash' ? 'efectivo' : driverPaymentMethod === 'transfer' ? 'transferencia' : 'mixto'})`
          : driverPaymentMethod === 'cash' ? 'Efectivo' : driverPaymentMethod === 'transfer' ? 'Transferencia' : `Mixto (efectivo ${money(cashPart)}; transferencia ${money(transferPart)})`;
      const data: ReceiptData = {
        code: order.code,
        date: formatDateTime(new Date().toISOString()),
        customer: String(raw.customerName ?? customer.businessName ?? customer.name ?? order.customerName),
        items: Array.isArray(rawItems) ? rawItems.map((item: Record<string, any>) => ({ name: String(item.productName ?? item.product?.name ?? item.name ?? 'Producto'), quantity: Number(item.quantity ?? item.qty ?? 0), unitPrice: Number(item.unitPrice ?? item.price ?? item.product?.unitPrice ?? 0) })) : [],
        paymentMethod: methodLabel,
        total: Number(raw.totalAmount ?? raw.total ?? order.total),
        responsible: user?.fullName ?? user?.username ?? 'Repartidor',
      };
      setDriverReceiptError(null);
      setDriverReceiptPrompt({ data, email: String(raw.customerEmail ?? customer.email ?? raw.email ?? order.customerEmail ?? linkedClient?.email ?? '') || undefined, phone: String(raw.customerPhone ?? customer.phone ?? customer.phoneNumber ?? customer.mobile ?? raw.phone ?? raw.phoneNumber ?? order.customerPhone ?? linkedClient?.phone ?? '') || undefined });
      setDriverDeliveryOrder(null);
      setDriverDeliveryIdempotencyKey('');
      if (selectedTruck) await loadTruckOrders(selectedTruck);
    } catch (err) {
      setDriverDeliveryError(parseApiError(err, 'No se pudo confirmar la entrega.').message);
    } finally { setDriverDeliverySubmitting(false); }
  };

  const shareDriverReceipt = async (channel: ReceiptChannel) => {
    if (!driverReceiptPrompt) return;
    const recipient = channel === 'email' ? driverReceiptPrompt.email : driverReceiptPrompt.phone;
    if (!recipient) { setDriverReceiptError(channel === 'email' ? 'El pedido no incluye correo del cliente.' : 'El pedido no incluye teléfono del cliente.'); return; }
    setDriverReceiptSharing(channel);
    setDriverReceiptError(null);
    try { await receiptService.generateAndShare(driverReceiptPrompt.data, channel, recipient); setDriverReceiptPrompt(null); }
    catch (err) { setDriverReceiptError(parseApiError(err, 'No se pudo preparar el comprobante PDF.').message); }
    finally { setDriverReceiptSharing(null); }
  };

  const openTruckForm = (truck?: Truck) => {
    setEditingTruck(truck ?? null);
    setPlate(truck?.licensePlate ?? '');
    setDriverId(truck?.driverId ?? '');
    setError(null);
    setTruckModal(true);
  };

  const toggleTruck = async (truck: Truck) => {
    setSaving(true);
    setError(null);
    try {
      if (truck.active) await logisticsService.deactivateTruck(truck.id);
      else await logisticsService.activateTruck(truck.id);
      await loadTrucks();
    } catch (err) {
      setError(parseApiError(err, `No se pudo ${truck.active ? 'desactivar' : 'activar'} el camión.`).message);
    } finally { setSaving(false); }
  };

  const saveTruck = async () => {
    const normalizedPlate = plate.trim().toUpperCase();
    if (!normalizedPlate) { setError('Ingresá la patente del camión.'); return; }
    if (normalizedPlate.length > 20) { setError('La patente no puede superar 20 caracteres.'); return; }
    const normalizedDriverId = driverId.trim();
    if (normalizedDriverId && (!/^\d+$/.test(normalizedDriverId) || Number(normalizedDriverId) < 1)) {
      setError('El ID del chofer debe ser un número entero positivo.'); return;
    }
    if (normalizedDriverId && normalizedDriverId !== editingTruck?.driverId) {
      const eligibleDriver = employees.find(employee => employee.id === normalizedDriverId);
      if (!eligibleDriver || !isDeliveryRole(eligibleDriver.roleName, eligibleDriver.roleId)) {
        setError('Solo se puede asignar al camión un usuario activo con rol de repartidor.'); return;
      }
      const assignedTruck = trucks.find(truck => truck.active && truck.id !== editingTruck?.id && truck.driverId === normalizedDriverId);
      if (assignedTruck) {
        setError(`${eligibleDriver.fullName || eligibleDriver.email} ya está asignado al camión ${assignedTruck.licensePlate}. Cada repartidor puede tener un solo camión activo.`); return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { licensePlate: normalizedPlate, driverId: normalizedDriverId ? Number(normalizedDriverId) : editingTruck ? null : undefined };
      if (editingTruck) await logisticsService.updateTruck(editingTruck.id, payload);
      else await logisticsService.createTruck(payload);
      setTruckModal(false);
      await loadTrucks();
    } catch (err) {
      setError(parseApiError(err, 'No se pudo guardar el camión.').message);
    } finally { setSaving(false); }
  };

  const saveDriverAssignment = async (nextDriverId: string | null) => {
    if (!canAssignTruckToDriver || !driverAssignmentTruck) return;
    const truck = driverAssignmentTruck;
    const numericDriverId = nextDriverId == null ? null : Number(nextDriverId);
    if (numericDriverId != null && (!Number.isInteger(numericDriverId) || numericDriverId < 1)) {
      setError('El ID del chofer debe ser un número válido.');
      return;
    }
    if (nextDriverId && !employees.some(employee => employee.id === nextDriverId && isDeliveryRole(employee.roleName, employee.roleId))) {
      setError('Solo se puede asignar un usuario activo con rol de repartidor.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await logisticsService.updateTruck(truck.id, { licensePlate: truck.licensePlate, driverId: numericDriverId });
      setDriverAssignmentTruck(null);
      await loadTrucks();
    } catch (err) {
      setError(parseApiError(err, 'No se pudo asignar el chofer a este camión.').message);
    } finally { setSaving(false); }
  };

  const openAddStock = async () => {
    if (!selectedTruck) return;
    setError(null);
    setAddStockModal(true);
    setLoadingProducts(true);
    try {
      const result = await productsService.getProducts();
      setProducts(result.items.filter(product => product.active));
      setProductPage(1);
    } catch (err) {
      setError(parseApiError(err, 'No se pudieron cargar los productos.').message);
    } finally { setLoadingProducts(false); }
  };

  const addStock = async () => {
    if (!selectedTruck || !selectedProductId) { setError('Seleccioná un producto.'); return; }
    const quantity = Number(quantityToLoad);
    if (!Number.isInteger(quantity) || quantity < 1) { setError('La cantidad a cargar debe ser un número entero mayor a cero.'); return; }
    const productId = Number(selectedProductId);
    if (!Number.isInteger(productId) || productId < 1) { setError('No se pudo identificar el producto seleccionado. Actualizá la pantalla e intentá de nuevo.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(stockDate) || Number.isNaN(Date.parse(`${stockDate}T00:00:00`))) { setError('Seleccioná una fecha de reparto válida.'); return; }
    setSaving(true);
    setError(null);
    try {
      await logisticsService.loadProduct(selectedTruck.id, { productId, deliveryDate: stockDate, quantityLoaded: quantity });
      setAddStockModal(false);
      setQuantityToLoad('');
      setSelectedProductId('');
      await loadStock(selectedTruck, stockDate);
    } catch (err) {
      setError(parseApiError(err, 'No se pudo cargar el producto en el camión.').message);
    } finally { setSaving(false); }
  };

  const openEditStock = (item: TruckStockItem) => {
    setEditingStock(item);
    setEditLoaded(String(item.quantityLoaded));
    setEditReturned(String(item.quantityReturned));
    setError(null);
  };

  const saveStockEdit = async () => {
    if (!editingStock) return;
    const loaded = Number(editLoaded);
    const returned = Number(editReturned);
    if (!Number.isInteger(loaded) || loaded < 0 || !Number.isInteger(returned) || returned < editingStock.quantityReturned || returned > loaded) {
      setError('La devolución debe ser una cantidad entera, no puede reducir lo ya registrado ni superar lo cargado.'); return;
    }
    setSaving(true);
    setError(null);
    try {
      const truck = selectedTruck;
      if (!truck) throw new Error('Seleccioná un camión para actualizar su stock.');
      await logisticsService.updateStock(truck.id, editingStock.id, { quantityLoaded: loaded, quantityReturned: returned });
      setEditingStock(null);
      if (truck) await loadStock(truck, stockDate);
    } catch (err) {
      setError(parseApiError(err, 'No se pudo actualizar el stock.').message);
    } finally { setSaving(false); }
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    setError(null);
    try {
      if (deleteTarget.kind === 'truck') {
        await logisticsService.deleteTruck(deleteTarget.id);
        if (selectedTruck?.id === deleteTarget.id) { setSelectedTruck(null); setTruckOrders([]); }
        await loadTrucks();
      } else {
        if (!selectedTruck) throw new Error('Seleccioná un camión para eliminar stock.');
        await logisticsService.deleteStock(selectedTruck.id, deleteTarget.id);
        if (selectedTruck) await loadStock(selectedTruck, stockDate);
      }
      setDeleteTarget(null);
    } catch (err) {
      setError(parseApiError(err, 'No se pudo cambiar el estado del camión.').message);
    } finally { setSaving(false); }
  };

  if (isDriver) {
    return (
      <>
      <ScrollView style={styles.screen} contentContainerStyle={styles.driverContainer} keyboardShouldPersistTaps="handled">
        <View style={styles.driverHeader}>
          <View style={styles.driverHeaderIcon}><Ionicons name="bus-outline" size={24} color={colors.primary} /></View>
          <View style={styles.driverHeaderCopy}><Text style={styles.eyebrow}>REPARTO</Text><Text style={styles.title}>Mi camión</Text><Text style={styles.subtitle}>{selectedTruck?.licensePlate ?? 'Camión asignado'}</Text></View>
          <TouchableOpacity style={styles.iconButton} onPress={() => selectedTruck && void loadTruckOrders(selectedTruck)} disabled={loadingTruckOrders} accessibilityLabel="Actualizar pedidos"><Ionicons name="refresh-outline" size={20} color={colors.primary} /></TouchableOpacity>
        </View>
        {!!driverOrderError && <FormErrorBanner message={driverOrderError} onRetry={() => selectedTruck && void loadTruckOrders(selectedTruck)} />}
        {!!truckOrdersError && <FormErrorBanner message={truckOrdersError} onRetry={() => selectedTruck && void loadTruckOrders(selectedTruck)} />}
        {!!error && <FormErrorBanner message={error} onRetry={loadTrucks} />}
        <View style={styles.driverCashCard}><View style={styles.driverCashHeading}><Ionicons name="cash-outline" size={20} color={colors.primary} /><Text style={styles.driverProductsTitle}>Caja del día · {driverToday}</Text></View><View style={styles.driverCashRow}><Text style={styles.driverDetailText}>Efectivo</Text><Text style={styles.driverCashAmount}>{money(driverCashTotals.cash)}</Text></View><View style={styles.driverCashRow}><Text style={styles.driverDetailText}>Transferencia</Text><Text style={styles.driverCashAmount}>{money(driverCashTotals.transfer)}</Text></View><View style={styles.driverCashTotalRow}><Text style={styles.driverCashTotalLabel}>Total registrado</Text><Text style={styles.driverCashTotalValue}>{money(driverCashTotals.cash + driverCashTotals.transfer)}</Text></View></View>
        {loadingTrucks || loadingTruckOrders ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : !selectedTruck ? (
          <View style={styles.driverEmpty}><Ionicons name="bus-outline" size={32} color={colors.textSecondary} /><Text style={styles.emptyTitle}>No tenés un camión asignado</Text><Text style={styles.emptyText}>Pedile a un administrador que asigne tu usuario a un camión.</Text></View>
        ) : (
          <>
            <View style={styles.driverTabs}>{([['orders', 'Pedidos'], ['products', 'Productos cargados']] as const).map(([tab, label]) => <TouchableOpacity key={tab} style={[styles.driverTab, driverTab === tab && styles.driverTabActive]} onPress={() => setDriverTab(tab)}><Text style={[styles.driverTabText, driverTab === tab && styles.driverTabTextActive]}>{label}</Text></TouchableOpacity>)}</View>
            {driverTab === 'products' ? <View>
              <Text style={styles.driverSectionNote}>Carga de hoy · {driverToday}</Text>
              {pageLoadedOrderProducts.map(product => <View key={product.productId} style={styles.driverLoadedProduct}><View style={styles.driverLoadedProductCopy}><Text style={styles.driverCustomerName}>{product.productName}</Text>{!!product.unit && <Text style={styles.driverDetailText}>{product.unit}</Text>}{product.notDeliveredQuantity > 0 && <Text style={styles.driverLoadedStatus}>{product.notDeliveredQuantity} {product.unit || 'unidades'} no entregado{product.notDeliveredReason ? ` · ${product.notDeliveredReason}` : ''}</Text>}</View><Text style={styles.driverLoadedQuantity}>× {product.quantity}</Text></View>)}
              <PaginationControls page={driverLoadedProductPage} totalItems={loadedOrderProducts.length} onPageChange={setDriverLoadedProductPage} />
              {!loadedOrderProducts.length && <View style={styles.driverEmpty}><Ionicons name="cube-outline" size={30} color={colors.textSecondary} /><Text style={styles.emptyTitle}>No hay productos cargados hoy</Text><Text style={styles.emptyText}>Se suman los productos de los pedidos pendientes con entrega para hoy.</Text></View>}
            </View> : <>
            <View style={styles.driverSectionHeader}><View><Text style={styles.sectionTitle}>Pedidos {driverStatusFilter === 'PENDING' ? 'pendientes' : driverStatusFilter === 'DELIVERED' ? 'entregados' : 'no entregados'}</Text><Text style={styles.sectionHint}>{visibleDriverOrders.length} pedidos</Text></View></View>
            <View style={styles.driverStatusFilters}>{([['PENDING', 'Pendiente'], ['DELIVERED', 'Entregado'], ['CANCELLED', 'No entregado']] as const).map(([status, label]) => <TouchableOpacity key={status} style={[styles.driverStatusFilter, driverStatusFilter === status && styles.driverStatusFilterActive]} onPress={() => setDriverStatusFilter(status)}><Text style={[styles.driverStatusFilterText, driverStatusFilter === status && styles.driverStatusFilterTextActive]}>{label}</Text></TouchableOpacity>)}</View>
            <View style={styles.driverSearchBox}><Ionicons name="search-outline" size={19} color={colors.textSecondary} /><TextInput style={styles.driverSearchInput} value={driverOrderSearch} onChangeText={setDriverOrderSearch} placeholder="Buscar por razón social" placeholderTextColor={colors.textSecondary} maxLength={25} autoCorrect={false} />{!!driverOrderSearch && <TouchableOpacity onPress={() => setDriverOrderSearch('')} accessibilityLabel="Borrar búsqueda"><Ionicons name="close-circle" size={19} color={colors.textSecondary} /></TouchableOpacity>}</View>
            {visibleDriverOrders.map(order => {
              const expanded = expandedDriverOrderId === order.id;
              const failedAttempt = latestAttemptForScheduledDate(order, driverDeliveryAttempts[order.id]);
              const isNoDelivered = order.status === 'CANCELLED' || hasFailedAttemptForScheduledDate(order, driverDeliveryAttempts[order.id]) || Boolean(driverCancellationReasons[order.id]);
              return <View key={order.id} style={styles.driverOrderCard}>
              <TouchableOpacity style={styles.driverOrderHeading} onPress={() => setExpandedDriverOrderId(expanded ? null : order.id)} accessibilityRole="button" accessibilityState={{ expanded }}><View style={styles.driverOrderCopy}><Text style={styles.driverCustomerName} numberOfLines={2}>{order.customerName === 'Cliente' ? 'Razón social no disponible' : order.customerName}</Text><Text style={styles.assignedOrderCode}>Pedido {order.code}</Text></View><View style={[styles.driverPendingPill, order.status === 'DELIVERED' && styles.driverDeliveredPill, isNoDelivered && styles.driverCancelledPill]}><Text style={[styles.driverPendingText, order.status === 'DELIVERED' && styles.driverDeliveredText, isNoDelivered && styles.driverCancelledText]}>{isNoDelivered ? 'No entregado' : orderStatusLabel[order.status] ?? order.status}</Text></View><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} /></TouchableOpacity>
              {!!order.deliveryAddress && <View style={styles.driverDetailRow}><Ionicons name="location-outline" size={17} color={colors.textSecondary} /><Text style={styles.driverDetailText}>{order.deliveryAddress}</Text></View>}
              {expanded && <>
              <View style={styles.driverProducts}><Text style={styles.driverProductsTitle}>Productos</Text>{order.items?.length ? order.items.map((item, index) => <View key={`${item.productId}-${index}`} style={styles.driverProductRow}><Text style={styles.driverDetailText}>{item.productName}{item.unit ? ` (${item.unit})` : ''}</Text><Text style={styles.driverProductQuantity}>× {item.quantity}</Text></View>) : <Text style={styles.driverDetailText}>No hay productos detallados en este pedido.</Text>}</View>
              {isNoDelivered && !!(failedAttempt?.failureReason || driverCancellationReasons[order.id]) && <Text style={styles.driverLoadedStatus}>Motivo: {failedAttempt?.failureReason ?? driverCancellationReasons[order.id]}</Text>}
              <View style={styles.driverOrderMeta}><Text style={styles.assignedOrderMeta}>{order.itemCount} unidades</Text><Text style={styles.assignedOrderMeta}>{formatDate(order.deliveryDate || order.createdAt)}</Text></View>
              {driverStatusFilter === 'PENDING' && <View style={styles.driverOrderActions}><TouchableOpacity style={styles.driverCancelButton} onPress={() => { setDriverCancelOrder(order); setDriverCancelStage('confirm'); setDriverCancelReasonOption(null); setDriverCancelReasonText(''); setDriverCancelIdempotencyKey(`driver-failed-attempt-${order.id}-${Date.now()}`); setDriverOrderError(null); }} disabled={driverOrderBusyId === order.id}><Text style={styles.driverCancelText}>No entregado</Text></TouchableOpacity><TouchableOpacity style={styles.driverDeliverButton} onPress={() => openDriverDelivery(order)} disabled={driverOrderBusyId === order.id}><Ionicons name="checkmark-circle-outline" size={18} color={colors.textInverse} /><Text style={styles.driverDeliverText}>Marcar entregado</Text></TouchableOpacity></View>}
              </>}
            </View>;})}
            {!visibleDriverOrders.length && <View style={styles.driverEmpty}><Ionicons name={driverOrderSearch ? 'search-outline' : 'checkmark-circle-outline'} size={30} color={colors.textSecondary} /><Text style={styles.emptyTitle}>{driverOrderSearch ? 'No se encontraron pedidos' : `No hay pedidos ${driverStatusFilter === 'PENDING' ? 'pendientes' : driverStatusFilter === 'DELIVERED' ? 'entregados' : 'no entregados'}`}</Text><Text style={styles.emptyText}>{driverOrderSearch ? 'Probá con otra razón social.' : 'Los pedidos asignados van a aparecer acá.'}</Text></View>}
            </>}
          </>
        )}
      </ScrollView>
      <Modal visible={!!driverCancelOrder} transparent animationType="fade" onRequestClose={() => !driverOrderBusyId && (driverCancelStage === 'reason' ? setDriverCancelStage('confirm') : setDriverCancelOrder(null))}>
        <View style={styles.modalBackdrop}><View style={styles.driverCancelModal}>
          <View style={styles.driverCancelIcon}><Ionicons name="close-circle-outline" size={27} color={colors.error} /></View>
          {driverCancelStage === 'confirm' ? <>
            <Text style={styles.driverCancelTitle}>Marcar como no entregado</Text>
            <Text style={styles.driverCancelMessage}>¿Estás seguro de marcar el pedido {driverCancelOrder?.code} de {driverCancelOrder?.customerName} como no entregado?</Text>
          </> : <>
            <Text style={styles.driverCancelTitle}>Motivo de no entrega</Text>
            <Text style={styles.driverCancelMessage}>Seleccioná una opción o escribí el motivo.</Text>
            <ScrollView style={styles.driverReasonList} keyboardShouldPersistTaps="handled">{deliveryFailureReasons.map(reason => <TouchableOpacity key={reason} style={[styles.driverReasonOption, driverCancelReasonOption === reason && styles.driverReasonOptionSelected]} onPress={() => { setDriverCancelReasonOption(reason); setDriverOrderError(null); }}><Ionicons name={driverCancelReasonOption === reason ? 'radio-button-on' : 'radio-button-off'} size={18} color={driverCancelReasonOption === reason ? colors.primary : colors.textSecondary} /><Text style={[styles.driverReasonText, driverCancelReasonOption === reason && styles.driverReasonTextSelected]}>{reason}</Text></TouchableOpacity>)}</ScrollView>
            <TextInput style={styles.driverReasonInput} value={driverCancelReasonText} onChangeText={value => { setDriverCancelReasonText(value); setDriverOrderError(null); }} placeholder="Escribir otro motivo o agregar detalle" placeholderTextColor={colors.textSecondary} maxLength={250} multiline />
          </>}
          {!!driverOrderError && <Text style={styles.driverCancelError}>{driverOrderError}</Text>}
          <View style={styles.deliveryActions}><TouchableOpacity style={styles.deliveryCancelButton} onPress={() => { if (driverCancelStage === 'reason') { setDriverCancelStage('confirm'); setDriverOrderError(null); } else { setDriverCancelOrder(null); setDriverOrderError(null); } }} disabled={!!driverOrderBusyId}><Text style={styles.deliveryCancelText}>{driverCancelStage === 'reason' ? 'Volver' : 'No, volver'}</Text></TouchableOpacity><TouchableOpacity style={styles.driverCancelConfirmButton} onPress={() => driverCancelStage === 'confirm' ? (setDriverCancelStage('reason'), setDriverOrderError(null)) : void cancelAssignedOrder()} disabled={!!driverOrderBusyId}>{driverOrderBusyId === driverCancelOrder?.id ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.driverCancelConfirmText}>{driverCancelStage === 'confirm' ? 'Sí, continuar' : 'Confirmar no entrega'}</Text>}</TouchableOpacity></View>
        </View></View>
      </Modal>
      <Modal visible={!!driverDeliveryOrder} transparent animationType="slide" onRequestClose={() => !driverDeliverySubmitting && setDriverDeliveryOrder(null)}>
        <View style={styles.modalBackdrop}><View style={styles.driverPaymentModal}>
          <View style={styles.deliveryHeader}><View style={styles.assignmentModalIcon}><Ionicons name="checkmark-done-outline" size={22} color={colors.primary} /></View><View style={styles.assignmentModalTitleWrap}><Text style={styles.assignmentModalTitle}>Confirmar entrega</Text><Text style={styles.assignmentModalHint}>{driverDeliveryOrder?.code} · {driverDeliveryOrder?.customerName}</Text></View><TouchableOpacity onPress={() => setDriverDeliveryOrder(null)} disabled={driverDeliverySubmitting}><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity></View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.driverPaymentBody}>
            <View style={styles.deliveryTotalRow}><Text style={styles.deliveryTotalLabel}>Total del pedido</Text><Text style={styles.deliveryTotalValue}>{money(driverDeliveryOrder?.total ?? 0)}</Text></View>
            <Text style={styles.driverPaymentPrompt}>¿Cómo se resolvió el pago de este pedido?</Text>
            {([['full', 'Pagó completo', `Registrar ${money(driverDeliveryOrder?.total ?? 0)} como pago`], ['account', 'Cuenta corriente', 'Dejar el total pendiente en la cuenta del cliente'], ['partial', 'Pago parcial', 'Registrar un importe y dejar el saldo pendiente']] as const).map(([choice, label, hint]) => <TouchableOpacity key={choice} style={[styles.deliveryChoice, driverPaymentChoice === choice && styles.deliveryChoiceSelected]} onPress={() => { setDriverPaymentChoice(choice); setDriverPaymentAmount(''); setDriverMixedCashAmount(''); setDriverDeliveryError(null); }}><Ionicons name={driverPaymentChoice === choice ? 'radio-button-on' : 'radio-button-off'} size={20} color={driverPaymentChoice === choice ? colors.primary : colors.textSecondary} /><View style={styles.deliveryChoiceCopy}><Text style={styles.deliveryChoiceTitle}>{label}</Text><Text style={styles.deliveryChoiceSubtitle}>{hint}</Text></View></TouchableOpacity>)}
            {driverPaymentChoice === 'partial' && <View style={styles.deliveryAmountField}><Text style={styles.deliveryAmountLabel}>Importe recibido</Text><TextInput value={formatArgentineAmountInput(driverPaymentAmount)} onChangeText={value => { setDriverPaymentAmount(value.replace(/\D/g, '').slice(0, 11)); setDriverDeliveryError(null); }} style={styles.deliveryAmountInput} placeholder="$ 0" keyboardType="number-pad" maxLength={14} /><Text style={styles.deliveryAmountHint}>Quedarán {money(Math.max(0, (driverDeliveryOrder?.total ?? 0) - (Number(driverPaymentAmount) || 0)))} en cuenta corriente.</Text></View>}
            {driverPaymentChoice !== null && driverPaymentChoice !== 'account' && <View style={styles.deliveryAmountField}><Text style={styles.deliveryAmountLabel}>Forma de pago</Text><View style={styles.paymentMethods}>{([['cash', 'Efectivo'], ['transfer', 'Transferencia'], ['mixed', 'Mixto']] as const).map(([method, label]) => <TouchableOpacity key={method} style={[styles.paymentMethod, driverPaymentMethod === method && styles.paymentMethodActive]} onPress={() => setDriverPaymentMethod(method)}><Text style={[styles.paymentMethodText, driverPaymentMethod === method && styles.paymentMethodTextActive]}>{label}</Text></TouchableOpacity>)}</View>{driverPaymentMethod === 'mixed' && <TextInput value={formatArgentineAmountInput(driverMixedCashAmount)} onChangeText={value => setDriverMixedCashAmount(value.replace(/\D/g, '').slice(0, 11))} style={styles.deliveryAmountInput} placeholder="Importe en efectivo" keyboardType="number-pad" maxLength={14} />}</View>}
            {!!driverDeliveryError && <View style={styles.deliveryErrorBox}><Ionicons name="alert-circle-outline" size={18} color={colors.error} /><Text style={styles.deliveryErrorText}>{driverDeliveryError}</Text></View>}
            <Text style={styles.deliveryFootnote}>{driverPaymentChoice === 'account' ? 'El importe total queda pendiente en la cuenta corriente del cliente.' : driverPaymentChoice ? 'La forma de pago se incluye en el comprobante PDF.' : 'Elegí una opción para registrar la entrega.'}</Text>
            <View style={styles.deliveryActions}><TouchableOpacity style={styles.deliveryCancelButton} onPress={() => setDriverDeliveryOrder(null)} disabled={driverDeliverySubmitting}><Text style={styles.deliveryCancelText}>Volver</Text></TouchableOpacity><TouchableOpacity style={[styles.deliveryConfirmButton, (!driverPaymentChoice || driverDeliverySubmitting) && styles.deliveryConfirmDisabled]} onPress={() => void confirmDriverDelivery()} disabled={!driverPaymentChoice || driverDeliverySubmitting}>{driverDeliverySubmitting ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.deliveryConfirmText}>Confirmar entrega</Text>}</TouchableOpacity></View>
          </ScrollView>
        </View></View>
      </Modal>
      <Modal visible={!!driverReceiptPrompt} transparent animationType="fade" onRequestClose={() => !driverReceiptSharing && setDriverReceiptPrompt(null)}>
        <View style={styles.modalBackdrop}><View style={styles.driverReceiptModal}><View style={styles.deliveryHeader}><View style={styles.assignmentModalIcon}><Ionicons name="document-text-outline" size={22} color={colors.primary} /></View><View style={styles.assignmentModalTitleWrap}><Text style={styles.assignmentModalTitle}>Entrega registrada</Text><Text style={styles.assignmentModalHint}>{driverReceiptPrompt?.data.code} · {driverReceiptPrompt?.data.customer}</Text></View></View><Text style={styles.receiptSuccessText}>La entrega y el pago se registraron correctamente.</Text><Text style={styles.receiptPromptText}>¿Querés compartir el comprobante PDF?</Text>
          {driverReceiptPrompt?.email && <TouchableOpacity style={styles.receiptChannelButton} onPress={() => void shareDriverReceipt('email')} disabled={!!driverReceiptSharing}><Ionicons name="mail-outline" size={19} color={colors.primary} /><View style={styles.receiptChannelCopy}><Text style={styles.receiptChannelTitle}>Correo electrónico</Text><Text style={styles.receiptChannelTarget}>{driverReceiptPrompt.email}</Text></View>{driverReceiptSharing === 'email' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="chevron-forward" size={18} color={colors.primary} />}</TouchableOpacity>}
          {driverReceiptPrompt?.phone && <TouchableOpacity style={styles.receiptChannelButton} onPress={() => void shareDriverReceipt('whatsapp')} disabled={!!driverReceiptSharing}><Ionicons name="logo-whatsapp" size={19} color={colors.success} /><View style={styles.receiptChannelCopy}><Text style={styles.receiptChannelTitle}>WhatsApp</Text><Text style={styles.receiptChannelTarget}>{driverReceiptPrompt.phone}</Text></View>{driverReceiptSharing === 'whatsapp' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="chevron-forward" size={18} color={colors.primary} />}</TouchableOpacity>}
          {!!driverReceiptError && <Text style={styles.assignmentErrorText}>{driverReceiptError}</Text>}<TouchableOpacity style={styles.receiptDismiss} onPress={() => setDriverReceiptPrompt(null)} disabled={!!driverReceiptSharing}><Text style={styles.confirmBackText}>Ahora no</Text></TouchableOpacity>
        </View></View>
      </Modal>
      </>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <View><Text style={styles.eyebrow}>OPERACIONES</Text><Text style={styles.title}>Camiones y pedidos</Text><Text style={styles.subtitle}>Consultá qué pedidos y productos lleva cada unidad.</Text></View>
        <View style={styles.headerIcon}><Ionicons name="bus-outline" size={24} color={colors.primary} /></View>
      </View>

      {!isDriver && <TouchableOpacity style={styles.assignOrdersButton} onPress={() => router.push('/logistics-orders' as any)} accessibilityRole="button">
        <View style={styles.assignOrdersCopy}><Text style={styles.assignOrdersTitle}>Asignar pedidos</Text><Text style={styles.assignOrdersHint}>Elegí un pedido pendiente y el camión que lo repartirá.</Text></View>
        <Ionicons name="chevron-forward" size={19} color={colors.primary} />
      </TouchableOpacity>}

      {!!error && <FormErrorBanner message={error} onRetry={() => selectedTruck ? loadStock(selectedTruck, stockDate) : loadTrucks()} />}

      <View style={styles.sectionHeader}>
        <View><Text style={styles.sectionTitle}>Flota</Text><Text style={styles.sectionHint}>{trucks.length} {trucks.length === 1 ? 'camión' : 'camiones'} registrados</Text></View>
        {canManageLogistics && <TouchableOpacity style={styles.primarySmallButton} onPress={() => openTruckForm()}><Ionicons name="add" size={18} color={colors.textInverse} /><Text style={styles.primarySmallText}>Agregar</Text></TouchableOpacity>}
      </View>

      {!!trucks.length && <View style={styles.truckSearchBox}>
        <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
        <TextInput
          style={styles.truckSearchInput}
          value={truckSearch}
          onChangeText={setTruckSearch}
          placeholder="Buscar camión por patente o chofer"
          placeholderTextColor={colors.textSecondary}
          maxLength={40}
          autoCorrect={false}
        />
        {!!truckSearch && <TouchableOpacity onPress={() => setTruckSearch('')} accessibilityLabel="Borrar búsqueda de camiones"><Ionicons name="close-circle" size={19} color={colors.textSecondary} /></TouchableOpacity>}
      </View>}

      {!!trucks.length && <View style={styles.fleetFilters}>{([['all', 'Todos'], ['assigned', 'Con chofer'], ['unassigned', 'Sin chofer']] as const).map(([value, label]) => <TouchableOpacity key={value} style={[styles.fleetFilter, truckDriverFilter === value && styles.fleetFilterActive]} onPress={() => setTruckDriverFilter(value)}><Text style={[styles.fleetFilterText, truckDriverFilter === value && styles.fleetFilterTextActive]}>{label}</Text></TouchableOpacity>)}</View>}

      {loadingTrucks ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : pageTrucks.length ? pageTrucks.map(truck => (
        <View key={truck.id} style={[styles.truckCard, selectedTruck?.id === truck.id && styles.truckCardSelected]}>
          <TouchableOpacity style={styles.truckMain} onPress={() => selectTruck(truck)}>
            <View style={styles.truckIcon}><Ionicons name="bus" size={20} color={colors.primary} /></View>
            <View style={styles.truckInfo}><Text style={styles.plate}>{truck.licensePlate || 'Sin patente'}</Text><Text style={styles.driver}>{truck.driverName ?? employees.find(employee => employee.id === truck.driverId)?.fullName ?? (truck.driverId ? `Chofer ID ${truck.driverId}` : 'Sin chofer asignado')}</Text></View>
            <View style={[styles.activePill, !truck.active && styles.inactivePill]}><Text style={[styles.activeText, !truck.active && styles.inactiveText]}>{truck.active ? 'Activo' : 'Inactivo'}</Text></View>
            <Ionicons name={selectedTruck?.id === truck.id ? 'chevron-up' : 'chevron-down'} size={19} color={colors.textSecondary} />
          </TouchableOpacity>
          {canManageLogistics && <View style={styles.truckActions}>
            <TouchableOpacity style={styles.truckAction} onPress={() => openTruckForm(truck)}><Ionicons name="create-outline" size={16} color={colors.textSecondary} /><Text style={styles.truckActionText}>Editar</Text></TouchableOpacity>
            <TouchableOpacity style={styles.truckAction} onPress={() => void toggleTruck(truck)} disabled={saving}><Ionicons name={truck.active ? 'pause-circle-outline' : 'play-circle-outline'} size={16} color={colors.textSecondary} /><Text style={styles.truckActionText}>{truck.active ? 'Desactivar' : 'Activar'}</Text></TouchableOpacity>
          </View>}
          {canAssignTruckToDriver && truck.active && <TouchableOpacity style={styles.assignDriverButton} onPress={() => { setDriverAssignmentTruck(truck); setError(null); }} disabled={saving}><Ionicons name="person-add-outline" size={17} color={colors.primary} /><Text style={styles.assignDriverText}>{truck.driverId ? 'Cambiar chofer' : 'Asignar chofer'}</Text></TouchableOpacity>}
        </View>
      )) : (truckSearch.trim() || truckDriverFilter !== 'all') && trucks.length ? <View style={styles.emptyCard}><Text style={styles.emptyText}>No hay camiones en esta selección.</Text></View> : <View style={styles.emptyCard}><Ionicons name="bus-outline" size={28} color={colors.textSecondary} /><Text style={styles.emptyTitle}>{isDriver ? 'No tenés un camión asignado' : 'Todavía no hay camiones'}</Text><Text style={styles.emptyText}>{isDriver ? 'Pedile a un administrador que asigne tu usuario a un camión.' : 'Agregá un camión para asignar pedidos y gestionar stock.'}</Text></View>}
      <PaginationControls page={truckPage} totalItems={visibleTrucks.length} onPageChange={setTruckPage} />

      {selectedTruck && <View style={styles.stockSection}>
        <View style={styles.sectionHeader}>
          <View><Text style={styles.sectionTitle}>Stock de {selectedTruck.licensePlate}</Text><Text style={styles.sectionHint}>Cargado para la fecha seleccionada</Text></View>
          {canManageLogistics && <TouchableOpacity style={styles.primarySmallButton} onPress={() => void openAddStock()}><Ionicons name="add" size={18} color={colors.textInverse} /><Text style={styles.primarySmallText}>Cargar</Text></TouchableOpacity>}
        </View>
        <TouchableOpacity style={styles.dateCard} onPress={() => setStockDatePickerOpen(true)}><Ionicons name="calendar-outline" size={17} color={colors.primary} /><Text style={styles.dateCaption}>Fecha de reparto</Text><Text style={styles.dateInput}>{formatDate(stockDate)}</Text><Ionicons name="chevron-down" size={17} color={colors.primary} /></TouchableOpacity>
        <TouchableOpacity style={styles.refreshOrders} onPress={() => void loadStock(selectedTruck, stockDate)}><Ionicons name="refresh-outline" size={16} color={colors.primary} /><Text style={styles.refreshText}>Actualizar stock</Text></TouchableOpacity>
        {loadingStock ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : pageStock.length ? pageStock.map(item => <View key={item.id} style={styles.stockCard}>
          <View style={styles.stockTop}><View style={styles.stockProductIcon}><Ionicons name="cube-outline" size={17} color={colors.primary} /></View><View style={styles.stockNameWrap}><Text style={styles.stockName}>{item.productName}</Text><Text style={styles.stockDate}>{formatDate(item.deliveryDate || stockDate)}</Text></View>
            {canManageLogistics && <><TouchableOpacity onPress={() => openEditStock(item)} style={styles.iconButton}><Ionicons name="create-outline" size={18} color={colors.primary} /></TouchableOpacity><TouchableOpacity onPress={() => setDeleteTarget({ kind: 'stock', id: item.id, label: item.productName })} style={styles.iconButton}><Ionicons name="trash-outline" size={18} color={colors.error} /></TouchableOpacity></>}
          </View>
          <View style={styles.stockStats}><Text style={styles.stockStat}>Cargado <Text style={styles.stockNumber}>{item.quantityLoaded}</Text></Text><Text style={styles.stockStat}>Devuelto <Text style={styles.stockNumber}>{item.quantityReturned}</Text></Text><Text style={styles.remainingStat}>Disponible <Text style={styles.remainingNumber}>{Math.max(0, item.quantityLoaded - item.quantityReturned)}</Text></Text></View>
        </View>) : <View style={styles.emptyTruckOrders}><Text style={styles.emptyText}>No hay carga registrada para este camión y fecha.</Text></View>}
        <PaginationControls page={stockPage} totalItems={stock.length} onPageChange={setStockPage} />
      </View>}

      <Modal visible={ordersModalOpen && !!selectedTruck} transparent animationType="slide" onRequestClose={() => setOrdersModalOpen(false)}>
        <View style={styles.modalBackdrop}><View style={styles.ordersModal}>
          <View style={styles.ordersHeader}><View><Text style={styles.sectionTitle}>Pedidos del camión</Text><Text style={styles.sectionHint}>{selectedTruck?.licensePlate} · {truckOrders.length} pedidos</Text></View><View style={styles.ordersModalActions}><TouchableOpacity style={styles.iconButton} onPress={() => selectedTruck && void loadTruckOrders(selectedTruck)} disabled={loadingTruckOrders} accessibilityLabel="Actualizar pedidos"><Ionicons name="refresh-outline" size={19} color={colors.primary} /></TouchableOpacity><TouchableOpacity style={styles.iconButton} onPress={() => setOrdersModalOpen(false)} accessibilityLabel="Cerrar pedidos"><Ionicons name="close" size={21} color={colors.textSecondary} /></TouchableOpacity></View></View>
          {!!truckOrdersError && <FormErrorBanner message={truckOrdersError} onRetry={() => selectedTruck && void loadTruckOrders(selectedTruck)} />}
          <ScrollView style={styles.ordersModalList} keyboardShouldPersistTaps="handled">
            {loadingTruckOrders ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : pageTruckOrders.length ? pageTruckOrders.map(order => {
              const expanded = expandedOrderId === order.id;
              return <View key={order.id || order.code} style={styles.assignedOrderCard}>
                <TouchableOpacity style={styles.assignedOrderHeader} onPress={() => setExpandedOrderId(expanded ? null : order.id)} accessibilityRole="button" accessibilityState={{ expanded }}>
                  <View style={styles.assignedOrderInfo}><Text style={styles.assignedOrderCode}>{order.code}</Text><Text style={styles.assignedOrderCustomer} numberOfLines={1}>{order.customerName}</Text><Text style={styles.assignedOrderMeta}>{order.itemCount} productos · {formatDate(order.deliveryDate || order.createdAt)}</Text></View>
                  <View style={styles.orderStatusPill}><Text style={styles.orderStatusText}>{orderStatusLabel[order.status] ?? order.status}</Text></View><Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={17} color={colors.textSecondary} />
                </TouchableOpacity>
                {expanded && (order.items?.length ? order.items.map((item, index) => <View key={`${item.productId}-${index}`} style={styles.assignedProductRow}><Ionicons name="cube-outline" size={15} color={colors.textSecondary} /><Text style={styles.assignedProductName}>{item.productName}</Text><Text style={styles.assignedProductQty}>× {item.quantity}</Text></View>) : <Text style={styles.noOrderItems}>El pedido contiene {order.itemCount} productos. No se pudo cargar el detalle.</Text>)}
              </View>;
            }) : <View style={styles.emptyTruckOrders}><Text style={styles.emptyText}>Este camión todavía no tiene pedidos asignados.</Text></View>}
          </ScrollView>
          <PaginationControls page={orderPage} totalItems={truckOrders.length} onPageChange={setOrderPage} />
        </View></View>
      </Modal>

      <Modal visible={!!driverAssignmentTruck} transparent animationType="fade" onRequestClose={() => !saving && setDriverAssignmentTruck(null)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Chofer de {driverAssignmentTruck?.licensePlate}</Text>
          <Text style={styles.modalDescription}>Elegí el chofer activo que va a quedar asignado a este camión.</Text>
          {!!error && <Text style={styles.modalError}>{error}</Text>}
          {loadingEmployees ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : employees.length ? <>
            <TouchableOpacity style={styles.employeeChoice} onPress={() => void saveDriverAssignment(null)} disabled={saving}><Text style={styles.employeeChoiceText}>Quitar asignación</Text></TouchableOpacity>
            <ScrollView style={styles.employeePicker} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {pageEmployees.map(employee => <TouchableOpacity key={employee.id} style={[styles.employeeChoice, employee.id === driverAssignmentTruck?.driverId && styles.employeeChoiceSelected]} onPress={() => void saveDriverAssignment(employee.id)} disabled={saving}>
                <Text style={[styles.employeeChoiceText, employee.id === driverAssignmentTruck?.driverId && styles.employeeChoiceTextSelected]}>{employee.fullName || employee.email}</Text>
                <Text style={styles.employeeRole}>{employee.email}{employee.roleName ? ` · ${employee.roleName}` : ''}</Text>
              </TouchableOpacity>)}
            </ScrollView><PaginationControls page={employeePage} totalItems={employees.length} onPageChange={setEmployeePage} />
          </> : <View><Text style={styles.modalDescription}>No hay choferes activos disponibles.</Text><TouchableOpacity onPress={() => void loadEmployees()}><Text style={styles.refreshText}>Reintentar carga de usuarios</Text></TouchableOpacity></View>}
          <View style={styles.modalActions}><TouchableOpacity style={styles.secondaryButton} onPress={() => setDriverAssignmentTruck(null)} disabled={saving}><Text style={styles.secondaryButtonText}>Cerrar</Text></TouchableOpacity></View>
        </View></View>
      </Modal>

      <Modal visible={truckModal} transparent animationType="fade" onRequestClose={() => setTruckModal(false)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{editingTruck ? 'Editar camión' : 'Nuevo camión'}</Text>
          {!!error && <Text style={styles.modalError}>{error}</Text>}
          <Text style={styles.inputLabel}>Patente</Text><TextInput value={plate} onChangeText={setPlate} style={styles.input} placeholder="ABC 123" autoCapitalize="characters" maxLength={20} editable={!saving} />
          <Text style={styles.inputLabel}>Chofer o empleado <Text style={styles.optional}>(opcional)</Text></Text>
          {loadingEmployees ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : employees.length ? <><TouchableOpacity style={[styles.employeeChoice, !driverId && styles.employeeChoiceSelected]} onPress={() => setDriverId('')} disabled={saving}><Text style={[styles.employeeChoiceText, !driverId && styles.employeeChoiceTextSelected]}>Sin asignar</Text></TouchableOpacity><ScrollView style={styles.employeePicker} nestedScrollEnabled>
            {pageEmployees.map(employee => <TouchableOpacity key={employee.id} style={[styles.employeeChoice, driverId === employee.id && styles.employeeChoiceSelected]} onPress={() => setDriverId(employee.id)} disabled={saving}><Text style={[styles.employeeChoiceText, driverId === employee.id && styles.employeeChoiceTextSelected]}>{employee.fullName || employee.email}</Text><Text style={styles.employeeRole}>{employee.email}{employee.roleName ? ` · ${employee.roleName}` : ''}</Text></TouchableOpacity>)}
          </ScrollView><PaginationControls page={employeePage} totalItems={employees.length} onPageChange={setEmployeePage} /></> : <View><Text style={styles.modalDescription}>No hay empleados disponibles para asignar.</Text><TouchableOpacity onPress={() => void loadEmployees()}><Text style={styles.refreshText}>Reintentar carga de usuarios</Text></TouchableOpacity></View>}
          <View style={styles.modalActions}><TouchableOpacity style={styles.secondaryButton} onPress={() => setTruckModal(false)} disabled={saving}><Text style={styles.secondaryButtonText}>Volver</Text></TouchableOpacity><TouchableOpacity style={styles.modalPrimaryButton} onPress={() => void saveTruck()} disabled={saving}>{saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.modalPrimaryText}>Guardar</Text>}</TouchableOpacity></View>
        </View></View>
      </Modal>

      <Modal visible={addStockModal} transparent animationType="fade" onRequestClose={() => setAddStockModal(false)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Cargar producto</Text>{!!error && <Text style={styles.modalError}>{error}</Text>}<Text style={styles.modalDescription}>Camión {selectedTruck?.licensePlate}</Text>
          <Text style={styles.inputLabel}>Fecha de reparto</Text><TouchableOpacity style={styles.inputButton} onPress={() => setStockDatePickerOpen(true)} disabled={saving}><Text style={styles.inputText}>{formatDate(stockDate)}</Text></TouchableOpacity>
          <Text style={styles.inputLabel}>Producto</Text>{loadingProducts ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : <><ScrollView style={styles.productPicker} nestedScrollEnabled>{pageProducts.map(product => <TouchableOpacity key={product.id} style={[styles.productChoice, selectedProductId === product.id && styles.productChoiceSelected]} onPress={() => setSelectedProductId(product.id)}><Text style={[styles.productChoiceText, selectedProductId === product.id && styles.productChoiceTextSelected]}>{product.name}</Text><Text style={styles.productUnit}>{product.unit}</Text></TouchableOpacity>)}</ScrollView><PaginationControls page={productPage} totalItems={products.length} onPageChange={setProductPage} /></>}
          <Text style={styles.inputLabel}>Cantidad</Text><TextInput value={quantityToLoad} onChangeText={setQuantityToLoad} style={styles.input} placeholder="0" keyboardType="number-pad" editable={!saving} />
          <View style={styles.modalActions}><TouchableOpacity style={styles.secondaryButton} onPress={() => setAddStockModal(false)} disabled={saving}><Text style={styles.secondaryButtonText}>Volver</Text></TouchableOpacity><TouchableOpacity style={styles.modalPrimaryButton} onPress={() => void addStock()} disabled={saving || loadingProducts}>{saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.modalPrimaryText}>Cargar</Text>}</TouchableOpacity></View>
        </View></View>
      </Modal>

      <Modal visible={!!editingStock} transparent animationType="fade" onRequestClose={() => setEditingStock(null)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Registrar devolución</Text>{!!error && <Text style={styles.modalError}>{error}</Text>}<Text style={styles.modalDescription}>{editingStock?.productName} · Stock del camión {selectedTruck?.licensePlate}</Text>
          <Text style={styles.inputLabel}>Cantidad cargada</Text><TextInput value={editLoaded} onChangeText={setEditLoaded} style={styles.input} keyboardType="number-pad" editable={false} />
          <Text style={styles.inputLabel}>Cantidad devuelta acumulada</Text><TextInput value={editReturned} onChangeText={setEditReturned} style={styles.input} keyboardType="number-pad" editable={!saving} />
          <View style={styles.modalActions}><TouchableOpacity style={styles.secondaryButton} onPress={() => setEditingStock(null)} disabled={saving}><Text style={styles.secondaryButtonText}>Volver</Text></TouchableOpacity><TouchableOpacity style={styles.modalPrimaryButton} onPress={() => void saveStockEdit()} disabled={saving}>{saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.modalPrimaryText}>Guardar</Text>}</TouchableOpacity></View>
        </View></View>
      </Modal>

      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <View style={styles.deleteIcon}><Ionicons name="trash-outline" size={24} color={colors.error} /></View><Text style={styles.modalTitle}>{deleteTarget?.kind === 'stock' ? 'Eliminar carga' : 'Eliminar camión'}</Text><Text style={styles.modalDescription}>¿Querés eliminar {deleteTarget?.label}? Esta acción no se puede deshacer.</Text>
          <View style={styles.modalActions}><TouchableOpacity style={styles.secondaryButton} onPress={() => setDeleteTarget(null)} disabled={saving}><Text style={styles.secondaryButtonText}>Volver</Text></TouchableOpacity><TouchableOpacity style={styles.deleteButton} onPress={() => void confirmDelete()} disabled={saving}>{saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.modalPrimaryText}>Eliminar</Text>}</TouchableOpacity></View>
        </View></View>
      </Modal>
      <DatePickerCalendar visible={stockDatePickerOpen} value={stockDate} title="Fecha de reparto" onSelect={setStockDate} onClose={() => setStockDatePickerOpen(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  driverContainer: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  driverHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  driverHeaderIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  driverHeaderCopy: { flex: 1 },
  driverSectionHeader: { marginBottom: spacing.md },
  driverTabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  driverTab: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 2, borderBottomColor: colors.border },
  driverTabActive: { borderBottomColor: colors.primary },
  driverTabText: { ...typography.label, color: colors.textSecondary },
  driverTabTextActive: { color: colors.primary, fontWeight: '700' },
  driverSectionNote: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  driverCashCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  driverCashHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  driverCashRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  driverCashAmount: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  driverCashTotalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.sm },
  driverCashTotalLabel: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  driverCashTotalValue: { ...typography.label, color: colors.primary, fontWeight: '800' },
  driverLoadedProduct: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  driverLoadedProductCopy: { flex: 1, gap: 2 },
  driverLoadedQuantity: { ...typography.subheading, color: colors.primary, fontWeight: '800' },
  driverLoadedStatus: { ...typography.caption, color: colors.warning, fontWeight: '700', marginTop: 2 },
  driverLoadedStatusCancelled: { color: colors.error },
  driverStatusFilters: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  driverStatusFilter: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  driverStatusFilterActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  driverStatusFilterText: { ...typography.caption, color: colors.textSecondary },
  driverStatusFilterTextActive: { color: colors.primary, fontWeight: '700' },
  driverSearchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, marginBottom: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  driverSearchInput: { flex: 1, color: colors.textPrimary, ...typography.body },
  driverOrderCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  driverOrderHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  driverOrderCopy: { flex: 1 },
  driverCustomerName: { ...typography.subheading, color: colors.textPrimary, fontWeight: '700' },
  driverPendingPill: { backgroundColor: colors.warningLight, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  driverPendingText: { ...typography.caption, color: colors.warning, fontWeight: '700' },
  driverDeliveredPill: { backgroundColor: colors.successLight, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  driverDeliveredText: { ...typography.caption, color: colors.success, fontWeight: '700' },
  driverCancelledPill: { backgroundColor: colors.errorLight, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  driverCancelledText: { ...typography.caption, color: colors.error, fontWeight: '700' },
  driverOrderMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  driverDetailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.sm },
  driverDetailText: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  driverProducts: { marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, gap: spacing.xs },
  driverProductsTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.xs },
  driverProductRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  driverProductQuantity: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  driverOrderActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  driverCancelButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.errorLight },
  driverCancelText: { ...typography.label, color: colors.error, fontWeight: '700' },
  driverDeliverButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.success },
  driverDeliverText: { ...typography.label, color: colors.textInverse, fontWeight: '700' },
  driverEmpty: { alignItems: 'center', padding: spacing.xl, marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  eyebrow: { ...typography.caption, color: colors.primary, fontWeight: '800', letterSpacing: 1.4 },
  title: { ...typography.heading, color: colors.textPrimary, marginTop: 3 },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  headerIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  assignOrdersButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginBottom: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  assignOrdersCopy: { flex: 1 },
  assignOrdersTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '800' },
  assignOrdersHint: { ...typography.caption, color: colors.textSecondary, marginTop: 3, lineHeight: 17 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md, marginTop: spacing.sm },
  sectionTitle: { ...typography.subheading, color: colors.textPrimary },
  sectionHint: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  truckSearchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.md, marginBottom: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  truckSearchInput: { flex: 1, color: colors.textPrimary, ...typography.body },
  fleetFilters: { flexDirection: 'row', alignSelf: 'flex-start', gap: spacing.xs, marginBottom: spacing.sm },
  fleetFilter: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, backgroundColor: colors.surface },
  fleetFilterActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  fleetFilterText: { ...typography.caption, color: colors.textSecondary },
  fleetFilterTextActive: { color: colors.primary, fontWeight: '700' },
  primarySmallButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  primarySmallText: { ...typography.caption, color: colors.textInverse, fontWeight: '700' },
  loader: { paddingVertical: spacing.xl },
  truckCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginBottom: spacing.md, overflow: 'hidden' },
  truckCardSelected: { borderColor: colors.primary },
  truckMain: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  truckIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.primaryLight },
  truckInfo: { flex: 1 },
  plate: { ...typography.label, color: colors.textPrimary, fontWeight: '800' },
  driver: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  activePill: { backgroundColor: colors.successLight, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  inactivePill: { backgroundColor: colors.background },
  activeText: { ...typography.caption, color: colors.success, fontSize: 10, fontWeight: '700' },
  inactiveText: { color: colors.textSecondary },
  truckActions: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, justifyContent: 'flex-end', gap: spacing.md },
  truckAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: spacing.xs },
  truckActionText: { ...typography.caption, color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  assignDriverButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.sm },
  assignDriverText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  emptyCard: { alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.xl },
  emptyTitle: { ...typography.label, color: colors.textPrimary, marginTop: spacing.sm },
  emptyText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  truckOrdersSection: { marginTop: spacing.md },
  ordersModal: { width: '100%', maxWidth: 560, maxHeight: '84%', backgroundColor: colors.background, borderRadius: radius.lg, padding: spacing.lg },
  ordersModalActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  ordersModalList: { flexShrink: 1, marginTop: spacing.sm },
  stockSection: { marginTop: spacing.md },
  dateCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, marginBottom: spacing.xs },
  dateCaption: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  dateInput: { ...typography.caption, color: colors.textPrimary, textAlign: 'right', minWidth: 110, paddingVertical: spacing.sm },
  stockCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  stockTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stockProductIcon: { width: 34, height: 34, borderRadius: radius.sm, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  stockNameWrap: { flex: 1 },
  stockName: { ...typography.label, color: colors.textPrimary },
  stockDate: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  iconButton: { padding: spacing.xs },
  stockStats: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  stockStat: { ...typography.caption, color: colors.textSecondary },
  stockNumber: { color: colors.textPrimary, fontWeight: '700' },
  remainingStat: { ...typography.caption, color: colors.primary, marginLeft: 'auto' },
  remainingNumber: { fontWeight: '800' },
  productPicker: { maxHeight: 150, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, marginBottom: spacing.xs },
  productChoice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  productChoiceSelected: { backgroundColor: colors.primaryLight },
  productChoiceText: { ...typography.caption, color: colors.textPrimary },
  productChoiceTextSelected: { color: colors.primary, fontWeight: '700' },
  productUnit: { ...typography.caption, color: colors.textSecondary },
  ordersHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm, marginTop: spacing.sm },
  assignedOrderCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  assignedOrderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  assignedOrderInfo: { flex: 1 },
  assignedOrderCode: { ...typography.label, color: colors.textPrimary, fontWeight: '800' },
  assignedOrderCustomer: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  assignedOrderMeta: { ...typography.caption, color: colors.textDisabled, marginTop: 2, fontSize: 10 },
  orderStatusPill: { backgroundColor: colors.primaryLight, borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  orderStatusText: { ...typography.caption, color: colors.primary, fontSize: 10, fontWeight: '700' },
  assignedProductRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingTop: spacing.xs },
  assignedProductName: { ...typography.caption, color: colors.textPrimary, flex: 1 },
  assignedProductQty: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  noOrderItems: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  refreshOrders: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs, paddingVertical: spacing.sm, marginBottom: spacing.xs },
  refreshText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  emptyTruckOrders: { padding: spacing.lg, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20, 12, 10, 0.48)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  driverPaymentModal: { width: '100%', maxWidth: 460, maxHeight: '88%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  driverReceiptModal: { width: '100%', maxWidth: 460, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  driverCancelModal: { width: '100%', maxWidth: 420, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  driverCancelIcon: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.errorLight, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: spacing.md },
  driverCancelTitle: { ...typography.subheading, color: colors.textPrimary, fontWeight: '700', textAlign: 'center' },
  driverCancelMessage: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  driverCancelError: { ...typography.caption, color: colors.error, marginTop: spacing.sm },
  driverReasonList: { maxHeight: 230, marginTop: spacing.md },
  driverReasonOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border },
  driverReasonOptionSelected: { backgroundColor: colors.primaryLight },
  driverReasonText: { ...typography.caption, color: colors.textPrimary },
  driverReasonTextSelected: { color: colors.primary, fontWeight: '700' },
  driverReasonInput: { ...typography.body, color: colors.textPrimary, minHeight: 72, textAlignVertical: 'top', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginTop: spacing.sm, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  driverCancelConfirmButton: { flex: 1.4, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.error },
  driverCancelConfirmText: { ...typography.label, color: colors.textInverse, fontWeight: '700' },
  assignmentModalIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  assignmentModalTitleWrap: { flex: 1 },
  assignmentModalTitle: { ...typography.subheading, color: colors.textPrimary, fontWeight: '700' },
  assignmentModalHint: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  deliveryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  driverPaymentBody: { paddingTop: spacing.md, paddingBottom: spacing.xs },
  deliveryTotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  deliveryTotalLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  deliveryTotalValue: { ...typography.subheading, color: colors.primary, fontWeight: '800' },
  driverPaymentPrompt: { ...typography.label, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  deliveryChoice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  deliveryChoiceSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  deliveryChoiceCopy: { flex: 1 },
  deliveryChoiceTitle: { ...typography.label, color: colors.textPrimary },
  deliveryChoiceSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  deliveryAmountField: { marginTop: spacing.sm, marginBottom: spacing.sm },
  paymentMethods: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  paymentMethod: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface },
  paymentMethodActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  paymentMethodText: { ...typography.caption, color: colors.textSecondary },
  paymentMethodTextActive: { color: colors.primary, fontWeight: '700' },
  deliveryAmountLabel: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.xs },
  deliveryAmountInput: { ...typography.body, color: colors.textPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  deliveryAmountHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  deliveryErrorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, padding: spacing.sm, marginTop: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.errorLight },
  deliveryErrorText: { ...typography.caption, color: colors.error, flex: 1, lineHeight: 18 },
  deliveryFootnote: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.sm },
  deliveryActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  deliveryCancelButton: { flex: 1, paddingVertical: spacing.md, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.background },
  deliveryCancelText: { ...typography.label, color: colors.textSecondary },
  deliveryConfirmButton: { flex: 1.4, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  deliveryConfirmDisabled: { opacity: 0.55 },
  deliveryConfirmText: { ...typography.label, color: colors.textInverse },
  receiptSuccessText: { ...typography.caption, color: colors.success, fontWeight: '700', marginTop: spacing.md },
  receiptPromptText: { ...typography.body, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  receiptChannelButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 62, padding: spacing.md, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  receiptChannelCopy: { flex: 1 },
  receiptChannelTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  receiptChannelTarget: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  receiptNoContact: { ...typography.caption, color: colors.textSecondary, paddingVertical: spacing.sm },
  receiptHint: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.md },
  receiptDismiss: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  confirmBackText: { ...typography.label, color: colors.textSecondary },
  assignmentErrorText: { ...typography.caption, color: colors.error, marginTop: spacing.sm },
  modalCard: { width: '100%', maxWidth: 440, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl },
  modalTitle: { ...typography.subheading, color: colors.textPrimary, marginBottom: spacing.md },
  modalError: { ...typography.caption, color: colors.error, marginBottom: spacing.sm },
  modalDescription: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  inputLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.sm },
  optional: { fontWeight: '400', color: colors.textDisabled },
  input: { ...typography.body, color: colors.textPrimary, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  inputButton: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  inputText: { ...typography.body, color: colors.textPrimary },
  employeePicker: { maxHeight: 180, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, marginBottom: spacing.md },
  employeeChoice: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.border },
  employeeChoiceSelected: { backgroundColor: colors.primaryLight },
  employeeChoiceText: { ...typography.label, color: colors.textPrimary },
  employeeChoiceTextSelected: { color: colors.primary },
  employeeRole: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  modalActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  secondaryButton: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: 'center' },
  secondaryButtonText: { ...typography.label, color: colors.textPrimary },
  modalPrimaryButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center' },
  modalPrimaryText: { ...typography.label, color: colors.textInverse, fontWeight: '700' },
  deleteIcon: { width: 48, height: 48, borderRadius: radius.full, backgroundColor: colors.errorLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md, alignSelf: 'center' },
  deleteButton: { flex: 1, backgroundColor: colors.error, borderRadius: radius.sm, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center' },
});
