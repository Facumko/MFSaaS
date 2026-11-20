import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FormErrorBanner } from '../../../components/ui/FormErrorBanner';
import { PaginationControls, pageItems } from '../../../components/ui/PaginationControls';
import { DatePickerCalendar } from '../../../components/ui/DatePickerCalendar';
import { clientsService } from '../../../services/api/clientsService';
import { logisticsService, Truck } from '../../../services/api/logisticsService';
import { productsService } from '../../../services/api/productsService';
import { OrderDeliveryRequest, OrderListItem, salesService } from '../../../services/api/salesService';
import { ledgerService } from '../../../services/api/ledgerService';
import { ReceiptChannel, ReceiptData, receiptService } from '../../../services/api/receiptService';
import { useCartStore } from '../../../store/cartStore';
import { useAuthStore } from '../../../store/authStore';
import { usePermissions } from '../../../hooks/usePermissions';
import { colors, radius, spacing, typography } from '../../../theme';
import { IAddress, IClient, IClientSummary, IProduct } from '../../../types';
import { parseApiError } from '../../../utils/apiErrors';
import { formatArgentineAmountInput, formatDate, formatDateTime } from '../../../utils/formatters';

type ScreenMode = 'new' | 'history';
type EditableOrderItem = { productId: number; productName: string; unit: string; quantity: number; unitPrice: number };
type OrderDetailData = { customerId: number; deliveryAddressId?: number; deliveryAddressSnapshot: string; deliveryDate: string; createdById?: number; items: EditableOrderItem[] };
type DeliveryPaymentChoice = 'full' | 'account' | 'partial';
type ReceiptPaymentMethod = 'cash' | 'transfer' | 'mixed';
type PendingDeliveryPayment = { order: OrderListItem; choice: DeliveryPaymentChoice; amount: number; method: ReceiptPaymentMethod; cashAmount: string };
type ReceiptPrompt = { data: ReceiptData; email?: string; phone?: string };

const money = (value: number) => `$${value.toLocaleString('es-AR')}`;
const normalizeSearch = (value: string) => value.toLocaleLowerCase('es-AR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const normalizeText = (value: string) => value.toLocaleLowerCase('es-AR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const localToday = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const statusCopy: Record<string, string> = {
  PENDING: 'Pendiente',
  IN_ROUTE: 'En reparto',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
};

export default function OrdersScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ newClientId?: string }>();
  const newClientId = Array.isArray(params.newClientId) ? params.newClientId[0] : params.newClientId;
  const user = useAuthStore(state => state.user);
  const { canAssignOrdersToTruck, canViewOrders, canManageClients, canRegisterSale, isAdmin, isDelivery } = usePermissions();
  const isDriver = isDelivery;
  const { items, total, itemCount, addItem, updateQty, clearCart } = useCartStore();
  const [mode, setMode] = useState<ScreenMode>(isDriver ? 'history' : 'new');
  const [clients, setClients] = useState<IClientSummary[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState<IClientSummary | null>(null);
  const [addresses, setAddresses] = useState<IAddress[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<IAddress | null>(null);
  const [addressPickerOpen, setAddressPickerOpen] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddressLabel, setNewAddressLabel] = useState('');
  const [newAddressStreet, setNewAddressStreet] = useState('');
  const [newAddressCity, setNewAddressCity] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const [productsExpanded, setProductsExpanded] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPickerSearch, setProductPickerSearch] = useState('');
  const [productPickerPage, setProductPickerPage] = useState(1);
  const [productQuantities, setProductQuantities] = useState<Record<string, string>>({});
  const [availableProducts, setAvailableProducts] = useState<IProduct[]>([]);
  const [loadingProductPicker, setLoadingProductPicker] = useState(false);
  const [productPickerError, setProductPickerError] = useState<string | null>(null);
  const [loadingClients, setLoadingClients] = useState(true);
  const [loadingAddresses, setLoadingAddresses] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const [cancelConfirmOrder, setCancelConfirmOrder] = useState<OrderListItem | null>(null);
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [historyClient, setHistoryClient] = useState('');
  const [historyStatus, setHistoryStatus] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [clientPickerPage, setClientPickerPage] = useState(1);
  const [addressPickerPage, setAddressPickerPage] = useState(1);
  const [truckPickerPage, setTruckPickerPage] = useState(1);
  const [editProductPage, setEditProductPage] = useState(1);
  const [assignmentOrder, setAssignmentOrder] = useState<OrderListItem | null>(null);
  const [assignmentTruckPage, setAssignmentTruckPage] = useState(1);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [receiptPrompt, setReceiptPrompt] = useState<ReceiptPrompt | null>(null);
  const [receiptSharing, setReceiptSharing] = useState<ReceiptChannel | null>(null);
  const [receiptShareError, setReceiptShareError] = useState<string | null>(null);
  const [detailOrder, setDetailOrder] = useState<OrderListItem | null>(null);
  const [detail, setDetail] = useState<OrderDetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editingDetail, setEditingDetail] = useState(false);
  const [editItems, setEditItems] = useState<EditableOrderItem[]>([]);
  const [editProducts, setEditProducts] = useState<IProduct[]>([]);
  const [loadingEditProducts, setLoadingEditProducts] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [selectedTruckId, setSelectedTruckId] = useState<string | null>(null);
  const [truckSearch, setTruckSearch] = useState('');
  const [truckPickerOpen, setTruckPickerOpen] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(localToday());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [loadingTrucks, setLoadingTrucks] = useState(false);
  const [truckError, setTruckError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [deliveryOrder, setDeliveryOrder] = useState<OrderListItem | null>(null);
  const [deliveryChoice, setDeliveryChoice] = useState<DeliveryPaymentChoice | null>(null);
  const [deliveryAmount, setDeliveryAmount] = useState('');
  const [receiptPaymentMethod, setReceiptPaymentMethod] = useState<ReceiptPaymentMethod>('cash');
  const [mixedCashAmount, setMixedCashAmount] = useState('');
  const [deliveryAlreadyMarked, setDeliveryAlreadyMarked] = useState(false);
  const [pendingDeliveryPayment, setPendingDeliveryPayment] = useState<PendingDeliveryPayment | null>(null);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [deliveryStatusUnknown, setDeliveryStatusUnknown] = useState(false);
  const [deliverySubmitting, setDeliverySubmitting] = useState(false);

  useEffect(() => { if (!canViewOrders) router.replace('/(tabs)/profile' as any); }, [canViewOrders, router]);
  useEffect(() => { if (isDriver) router.replace('/(tabs)/logistics' as any); }, [isDriver, router]);

  const loadClients = useCallback(async () => {
    setLoadingClients(true);
    setLoadError(null);
    try {
      let page = 1;
      let result = await clientsService.getClients('', page);
      const allClients = [...result.items];
      while (allClients.length < result.total) {
        page += 1;
        result = await clientsService.getClients('', page);
        if (!result.items.length) break;
        allClients.push(...result.items);
      }
      setClients(allClients.map(({ id, businessName, taxId }) => ({ id, businessName, taxId })));
    } catch (error) {
      setLoadError(parseApiError(error, 'No se pudieron cargar los clientes.').message);
    } finally {
      setLoadingClients(false);
    }
  }, []);

  const visibleClients = useMemo(() => {
    const rawQuery = clientSearch.trim();
    const query = normalizeSearch(rawQuery);
    const taxQuery = rawQuery.replace(/\D/g, '');
    if (!query && !taxQuery) return clients;
    return clients.filter(client =>
      (!!query && normalizeSearch(client.businessName ?? '').includes(query)) ||
      (!!taxQuery && String(client.taxId ?? '').replace(/\D/g, '').includes(taxQuery)),
    );
  }, [clientSearch, clients]);

  const visibleTrucks = useMemo(() => {
    const query = normalizeSearch(truckSearch.trim());
    const assignedTrucks = trucks.filter(truck => Boolean(truck.driverId || truck.driverName));
    if (!query) return assignedTrucks;
    return assignedTrucks.filter(truck =>
      normalizeSearch(truck.licensePlate).includes(query) ||
      normalizeSearch(truck.driverName ?? '').includes(query),
    );
  }, [truckSearch, trucks]);
  const pageClients = useMemo(() => pageItems(visibleClients, clientPickerPage), [visibleClients, clientPickerPage]);
  const pageAddresses = useMemo(() => pageItems(addresses, addressPickerPage), [addresses, addressPickerPage]);
  const pageTrucks = useMemo(() => pageItems(visibleTrucks, truckPickerPage), [visibleTrucks, truckPickerPage]);
  const pageAssignmentTrucks = useMemo(() => pageItems(trucks, assignmentTruckPage), [trucks, assignmentTruckPage]);
  const pageEditProducts = useMemo(() => pageItems(editProducts, editProductPage), [editProducts, editProductPage]);
  const visiblePickerProducts = useMemo(() => {
    const query = normalizeSearch(productPickerSearch);
    if (!query) return availableProducts;
    return availableProducts.filter(product =>
      normalizeSearch(product.name).includes(query) ||
      normalizeSearch(product.sku ?? '').includes(query) ||
      normalizeSearch(product.category.name).includes(query),
    );
  }, [availableProducts, productPickerSearch]);
  const pagePickerProducts = useMemo(() => pageItems(visiblePickerProducts, productPickerPage), [visiblePickerProducts, productPickerPage]);

  const visibleHistoryOrders = useMemo(() => {
    const clientQuery = normalizeSearch(historyClient);
    return orders.filter(order => {
      const matchedClient = clients.find(client => client.id === order.customerId)?.businessName;
      return (!clientQuery || normalizeSearch(matchedClient ?? order.customerName).startsWith(clientQuery)) &&
        (!historyStatus || order.status === historyStatus);
    });
  }, [orders, clients, historyClient, historyStatus]);
  const pageHistoryOrders = useMemo(() => pageItems(visibleHistoryOrders, historyPage), [visibleHistoryOrders, historyPage]);
  useEffect(() => setHistoryPage(1), [historyClient, historyStatus]);
  useEffect(() => setClientPickerPage(1), [clientSearch]);
  useEffect(() => setAddressPickerPage(1), [addresses]);
  useEffect(() => setTruckPickerPage(1), [truckSearch]);
  useEffect(() => setAssignmentTruckPage(1), [assignmentOrder]);
  useEffect(() => setEditProductPage(1), [editProducts]);
  useEffect(() => setProductPickerPage(1), [productPickerSearch]);

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true);
    setOrderError(null);
    try {
      if (isDriver && !user?.truckId) {
        setOrders([]);
        setOrderError('Tu usuario todavía no está asignado a un camión. Pedile a un administrador que lo configure.');
      } else if (isDriver) {
        const fetched = await salesService.getOrdersByTruck(Number(user?.truckId));
        const dueTime = (order: OrderListItem) => {
          const parsed = Date.parse(order.deliveryDate || order.createdAt);
          return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
        };
        fetched.sort((a, b) => dueTime(a) - dueTime(b));
        setOrders(fetched);
      } else {
        const fetched = await salesService.getOrdersWithTruckDetails(isDriver ? { truckId: Number(user?.truckId) } : {});
        const dueTime = (order: OrderListItem) => {
          const parsed = Date.parse(order.deliveryDate || order.createdAt);
          return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
        };
        fetched.sort((a, b) => dueTime(a) - dueTime(b));
        setOrders(fetched);
      }
    } catch (error) {
      setOrderError(parseApiError(error, 'No se pudieron cargar los pedidos.').message);
    } finally {
      setLoadingOrders(false);
    }
  }, [isDriver, user?.truckId]);

  const loadTrucks = useCallback(async () => {
    setLoadingTrucks(true);
    setTruckError(null);
    try {
      setTrucks((await logisticsService.getActiveTrucks()).filter(truck => Boolean(truck.driverId || truck.driverName)));
    } catch (error) {
      setTruckError(parseApiError(error, 'No se pudieron cargar los camiones activos.').message);
    } finally {
      setLoadingTrucks(false);
    }
  }, []);

  const openOrderDetails = async (order: OrderListItem) => {
    setDetailOrder(order);
    setDetail(null);
    setDetailError(null);
    setEditingDetail(false);
    setDetailLoading(true);
    try {
      const raw = await salesService.getOrder(order.id);
      const customerId = Number(raw.customerId ?? raw.customer?.id ?? raw.clientId ?? raw.client?.id);
      const addressSnapshot = String(raw.deliveryAddressSnapshot ?? raw.deliveryAddressDescription ?? raw.addressSnapshot ?? '');
      let deliveryAddressId = Number(raw.deliveryAddressId ?? raw.deliveryAddress?.id ?? raw.addressId ?? raw.address?.id);
      if (!Number.isInteger(deliveryAddressId) || deliveryAddressId < 1) {
        deliveryAddressId = 0;
        if (Number.isInteger(customerId) && customerId > 0 && addressSnapshot) {
          const addressesForCustomer = await clientsService.getClientAddresses(String(customerId)).catch(() => []);
          const snapshot = normalizeText(addressSnapshot);
          const matches = addressesForCustomer.filter(address => {
            const street = normalizeText(address.street);
            const city = normalizeText(address.city);
            return street.length > 3 && snapshot.includes(street) && (!city || snapshot.includes(city));
          });
          if (matches.length === 1 && /^\d+$/.test(matches[0].id)) deliveryAddressId = Number(matches[0].id);
        }
      }
      const rawItems = raw.items ?? raw.orderItems ?? raw.details ?? [];
      const createdById = Number(raw.createdById ?? raw.createdBy?.id ?? raw.userId);
      setDetail({
        customerId,
        ...(Number.isInteger(deliveryAddressId) && deliveryAddressId > 0 ? { deliveryAddressId } : {}),
        deliveryAddressSnapshot: addressSnapshot,
        deliveryDate: String(raw.deliveryDate ?? ''),
        ...(Number.isInteger(createdById) && createdById > 0 ? { createdById } : {}),
        items: Array.isArray(rawItems) ? rawItems.map((item: Record<string, any>) => ({
          productId: Number(item.productId ?? item.product?.id),
          productName: String(item.productName ?? item.product?.name ?? item.name ?? 'Producto'),
          unit: String(item.unit ?? item.product?.unit ?? 'unidad'),
          quantity: Number(item.quantity ?? item.qty ?? 0),
          unitPrice: Number(item.unitPrice ?? item.price ?? 0),
        })).filter((item: EditableOrderItem) => Number.isInteger(item.productId) && item.productId > 0) : [],
      });
    } catch (error) {
      setDetailError(parseApiError(error, 'No se pudieron cargar los productos y datos del pedido.').message);
    } finally {
      setDetailLoading(false);
    }
  };

  const startOrderEdit = async () => {
    if (!detailOrder || !detail) return;
    if (detailOrder.status !== 'PENDING') return;
    if (!Number.isInteger(detail.customerId) || detail.customerId < 1) {
      setDetailError('No se pudo identificar el cliente del pedido. No se enviaron cambios.');
      return;
    }
    if (!detail.deliveryAddressId) {
      setDetailError('No se pudo identificar la dirección asociada a este pedido, por eso no se pueden guardar cambios todavía.');
      return;
    }
    setDetailError(null);
    setEditItems(detail.items);
    setEditingDetail(true);
    setLoadingEditProducts(true);
    try {
      const result = await productsService.getProducts('', [], [], true);
      setEditProducts(result.items);
    } catch (error) {
      setDetailError(parseApiError(error, 'No se pudo cargar el catálogo para agregar productos.').message);
    } finally {
      setLoadingEditProducts(false);
    }
  };

  const addProductToEdit = (product: IProduct) => {
    setEditItems(current => {
      const existing = current.find(item => item.productId === Number(product.id));
      if (existing) return current.map(item => item.productId === existing.productId ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { productId: Number(product.id), productName: product.name, unit: product.unit, quantity: 1, unitPrice: product.price }];
    });
  };

  const saveOrderEdit = async () => {
    if (!detailOrder || !detail?.deliveryAddressId) return;
    if (!editItems.length || editItems.some(item => !Number.isInteger(item.quantity) || item.quantity < 1)) {
      setDetailError('El pedido debe tener productos con cantidades mayores que cero.');
      return;
    }
    setSavingEdit(true);
    setDetailError(null);
    try {
      const updated = await salesService.updateOrder(detailOrder.id, {
        customerId: detail.customerId,
        deliveryAddressId: detail.deliveryAddressId,
        ...(detailOrder.truckId ? { truckId: Number(detailOrder.truckId) } : {}),
        ...(detail.deliveryDate ? { deliveryDate: detail.deliveryDate } : {}),
        ...(detail.createdById ? { createdById: detail.createdById } : {}),
        items: editItems.map(({ productId, quantity }) => ({ productId, quantity })),
      });
      const itemCount = editItems.reduce((sum, item) => sum + item.quantity, 0);
      setOrders(current => current.map(order => order.id === detailOrder.id ? { ...order, itemCount, total: updated.total || order.total } : order));
      setDetailOrder(current => current ? { ...current, itemCount, total: updated.total || current.total } : null);
      setDetail({ ...detail, items: editItems });
      setEditingDetail(false);
      setSuccessMessage(`${detailOrder.code} actualizado correctamente.`);
    } catch (error) {
      setDetailError(parseApiError(error, 'No se pudo guardar la edición del pedido.').message);
    } finally {
      setSavingEdit(false);
    }
  };

  useEffect(() => { if (canViewOrders && !isDriver) void loadClients(); }, [canViewOrders, isDriver, loadClients]);
  useEffect(() => { if (newClientId && canViewOrders && !isDriver) void loadClients(); }, [newClientId, canViewOrders, isDriver, loadClients]);
  useEffect(() => { if (canViewOrders && !isDriver) void loadTrucks(); }, [canViewOrders, isDriver, loadTrucks]);
  useEffect(() => { if (canViewOrders && (isDriver || mode === 'history')) void loadOrders(); }, [canViewOrders, isDriver, mode, loadOrders]);

  const chooseClient = async (clientSummary: IClientSummary) => {
    setSelectedClient(clientSummary);
    setSelectedAddress(null);
    setAddresses([]);
    setOrderError(null);
    setLoadingAddresses(true);
    try {
      const detail: IClient = await clientsService.getClientById(clientSummary.id);
      setAddresses(detail.addresses);
      setSelectedAddress(detail.addresses.find(address => address.isDefault) ?? detail.addresses[0] ?? null);
    } catch (error) {
      setOrderError(parseApiError(error, 'No se pudieron cargar las direcciones del cliente.').message);
    } finally {
      setLoadingAddresses(false);
    }
  };

  const saveNewAddress = async () => {
    if (!selectedClient || !newAddressStreet.trim()) {
      setOrderError('Ingresá la calle y altura de la dirección.');
      return;
    }
    setSavingAddress(true);
    setOrderError(null);
    try {
      const address = await clientsService.createClientAddress(selectedClient.id, {
        id: '', label: newAddressLabel.trim() || 'Otra dirección', street: newAddressStreet.trim(),
        city: newAddressCity.trim(), isDefault: false,
      });
      setAddresses(current => [...current, address]);
      setSelectedAddress(address);
      setNewAddressLabel(''); setNewAddressStreet(''); setNewAddressCity('');
      setAddingAddress(false); setAddressPickerOpen(false);
    } catch (error) {
      setOrderError(parseApiError(error, 'No se pudo guardar la nueva dirección.').message);
    } finally { setSavingAddress(false); }
  };

  useEffect(() => {
    if (!newClientId) return;
    const createdClient = clients.find(client => client.id === newClientId);
    if (createdClient && selectedClient?.id !== createdClient.id) {
      setMode('new');
      setClientPickerOpen(false);
      void chooseClient(createdClient);
    }
  }, [newClientId, clients]);

  const handleCreateOrder = async () => {
    if (!selectedClient) {
      setOrderError('Elegí un cliente para continuar.');
      return;
    }
    if (!selectedAddress) {
      setOrderError('Este cliente no tiene una dirección de entrega. Agregá una desde su ficha para crear el pedido.');
      return;
    }
    const customerId = Number(selectedClient.id);
    const deliveryAddressId = Number(selectedAddress.id);
    const orderItems = items.map(item => ({ productId: Number(item.productId), quantity: item.qty }));
    if (![customerId, deliveryAddressId, ...orderItems.map(item => item.productId)].every(id => Number.isInteger(id) && id > 0)) {
      setOrderError('Revisá los datos del cliente, la dirección y los productos e intentá de nuevo.');
      return;
    }
    if (!orderItems.length || orderItems.some(item => !Number.isInteger(item.quantity) || item.quantity < 1)) {
      setOrderError('Agregá al menos un producto y verificá sus cantidades.');
      return;
    }
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) && !Number.isNaN(Date.parse(`${deliveryDate}T00:00:00`));
    if (!validDate || deliveryDate < localToday()) {
      setOrderError('Elegí una fecha válida desde hoy en adelante.');
      return;
    }
    const truckId = !canAssignOrdersToTruck || selectedTruckId == null ? undefined : Number(selectedTruckId);
    if (truckId != null && (!Number.isInteger(truckId) || truckId < 1)) {
      setOrderError('No se pudo identificar el camión seleccionado. Actualizá la pantalla e intentá de nuevo.');
      return;
    }
    setSubmitting(true);
    setOrderError(null);
    setSuccessMessage(null);
    try {
      const assignedTruck = trucks.find(truck => truck.id === selectedTruckId);
      if (truckId) {
        const currentStock = await logisticsService.getTruckStock(String(truckId), deliveryDate);
        for (const item of orderItems) {
          const entries = currentStock.filter(stockItem => stockItem.productId === String(item.productId) && (!stockItem.deliveryDate || stockItem.deliveryDate === deliveryDate));
          const available = entries.reduce((sum, stockItem) => sum + Math.max(0, stockItem.quantityLoaded - stockItem.quantityReturned), 0);
          const missing = Math.max(0, item.quantity - available);
          if (missing > 0) {
            const existingEntry = entries[0];
            if (existingEntry) {
              await logisticsService.updateStock(String(truckId), existingEntry.id, { quantityLoaded: existingEntry.quantityLoaded + missing, quantityReturned: existingEntry.quantityReturned });
            } else {
              await logisticsService.loadProduct(String(truckId), { productId: item.productId, deliveryDate, quantityLoaded: missing });
            }
          }
        }
      }
      const created = await salesService.createOrder({ customerId, deliveryAddressId, items: orderItems, deliveryDate, ...(truckId ? { truckId } : {}) });
      clearCart();
      setProductQuantities({});
      setSelectedClient(null);
      setAddresses([]);
      setSelectedAddress(null);
      setSelectedTruckId(null);
      setDeliveryDate(localToday());
      setProductsExpanded(false);
      setSuccessMessage(`${created.id ? `Pedido ${created.code} creado.` : 'Pedido creado.'}${assignedTruck ? ` Asignado a ${assignedTruck.licensePlate}.` : ' Sin camión asignado.'}`);
      setMode('history');
    } catch (error) {
      setOrderError(parseApiError(error, 'No se pudo registrar el pedido. Tus productos siguen en el carrito; podés reintentar.').message);
    } finally {
      setSubmitting(false);
    }
  };

  const assignOrder = async (truck: Truck) => {
    if (!assignmentOrder) return;
    const truckId = Number(truck.id);
    if (!Number.isInteger(truckId) || truckId < 1) {
      setOrderError('No se pudo identificar el camión seleccionado. Actualizá la pantalla e intentá de nuevo.');
      return;
    }
    setSavingAssignment(true);
    setOrderError(null);
    setAssignmentError(null);
    setSuccessMessage(null);
    try {
      // GET /orders/{id} currently returns the address snapshot but may omit
      // deliveryAddressId, which the full PUT request requires. Resolve only
      // an unambiguous match against the customer's saved addresses.
      const rawOrder = await salesService.getOrder(assignmentOrder.id);
      let addressId = Number(rawOrder.deliveryAddressId ?? rawOrder.addressId ?? rawOrder.deliveryAddress?.id ?? rawOrder.address?.id ?? rawOrder.shippingAddressId);
      if (!Number.isInteger(addressId) || addressId < 1) {
        const customer = rawOrder.customer ?? rawOrder.client ?? {};
        const customerId = Number(rawOrder.customerId ?? rawOrder.clientId ?? customer.id ?? assignmentOrder.customerId);
        const snapshot = String(rawOrder.deliveryAddressSnapshot ?? rawOrder.deliveryAddressDescription ?? rawOrder.addressSnapshot ?? '');
        if (Number.isInteger(customerId) && customerId > 0 && snapshot) {
          const addresses = await clientsService.getClientAddresses(String(customerId));
          const normalizedSnapshot = normalizeText(snapshot);
          const matches = addresses.filter(address => {
            const street = normalizeText(address.street);
            const city = normalizeText(address.city);
            return street.length > 3 && normalizedSnapshot.includes(street) && (!city || normalizedSnapshot.includes(city));
          });
          if (matches.length === 1 && /^\d+$/.test(matches[0].id)) addressId = Number(matches[0].id);
        }
      }
      if (!Number.isInteger(addressId) || addressId < 1) {
        throw new Error('No se pudo identificar la dirección asociada al pedido para cambiar el camión.');
      }
      await salesService.assignOrderToTruck(assignmentOrder.id, truckId, addressId);
      setSuccessMessage(`${assignmentOrder.code} asignado a ${truck.licensePlate}.`);
      setOrders(current => current.map(order => order.id === assignmentOrder.id ? {
        ...order,
        truckId: truck.id,
        truckLicensePlate: truck.licensePlate,
        truckDriverName: truck.driverName,
      } : order));
      setAssignmentOrder(null);
    } catch (error) {
      setAssignmentError(parseApiError(error, 'No se pudo asignar el pedido al camión.').message);
    } finally {
      setSavingAssignment(false);
    }
  };

  const updateStatus = async (order: OrderListItem, action: 'route' | 'deliver' | 'cancel') => {
    if (action === 'route' && !order.truckId) {
      setOrderError('Asigná un camión antes de pasar el pedido a reparto.');
      return;
    }
    setUpdatingOrderId(order.id);
    setOrderError(null);
    try {
      if (action === 'route') await salesService.markInRoute(order.id);
      if (action === 'deliver') await salesService.markDelivered(order.id, { paymentMethod: 'CURRENT_ACCOUNT' });
      if (action === 'cancel') await salesService.cancelOrder(order.id);
      setCancelConfirmOrder(null);
      await loadOrders();
    } catch (error) {
      setCancelConfirmOrder(null);
      setOrderError(parseApiError(error, 'No se pudo actualizar el estado del pedido.').message);
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const openDeliveryConfirmation = (order: OrderListItem) => {
    setDeliveryOrder(order);
    setDeliveryChoice(null);
    setDeliveryAmount('');
    setReceiptPaymentMethod('cash');
    setMixedCashAmount('');
    setDeliveryAlreadyMarked(false);
    setDeliveryError(null);
    setDeliveryStatusUnknown(false);
  };

  const resumePendingDeliveryPayment = () => {
    if (!pendingDeliveryPayment) return;
    setDeliveryOrder(pendingDeliveryPayment.order);
    setDeliveryChoice(pendingDeliveryPayment.choice);
    setReceiptPaymentMethod(pendingDeliveryPayment.method);
    setMixedCashAmount(pendingDeliveryPayment.cashAmount);
    setDeliveryAmount(String(pendingDeliveryPayment.amount));
    setDeliveryError(null);
    setDeliveryAlreadyMarked(true);
    setDeliveryStatusUnknown(false);
  };

  const closeDeliveryConfirmation = () => {
    setDeliveryOrder(null);
  };

  const confirmDelivery = async () => {
    const order = deliveryOrder;
    if (!order || !deliveryChoice) {
      setDeliveryError('Elegí cómo se resolvió el pago para continuar.');
      return;
    }

    const amount = deliveryChoice === 'account'
      ? 0
      : deliveryChoice === 'full'
        ? order.total
        : Number(deliveryAmount.trim().replace(',', '.'));
    if (!Number.isFinite(order.total) || order.total <= 0) {
      setDeliveryError('El total del pedido no es válido. Revisá el detalle antes de confirmar la entrega.');
      return;
    }
    if (deliveryChoice === 'partial' && (!Number.isFinite(amount) || amount <= 0 || amount >= order.total)) {
      setDeliveryError('Ingresá un pago mayor que cero y menor que el total (' + money(order.total) + ').');
      return;
    }

    const cashPart = receiptPaymentMethod === 'mixed'
      ? Number(mixedCashAmount.trim().replace(',', '.'))
      : receiptPaymentMethod === 'cash' ? amount : 0;
    const transferPart = receiptPaymentMethod === 'mixed'
      ? amount - cashPart
      : receiptPaymentMethod === 'transfer' ? amount : 0;
    if (deliveryChoice !== 'account' && receiptPaymentMethod === 'mixed' &&
        (!Number.isFinite(cashPart) || !Number.isFinite(transferPart) || cashPart <= 0 || transferPart <= 0)) {
      setDeliveryError('Para un pago mixto, ingresá efectivo mayor que cero y menor que el importe recibido.');
      return;
    }

    const deliveryPayload: OrderDeliveryRequest = deliveryChoice === 'account' || deliveryChoice === 'partial'
      ? { paymentMethod: 'CURRENT_ACCOUNT' }
      : receiptPaymentMethod === 'cash'
        ? { paymentMethod: 'CASH' }
        : receiptPaymentMethod === 'transfer'
          ? { paymentMethod: 'TRANSFER' }
          : { paymentMethod: 'MIXED', cashAmount: cashPart, transferAmount: transferPart };

    setDeliverySubmitting(true);
    setDeliveryError(null);
    let delivered = deliveryAlreadyMarked;

    try {
      if (deliveryStatusUnknown) {
        const latest = await salesService.getOrder(order.id);
        const status = String(latest.status ?? '').toUpperCase();
        if (status === 'DELIVERED') {
          delivered = true;
          setDeliveryAlreadyMarked(true);
          setDeliveryStatusUnknown(false);
        } else if (status === 'IN_ROUTE') {
          delivered = false;
          setDeliveryStatusUnknown(false);
        } else {
          throw new Error('El pedido figura como ' + (status || 'estado desconocido') + '; no se registró el cobro. Actualizá el historial antes de continuar.');
        }
      }

      if (!delivered) {
        try {
          await salesService.markDelivered(order.id, deliveryPayload);
          delivered = true;
          setDeliveryAlreadyMarked(true);
        } catch (deliveryError) {
          try {
            const latest = await salesService.getOrder(order.id);
            if (String(latest.status ?? '').toUpperCase() !== 'DELIVERED') throw deliveryError;
            delivered = true;
            setDeliveryAlreadyMarked(true);
          } catch (verificationError) {
            if (verificationError === deliveryError) throw deliveryError;
            setDeliveryStatusUnknown(true);
            throw new Error('No se pudo confirmar si la entrega se registró. Actualizá el pedido antes de volver a intentar.');
          }
        }
      }

      if (deliveryChoice === 'partial') {
        let customerId = order.customerId;
        if (!customerId) {
          const rawOrder = await salesService.getOrder(order.id);
          const customer = rawOrder.customer ?? rawOrder.client ?? {};
          customerId = String(rawOrder.customerId ?? rawOrder.clientId ?? customer.id ?? '');
        }
        if (!customerId || !/^\d+$/.test(customerId)) {
          throw new Error('La entrega quedó registrada, pero no se pudo identificar al cliente para aplicar el pago.');
        }
        await ledgerService.registerPayment(customerId, amount, receiptPaymentMethod);
      }

      const raw = await salesService.getOrder(order.id).catch(() => ({} as Record<string, any>));
      const rawCustomer = raw.customer ?? raw.client ?? {};
      const rawItems = raw.items ?? raw.orderItems ?? raw.details ?? order.items ?? [];
      const receiptLines = Array.isArray(rawItems) ? rawItems.map((item: Record<string, any>) => ({
        name: String(item.productName ?? item.product?.name ?? item.name ?? 'Producto'),
        quantity: Number(item.quantity ?? item.qty ?? 0),
        unitPrice: Number(item.unitPrice ?? item.price ?? item.product?.unitPrice ?? 0),
      })) : [];
      const methodLabel = deliveryChoice === 'account'
        ? 'Cuenta corriente'
        : receiptPaymentMethod === 'cash'
          ? 'Efectivo'
          : receiptPaymentMethod === 'transfer'
            ? 'Transferencia'
            : 'Mixto (efectivo ' + money(cashPart) + '; transferencia ' + money(transferPart) + ')';
      const receiptData: ReceiptData = {
        code: order.code,
        date: formatDateTime(new Date().toISOString()),
        customer: String(raw.customerName ?? rawCustomer.businessName ?? rawCustomer.name ?? order.customerName),
        items: receiptLines,
        paymentMethod: methodLabel,
        total: Number(raw.totalAmount ?? raw.total ?? order.total),
        responsible: user?.fullName ?? user?.username ?? 'Usuario responsable',
      };
      let clientEmail = String(rawCustomer.email ?? raw.email ?? '');
      let clientPhone = String(rawCustomer.phone ?? raw.phone ?? '');
      const rawCustomerId = String(raw.customerId ?? raw.clientId ?? rawCustomer.id ?? order.customerId ?? '');
      if (/^\d+$/.test(rawCustomerId) && Number(rawCustomerId) > 0) {
        try {
          const clientInfo = await clientsService.getClientById(rawCustomerId);
          clientEmail ||= clientInfo.email;
          clientPhone ||= clientInfo.phone;
        } catch { /* Mantener los datos de contacto incluidos en el pedido, si los hay. */ }
      }

      setReceiptShareError(null);
      setReceiptPrompt({ data: receiptData, email: clientEmail || undefined, phone: clientPhone || undefined });
      const paidLabel = deliveryChoice === 'account'
        ? 'Quedó en cuenta corriente.'
        : deliveryChoice === 'full'
          ? 'Se registró el pago completo de ' + money(amount) + '.'
          : 'Se registró ' + money(amount) + '; el saldo de ' + money(order.total - amount) + ' quedó en cuenta corriente.';
      setSuccessMessage(order.code + ' entregado correctamente. ' + paidLabel);
      setPendingDeliveryPayment(null);
      setDeliveryOrder(null);
      setDeliveryAlreadyMarked(false);
      setDeliveryStatusUnknown(false);
      await loadOrders();
    } catch (error) {
      if (delivered) {
        setDeliveryAlreadyMarked(true);
        if (deliveryChoice === 'partial') {
          const status = (error as any)?.response?.status;
          if (status >= 400 && status < 500) {
            setPendingDeliveryPayment({ order, choice: deliveryChoice, amount, method: receiptPaymentMethod, cashAmount: mixedCashAmount });
          }
          setDeliveryError(status >= 400 && status < 500
            ? 'El pedido ya quedó entregado, pero el pago fue rechazado. Corregí los datos y reintentá el pago. ' + parseApiError(error, 'Error al registrar el pago.').message
            : 'El pedido ya quedó entregado, pero no se pudo confirmar si el pago se registró. Revisá la cuenta corriente antes de reintentar para evitar duplicarlo.');
        } else {
          setDeliveryError('La entrega quedó registrada, pero no se pudo completar el comprobante. ' + parseApiError(error, 'Error al preparar los datos del comprobante.').message);
        }
        void loadOrders();
      } else {
        setDeliveryError((deliveryStatusUnknown ? 'No se pudo confirmar el estado de la entrega. Actualizá el pedido antes de volver a intentar. ' : '') + parseApiError(error, 'No se pudo confirmar la entrega.').message);
      }
    } finally {
      setDeliverySubmitting(false);
    }
  };
  const shareReceipt = async (channel: ReceiptChannel) => {
    if (!receiptPrompt) return;
    const recipient = channel === 'email' ? receiptPrompt.email : receiptPrompt.phone;
    if (!recipient) {
      setReceiptShareError(channel === 'email' ? 'El cliente no tiene un correo registrado.' : 'El cliente no tiene un teléfono registrado.');
      return;
    }
    setReceiptSharing(channel);
    setReceiptShareError(null);
    try {
      await receiptService.generateAndShare(receiptPrompt.data, channel, recipient);
      setSuccessMessage(current => `${current ?? 'La entrega quedó registrada.'} Comprobante PDF preparado para compartir por ${channel === 'email' ? 'correo' : 'WhatsApp'} con ${recipient}.`);
      setReceiptPrompt(null);
    } catch (error) {
      setReceiptShareError(parseApiError(error, 'No se pudo preparar el comprobante PDF.').message);
    } finally { setReceiptSharing(null); }
  };

  const openCatalog = async () => {
    setProductPickerOpen(true);
    setProductPickerSearch('');
    setProductPickerError(null);
    setLoadingProductPicker(true);
    try {
      const result = await productsService.getProducts('', [], [], true);
      setAvailableProducts(result.items);
    } catch (error) {
      setProductPickerError(parseApiError(error, 'No se pudieron cargar los productos.').message);
    } finally {
      setLoadingProductPicker(false);
    }
  };
  const setPickerProductQuantity = (product: IProduct, quantity: number) => {
    const safeQuantity = Math.max(0, Math.min(999999, Math.floor(quantity)));
    const currentQuantity = items.find(item => item.productId === product.id)?.qty ?? 0;
    if (safeQuantity === 0) {
      if (currentQuantity > 0) updateQty(product.id, 0);
    } else if (currentQuantity > 0) {
      updateQty(product.id, safeQuantity);
    } else {
      addItem(product, safeQuantity);
    }
    setProductQuantities(current => ({ ...current, [product.id]: String(safeQuantity) }));
  };
  const startNewOrder = () => {
    if (mode === 'new') return;
    clearCart();
    setProductQuantities({});
    setSelectedClient(null);
    setAddresses([]);
    setSelectedAddress(null);
    setSelectedTruckId(null);
    setDeliveryDate(localToday());
    setProductsExpanded(false);
    setOrderError(null);
    setSuccessMessage(null);
    setMode('new');
  };
  const renderOrder = (order: OrderListItem) => {
    const truck = trucks.find(item => String(item.id) === order.truckId);
    const assignedTruckName = order.truckLicensePlate ?? truck?.licensePlate ?? (order.truckId ? `Camión #${order.truckId}` : 'Sin camión asignado');
    const driverName = order.truckDriverName ?? truck?.driverName;
    const canAssignTruck = canAssignOrdersToTruck && order.status === 'PENDING';
    const displayCustomer = clients.find(client => client.id === order.customerId)?.businessName || (order.customerName === 'Cliente' ? 'Cliente sin identificar' : order.customerName);
    const statusStyle = order.status === 'DELIVERED' ? styles.statusDelivered : order.status === 'CANCELLED' ? styles.statusCancelled : order.status === 'IN_ROUTE' ? styles.statusInRoute : styles.statusPending;
    const statusTextStyle = order.status === 'DELIVERED' ? styles.statusDeliveredText : order.status === 'CANCELLED' ? styles.statusCancelledText : order.status === 'IN_ROUTE' ? styles.statusInRouteText : styles.statusPendingText;
    return (
    <View key={order.id || order.code} style={styles.orderCard}>
      <View style={styles.orderTop}>
        <View style={styles.orderTitleWrap}>
          <Text style={styles.orderClient}>{displayCustomer}</Text>
        </View>
        <View style={[styles.statusPill, statusStyle]}>
          <Text style={[styles.statusText, statusTextStyle]}>
            {statusCopy[order.status] ?? order.status}
          </Text>
        </View>
      </View>
      <View style={styles.orderMeta}>
        <Text style={styles.orderMetaText}>{order.itemCount} productos</Text>
        {!!order.createdAt && <Text style={styles.orderMetaText}>{formatDate(order.createdAt)}</Text>}
        <Text style={styles.orderTotal}>{money(order.total)}</Text>
      </View>
      <View style={styles.orderTruckRow}>
        <Ionicons name="bus-outline" size={16} color={colors.primary} />
        <Text style={styles.orderTruckText}>{assignedTruckName}</Text>
        {!!driverName && <Text style={styles.orderTruckDriver}>· {driverName}</Text>}
      </View>
      {canAssignTruck && <View style={styles.truckAssignmentRow}>
        <Text style={styles.assignmentHint}>{order.truckId ? '¿Necesitás cambiar la unidad?' : '¿Quién lo va a repartir?'}</Text>
          <TouchableOpacity style={styles.assignmentButton} onPress={() => { setOrderError(null); setAssignmentError(null); setAssignmentOrder(order); }}>
          <Ionicons name={order.truckId ? 'swap-horizontal-outline' : 'bus-outline'} size={15} color={colors.primary} />
          <Text style={styles.assignmentButtonText}>{order.truckId ? 'Cambiar camión' : 'Asignar camión'}</Text>
        </TouchableOpacity>
      </View>}
      <TouchableOpacity style={styles.detailsAction} onPress={() => void openOrderDetails(order)}>
        <Ionicons name="reader-outline" size={16} color={colors.primary} />
        <Text style={styles.detailsActionText}>Ver productos y detalles</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.primary} />
      </TouchableOpacity>
      {(order.status === 'PENDING' || order.status === 'IN_ROUTE') && (
        <View style={styles.orderActions}>
          {order.status === 'PENDING' && <TouchableOpacity style={[styles.secondaryAction, !order.truckId && styles.secondaryActionDisabled]} onPress={() => void updateStatus(order, 'route')} disabled={updatingOrderId === order.id || !order.truckId}><Text style={styles.secondaryActionText}>{updatingOrderId === order.id ? 'Actualizando…' : order.truckId ? 'Pasar a reparto' : 'Asigná un camión primero'}</Text></TouchableOpacity>}
          {order.status === 'IN_ROUTE' && <TouchableOpacity style={styles.secondaryAction} onPress={() => openDeliveryConfirmation(order)} disabled={updatingOrderId === order.id}><Text style={styles.secondaryActionText}>{updatingOrderId === order.id ? 'Actualizando…' : 'Registrar entrega y pago'}</Text></TouchableOpacity>}
          {!isDriver && <TouchableOpacity style={styles.cancelAction} onPress={() => setCancelConfirmOrder(order)} disabled={updatingOrderId === order.id}>
            <Text style={styles.cancelActionText}>{updatingOrderId === order.id ? 'Actualizando…' : 'Cancelar'}</Text>
          </TouchableOpacity>}
        </View>
      )}
    </View>
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>VENTAS</Text>
          <Text style={styles.title}>{canRegisterSale && !isDriver && mode === 'new' ? 'Nuevo pedido' : 'Pedidos'}</Text>
        </View>
        <View style={styles.headingIcon}><Ionicons name={canRegisterSale && mode === 'new' ? 'receipt-outline' : 'reader-outline'} size={22} color={colors.primary} /></View>
      </View>

      {canRegisterSale && !isDriver && <View style={styles.modeSwitch}>
        <TouchableOpacity style={[styles.modeButton, mode === 'new' && styles.modeButtonActive]} onPress={startNewOrder}>
          <Text style={[styles.modeText, mode === 'new' && styles.modeTextActive]}>Nuevo pedido</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.modeButton, mode === 'history' && styles.modeButtonActive]} onPress={() => setMode('history')}>
          <Text style={[styles.modeText, mode === 'history' && styles.modeTextActive]}>Historial</Text>
        </TouchableOpacity>
      </View>}

      {isDriver || !canRegisterSale || mode === 'history' ? (
        <View style={styles.section}>
          <View style={styles.sectionHeading}>
            <View><Text style={styles.sectionTitle}>Actividad reciente</Text><Text style={styles.sectionHint}>Pedidos y entregas recientes</Text></View>
            <TouchableOpacity onPress={() => void loadOrders()} style={styles.refreshButton} accessibilityLabel="Actualizar pedidos"><Ionicons name="refresh" size={19} color={colors.primary} /></TouchableOpacity>
          </View>
          {!!successMessage && <View style={styles.successBanner}><Ionicons name="checkmark-circle" size={20} color={colors.success} /><Text style={styles.successBannerText}>{successMessage}</Text><TouchableOpacity onPress={() => setSuccessMessage(null)} accessibilityLabel="Cerrar confirmación"><Ionicons name="close" size={18} color={colors.success} /></TouchableOpacity></View>}
          {!!pendingDeliveryPayment && <View style={styles.pendingPaymentBanner}><Text style={styles.pendingPaymentText}>{pendingDeliveryPayment.order.code} ya fue entregado. Quedó pendiente registrar el pago parcial.</Text><TouchableOpacity style={styles.pendingPaymentButton} onPress={resumePendingDeliveryPayment}><Text style={styles.pendingPaymentButtonText}>Reintentar pago</Text></TouchableOpacity></View>}
          {!!orderError && <FormErrorBanner message={orderError} onRetry={loadOrders} />}
          <View style={styles.historyFilters}><Text style={styles.historyFilterTitle}>Filtrar historial</Text><TextInput style={styles.historyFilterInput} value={historyClient} onChangeText={setHistoryClient} placeholder="Cliente" placeholderTextColor={colors.textSecondary} maxLength={40} /><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.historyStatusFilters}><TouchableOpacity style={[styles.historyStatusChip, !historyStatus && styles.historyStatusChipActive]} onPress={() => setHistoryStatus(null)}><Text style={[styles.historyStatusText, !historyStatus && styles.historyStatusTextActive]}>Todos</Text></TouchableOpacity>{(Object.keys(statusCopy) as Array<keyof typeof statusCopy>).map(status => { const selected = historyStatus === status; const chipStyle = status === 'DELIVERED' ? styles.statusDelivered : status === 'CANCELLED' ? styles.statusCancelled : status === 'IN_ROUTE' ? styles.statusInRoute : styles.statusPending; const labelStyle = status === 'DELIVERED' ? styles.statusDeliveredText : status === 'CANCELLED' ? styles.statusCancelledText : status === 'IN_ROUTE' ? styles.statusInRouteText : styles.statusPendingText; return <TouchableOpacity key={status} style={[styles.historyStatusChip, selected && chipStyle]} onPress={() => setHistoryStatus(selected ? null : status)}><Text style={[styles.historyStatusText, selected && labelStyle]}>{statusCopy[status]}</Text></TouchableOpacity>; })}</ScrollView></View>
          {loadingOrders ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : pageHistoryOrders.length ? pageHistoryOrders.map(renderOrder) : <View style={styles.emptyCard}><Ionicons name="file-tray-outline" size={28} color={colors.textSecondary} /><Text style={styles.emptyTitle}>{orders.length ? 'Sin coincidencias' : 'Todavía no hay pedidos'}</Text><Text style={styles.emptyText}>{orders.length ? 'Probá cambiando los filtros del historial.' : 'Cuando registres uno, aparecerá acá.'}</Text></View>}
          <PaginationControls page={historyPage} totalItems={visibleHistoryOrders.length} onPageChange={setHistoryPage} />
        </View>
      ) : (
        <>
          {!!orderError && <FormErrorBanner message={orderError} onRetry={() => void handleCreateOrder()} disabled={submitting} />}
          {!!loadError && <FormErrorBanner message={loadError} onRetry={loadClients} />}
          <View style={styles.section}>
            <View style={styles.sectionHeading}><View><Text style={styles.sectionTitle}>1. Cliente</Text><Text style={styles.sectionHint}>Seleccioná quién recibe el pedido</Text></View></View>
            {loadingClients ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : clients.length ? (
              <TouchableOpacity style={styles.pickerButton} onPress={() => setClientPickerOpen(true)} disabled={submitting} accessibilityRole="button">
                <View style={styles.pickerButtonCopy}><Text style={[styles.pickerValue, !selectedClient && styles.pickerPlaceholder]} numberOfLines={1}>{selectedClient?.businessName ?? 'Seleccionar cliente'}</Text>{selectedClient && <Text style={styles.pickerCaption}>{selectedClient.taxId}</Text>}</View>
                <Ionicons name="chevron-down" size={19} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : <Text style={styles.emptyText}>No hay clientes disponibles.</Text>}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeading}><View><Text style={styles.sectionTitle}>2. Dirección de entrega</Text><Text style={styles.sectionHint}>Elegí dónde se entrega el pedido</Text></View></View>
            {!selectedClient ? <View style={styles.disabledStep}><Ionicons name="location-outline" size={19} color={colors.textSecondary} /><Text style={styles.disabledStepText}>Primero seleccioná un cliente para ver sus direcciones.</Text></View> : loadingAddresses ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : addresses.length ? <TouchableOpacity style={styles.addressPickerButton} onPress={() => setAddressPickerOpen(true)} disabled={submitting} accessibilityRole="button"><View style={styles.addressPickerIcon}><Ionicons name="location-outline" size={19} color={colors.primary} /></View><View style={styles.addressTextWrap}><Text style={styles.addressLabel}>{selectedAddress?.label || 'Seleccionar dirección'}</Text><Text style={styles.addressText}>{selectedAddress ? `${selectedAddress.street}${selectedAddress.city ? `, ${selectedAddress.city}` : ''}` : 'Elegí una dirección guardada'}</Text></View><Text style={styles.changeAddressText}>Cambiar</Text><Ionicons name="chevron-forward" size={18} color={colors.primary} /></TouchableOpacity> : <Text style={styles.emptyText}>Este cliente todavía no tiene una dirección guardada.</Text>}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeading}>
              <View><Text style={styles.sectionTitle}>3. Productos</Text><Text style={styles.sectionHint}>{items.length ? 'Revisá cantidades antes de enviar' : 'Elegí productos para armar el pedido'}</Text></View>
              <TouchableOpacity style={styles.addProductsButton} onPress={openCatalog} disabled={submitting}>
                <Ionicons name="add" size={17} color={colors.primary} />
                <Text style={styles.addProductsText}>{items.length ? 'Agregar más' : 'Elegir productos'}</Text>
              </TouchableOpacity>
            </View>
            {items.length > 0 && <View style={styles.cartSummary}><View style={styles.cartSummaryCopy}><Text style={styles.cartSummaryTitle}>{items.length} {items.length === 1 ? 'producto' : 'productos'} · {itemCount()} unidades</Text><Text style={styles.cartSummaryAmount}>Subtotal {money(total())}</Text></View><TouchableOpacity style={styles.cartExpandButton} onPress={() => setProductsExpanded(value => !value)}><Text style={styles.cartExpandText}>{productsExpanded ? 'Ocultar' : 'Ver productos'}</Text><Ionicons name={productsExpanded ? 'chevron-up' : 'chevron-down'} size={17} color={colors.primary} /></TouchableOpacity></View>}
            {items.length > 0 && productsExpanded ? items.map(item => <View key={item.productId} style={styles.itemCard}>
              <View style={styles.itemInfo}><Text style={styles.itemName}>{item.productName}</Text><Text style={styles.itemDetails}>{money(item.unitPrice)} · {item.unit}</Text><Text style={styles.itemSubtotal}>{money(item.subtotal)}</Text></View>
              <View style={styles.counter}><TouchableOpacity style={styles.counterButton} onPress={() => updateQty(item.productId, item.qty - 1)} disabled={submitting}><Ionicons name="remove" size={18} color={colors.primary} /></TouchableOpacity><Text style={styles.quantity}>{item.qty}</Text><TouchableOpacity style={styles.counterButton} onPress={() => updateQty(item.productId, item.qty + 1)} disabled={submitting}><Ionicons name="add" size={18} color={colors.primary} /></TouchableOpacity></View>
            </View>) : !items.length ? <View style={styles.emptyCard}><Ionicons name="basket-outline" size={28} color={colors.textSecondary} /><Text style={styles.emptyTitle}>El carrito está vacío</Text><Text style={styles.emptyText}>Elegí productos para armar el pedido.</Text></View> : null}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeading}><View><Text style={styles.sectionTitle}>4. Fecha de entrega</Text><Text style={styles.sectionHint}>Indicá cuándo debe entregarse el pedido</Text></View></View>
            <Text style={styles.dateLabel}>Fecha de entrega</Text>
            <TouchableOpacity style={styles.datePickerButton} onPress={() => setCalendarOpen(true)} disabled={submitting}><Ionicons name="calendar-outline" size={19} color={colors.primary} /><Text style={styles.datePickerValue}>{formatDate(deliveryDate)}</Text><Text style={styles.datePickerHint}>Seleccionar</Text><Ionicons name="chevron-down" size={18} color={colors.primary} /></TouchableOpacity>
            {canAssignOrdersToTruck && <>
            <Text style={styles.truckLabel}>Camión <Text style={styles.optionalLabel}>(opcional)</Text></Text>
            {!!truckError && <FormErrorBanner message={truckError} onRetry={loadTrucks} />}
            {loadingTrucks ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : trucks.length ? (
              <TouchableOpacity style={styles.pickerButton} onPress={() => setTruckPickerOpen(true)} disabled={submitting} accessibilityRole="button">
                <View style={styles.pickerButtonCopy}><Text style={[styles.pickerValue, selectedTruckId === null && styles.pickerPlaceholder]} numberOfLines={1}>{trucks.find(truck => truck.id === selectedTruckId)?.licensePlate ?? 'Sin asignar · Elegir camión (opcional)'}</Text>{selectedTruckId && <Text style={styles.pickerCaption}>{trucks.find(truck => truck.id === selectedTruckId)?.driverName ?? 'Sin chofer asignado'}</Text>}</View>
                <Ionicons name="chevron-down" size={19} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : <Text style={styles.emptyText}>No hay camiones activos. Podés enviar el pedido sin asignarlo.</Text>}
            </>}
          </View>

          <View style={styles.footer}>
            <View style={styles.totalRow}><View><Text style={styles.totalLabel}>TOTAL ESTIMADO</Text><Text style={styles.totalNote}>El importe puede variar al confirmar el pedido</Text></View><Text style={styles.totalAmount}>{money(total())}</Text></View>
            <TouchableOpacity style={[styles.submitButton, (submitting || !items.length || !selectedClient || !selectedAddress) && styles.submitDisabled]} onPress={() => void handleCreateOrder()} disabled={submitting || !items.length || !selectedClient || !selectedAddress}>
              {submitting ? <><ActivityIndicator color={colors.textInverse} /><Text style={styles.submitText}>Enviando pedido…</Text></> : <><Ionicons name="checkmark-circle-outline" size={20} color={colors.textInverse} /><Text style={styles.submitText}>Enviar pedido</Text></>}
            </TouchableOpacity>
            {!!items.length && <TouchableOpacity style={styles.clearButton} onPress={() => Alert.alert('Vaciar pedido', '¿Querés quitar todos los productos del carrito?', [{ text: 'Seguir editando', style: 'cancel' }, { text: 'Vaciar', style: 'destructive', onPress: clearCart }])} disabled={submitting}><Text style={styles.clearText}>Vaciar carrito</Text></TouchableOpacity>}
          </View>
        </>
      )}
      <Modal
        visible={!!assignmentOrder}
        transparent
        animationType="slide"
        onRequestClose={() => !savingAssignment && setAssignmentOrder(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.assignmentModal}>
            <View style={styles.assignmentModalHeader}>
              <View style={styles.assignmentModalIcon}><Ionicons name="bus-outline" size={22} color={colors.primary} /></View>
              <View style={styles.assignmentModalTitleWrap}><Text style={styles.assignmentModalTitle}>{assignmentOrder?.truckId ? 'Cambiar camión' : 'Asignar camión'}</Text><Text style={styles.assignmentModalHint}>{assignmentOrder?.code} · {assignmentOrder?.customerName}</Text></View>
              <TouchableOpacity onPress={() => setAssignmentOrder(null)} disabled={savingAssignment} accessibilityLabel="Cerrar"><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity>
            </View>
            <Text style={styles.assignmentModalDescription}>Elegí la unidad y el chofer que van a realizar esta entrega.</Text>
            {!!assignmentError && <Text style={styles.assignmentErrorText}>{assignmentError}</Text>}
            {!!truckError && <FormErrorBanner message={truckError} onRetry={loadTrucks} disabled={loadingTrucks} />}
            {loadingTrucks ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : trucks.length ? <ScrollView style={styles.assignmentTruckList} keyboardShouldPersistTaps="handled">{pageAssignmentTrucks.map(truck => {
              const selected = assignmentOrder?.truckId === truck.id;
              return <TouchableOpacity key={truck.id} style={[styles.assignmentTruckOption, selected && styles.assignmentTruckSelected]} onPress={() => void assignOrder(truck)} disabled={savingAssignment}>
                <View style={[styles.assignmentTruckIcon, selected && styles.assignmentTruckIconSelected]}><Ionicons name="bus" size={19} color={selected ? colors.textInverse : colors.primary} /></View>
                <View style={styles.assignmentTruckInfo}><Text style={styles.assignmentTruckPlate}>{truck.licensePlate || `Camión #${truck.id}`}</Text><Text style={styles.assignmentTruckDriver}>{truck.driverName ?? (truck.driverId ? `Chofer ID ${truck.driverId}` : 'Sin chofer asignado')}</Text></View>
                {savingAssignment ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name={selected ? 'checkmark-circle' : 'chevron-forward'} size={20} color={selected ? colors.success : colors.textSecondary} />}
              </TouchableOpacity>;
            })}</ScrollView> : !truckError ? <View style={styles.noTrucksCard}><Ionicons name="bus-outline" size={23} color={colors.textSecondary} /><Text style={styles.emptyText}>No hay camiones activos con chofer asignado.</Text><TouchableOpacity onPress={() => void loadTrucks()}><Text style={styles.assignmentRetry}>Volver a cargar</Text></TouchableOpacity></View> : null}
            <PaginationControls page={assignmentTruckPage} totalItems={trucks.length} onPageChange={setAssignmentTruckPage} />
            <TouchableOpacity style={styles.assignmentCloseButton} onPress={() => setAssignmentOrder(null)} disabled={savingAssignment}><Text style={styles.assignmentCloseText}>Volver al historial</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
      <Modal
        visible={!!detailOrder}
        transparent
        animationType="slide"
        onRequestClose={() => !savingEdit && setDetailOrder(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.detailsModal}>
            <View style={styles.detailsHeader}>
              <View style={styles.assignmentModalIcon}><Ionicons name="receipt-outline" size={21} color={colors.primary} /></View>
              <View style={styles.assignmentModalTitleWrap}><Text style={styles.assignmentModalTitle}>{detailOrder?.code ?? 'Pedido'}</Text><Text style={styles.assignmentModalHint}>{detailOrder?.customerName}</Text></View>
              <TouchableOpacity onPress={() => setDetailOrder(null)} disabled={savingEdit} accessibilityLabel="Cerrar detalle"><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity>
            </View>
            {!!detailError && <Text style={styles.assignmentErrorText}>{detailError}</Text>}
            {detailLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : detail ? <ScrollView style={styles.detailsScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.detailInfoGrid}>
                <View style={styles.detailInfoCell}><Text style={styles.detailLabel}>Estado</Text><Text style={styles.detailValue}>{statusCopy[detailOrder?.status ?? ''] ?? detailOrder?.status}</Text></View>
                <View style={styles.detailInfoCell}><Text style={styles.detailLabel}>Fecha</Text><Text style={styles.detailValue}>{detail.deliveryDate ? formatDate(detail.deliveryDate) : detailOrder?.createdAt ? formatDate(detailOrder.createdAt) : '—'}</Text></View>
                <View style={styles.detailInfoCell}><Text style={styles.detailLabel}>Entrega</Text><Text style={styles.detailValue}>{detail.deliveryAddressSnapshot || 'Dirección registrada'}</Text></View>
                <View style={styles.detailInfoCell}><Text style={styles.detailLabel}>Camión</Text><Text style={styles.detailValue}>{detailOrder?.truckLicensePlate ?? (detailOrder?.truckId ? `Camión #${detailOrder.truckId}` : 'Sin asignar')}</Text></View>
              </View>
              <View style={styles.detailItemsHeading}><View><Text style={styles.detailItemsTitle}>{editingDetail ? 'Editar productos' : 'Productos del pedido'}</Text><Text style={styles.detailItemsHint}>{editingDetail ? 'Ajustá las cantidades o agregá productos' : `${detail.items.length} productos · ${detail.items.reduce((sum, item) => sum + item.quantity, 0)} unidades`}</Text></View></View>
              {(editingDetail ? editItems : detail.items).map(item => <View key={item.productId} style={styles.detailProductRow}>
                <View style={styles.detailProductIcon}><Ionicons name="cube-outline" size={17} color={colors.primary} /></View>
                <View style={styles.detailProductInfo}><Text style={styles.detailProductName}>{item.productName}</Text><Text style={styles.detailProductPrice}>{money(item.unitPrice)} · {item.unit}</Text><Text style={styles.detailProductSubtotal}>{money(item.unitPrice * item.quantity)}</Text></View>
                {editingDetail ? <View style={styles.editProductControls}>
                  <TouchableOpacity style={styles.counterButton} onPress={() => setEditItems(current => current.map(currentItem => currentItem.productId === item.productId ? { ...currentItem, quantity: Math.max(1, currentItem.quantity - 1) } : currentItem))}><Ionicons name="remove" size={17} color={colors.primary} /></TouchableOpacity>
                  <Text style={styles.quantity}>{item.quantity}</Text>
                  <TouchableOpacity style={styles.counterButton} onPress={() => setEditItems(current => current.map(currentItem => currentItem.productId === item.productId ? { ...currentItem, quantity: currentItem.quantity + 1 } : currentItem))}><Ionicons name="add" size={17} color={colors.primary} /></TouchableOpacity>
                  <TouchableOpacity style={styles.removeEditProduct} onPress={() => setEditItems(current => current.filter(currentItem => currentItem.productId !== item.productId))}><Ionicons name="trash-outline" size={17} color={colors.error} /></TouchableOpacity>
                </View> : <Text style={styles.detailProductQuantity}>× {item.quantity}</Text>}
              </View>)}
              {!detail.items.length && !editingDetail && <Text style={styles.emptyText}>El pedido no tiene productos detallados en la respuesta.</Text>}
              {editingDetail && <View style={styles.addEditProductsSection}>
                <Text style={styles.detailItemsTitle}>Agregar del catálogo</Text>
                {loadingEditProducts ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : pageEditProducts.map(product => <TouchableOpacity key={product.id} style={styles.catalogProductOption} onPress={() => addProductToEdit(product)}>
                  <View style={styles.catalogProductInfo}><Text style={styles.detailProductName}>{product.name}</Text><Text style={styles.detailProductPrice}>{money(product.price)} · {product.unit}</Text></View><Ionicons name="add-circle-outline" size={21} color={colors.primary} />
                </TouchableOpacity>)}
                {!loadingEditProducts && <PaginationControls page={editProductPage} totalItems={editProducts.length} onPageChange={setEditProductPage} />}
              </View>}
              <View style={styles.detailTotalRow}><Text style={styles.detailTotalLabel}>Total informado</Text><Text style={styles.detailTotalAmount}>{money(detailOrder?.total ?? 0)}</Text></View>
            </ScrollView> : null}
            {detail && detailOrder?.status === 'PENDING' && isAdmin && <View style={styles.detailFooter}>
              {editingDetail ? <>
                <TouchableOpacity style={styles.confirmBack} onPress={() => { setEditingDetail(false); setDetailError(null); }} disabled={savingEdit}><Text style={styles.confirmBackText}>Cancelar</Text></TouchableOpacity>
                <TouchableOpacity style={styles.deliveryConfirmButton} onPress={() => void saveOrderEdit()} disabled={savingEdit}>{savingEdit ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.deliveryConfirmText}>Guardar cambios</Text>}</TouchableOpacity>
              </> : <TouchableOpacity style={styles.deliveryConfirmButton} onPress={() => void startOrderEdit()}><Ionicons name="create-outline" size={18} color={colors.textInverse} /><Text style={styles.deliveryConfirmText}>Editar pedido</Text></TouchableOpacity>}
            </View>}
          </View>
        </View>
      </Modal>
      <Modal
        visible={!!deliveryOrder}
        transparent
        animationType="slide"
        onRequestClose={() => !deliverySubmitting && closeDeliveryConfirmation()}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.deliveryModal}>
            <View style={styles.deliveryHeader}>
              <View style={styles.assignmentModalIcon}><Ionicons name="checkmark-done-outline" size={22} color={colors.primary} /></View>
              <View style={styles.assignmentModalTitleWrap}>
                <Text style={styles.assignmentModalTitle}>Confirmar entrega</Text>
                <Text style={styles.assignmentModalHint}>{deliveryOrder?.code} · {deliveryOrder?.customerName}</Text>
              </View>
              <TouchableOpacity onPress={closeDeliveryConfirmation} disabled={deliverySubmitting} accessibilityLabel="Cerrar entrega"><Ionicons name="close" size={22} color={colors.textSecondary} /></TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.deliveryBody}>
              <View style={styles.deliveryTotalRow}><Text style={styles.deliveryTotalLabel}>Total del pedido</Text><Text style={styles.deliveryTotalValue}>{money(deliveryOrder?.total ?? 0)}</Text></View>
              <Text style={styles.deliveryPrompt}>{deliveryStatusUnknown ? 'Antes de reintentar, se verificará el estado actual del pedido.' : '¿Cómo se resolvió el pago de este pedido?'}</Text>
              {([
                ['full', 'Pagó completo', `Registrar ${money(deliveryOrder?.total ?? 0)} como pago`],
                ['account', 'Cuenta corriente', 'Dejar el total pendiente en la cuenta del cliente'],
                ['partial', 'Pago parcial', 'Registrar un importe y dejar el saldo pendiente'],
              ] as [DeliveryPaymentChoice, string, string][]).map(([choice, title, subtitle]) => {
                const selected = deliveryChoice === choice;
                return <TouchableOpacity key={choice} style={[styles.deliveryChoice, selected && styles.deliveryChoiceSelected]} onPress={() => { setDeliveryChoice(choice); setDeliveryAmount(''); setMixedCashAmount(''); setDeliveryError(null); }} disabled={deliverySubmitting || deliveryAlreadyMarked} accessibilityRole="radio" accessibilityState={{ selected }}>
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? colors.primary : colors.textSecondary} />
                  <View style={styles.deliveryChoiceCopy}><Text style={styles.deliveryChoiceTitle}>{title}</Text><Text style={styles.deliveryChoiceSubtitle}>{subtitle}</Text></View>
                </TouchableOpacity>;
              })}
              {deliveryChoice === 'partial' && <View style={styles.deliveryAmountField}>
                <Text style={styles.deliveryAmountLabel}>Importe recibido</Text>
                <TextInput value={formatArgentineAmountInput(deliveryAmount)} onChangeText={value => { setDeliveryAmount(value.replace(/\D/g, '').slice(0, 11)); setDeliveryError(null); }} style={styles.deliveryAmountInput} placeholder="$ 0" keyboardType="number-pad" maxLength={14} editable={!deliverySubmitting} />
                {!!deliveryOrder && <Text style={styles.deliveryAmountHint}>Quedarán {money(Math.max(0, deliveryOrder.total - (Number(deliveryAmount.replace(',', '.')) || 0)))} en cuenta corriente.</Text>}
              </View>}
              {deliveryChoice !== null && deliveryChoice !== 'account' && <View style={styles.deliveryAmountField}><Text style={styles.deliveryAmountLabel}>Forma de pago</Text><View style={styles.paymentMethods}>{([['cash', 'Efectivo'], ['transfer', 'Transferencia'], ['mixed', 'Mixto']] as [ReceiptPaymentMethod, string][]).map(([method, label]) => <TouchableOpacity key={method} style={[styles.paymentMethod, receiptPaymentMethod === method && styles.paymentMethodActive]} onPress={() => setReceiptPaymentMethod(method)} disabled={deliverySubmitting}><Text style={[styles.paymentMethodText, receiptPaymentMethod === method && styles.paymentMethodTextActive]}>{label}</Text></TouchableOpacity>)}</View>{receiptPaymentMethod === 'mixed' && <TextInput value={formatArgentineAmountInput(mixedCashAmount)} onChangeText={value => { setMixedCashAmount(value.replace(/\D/g, '').slice(0, 11)); setDeliveryError(null); }} style={styles.deliveryAmountInput} placeholder="Importe en efectivo" keyboardType="number-pad" maxLength={14} editable={!deliverySubmitting} />}</View>}
              {!!deliveryError && <View style={styles.deliveryErrorBox}><Ionicons name="alert-circle-outline" size={18} color={colors.error} /><Text style={styles.deliveryErrorText}>{deliveryError}</Text></View>}
              <Text style={styles.deliveryFootnote}>{deliveryChoice === 'account' ? 'El importe total queda pendiente en la cuenta corriente del cliente.' : deliveryChoice ? 'La forma de pago se incluye en el comprobante PDF.' : 'Elegí una opción para ver cómo se reflejará el pago en la cuenta corriente.'}</Text>
              <View style={styles.deliveryActions}>
                <TouchableOpacity style={styles.deliveryCancelButton} onPress={closeDeliveryConfirmation} disabled={deliverySubmitting}><Text style={styles.deliveryCancelText}>Volver</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.deliveryConfirmButton, (!deliveryChoice || deliverySubmitting) && styles.deliveryConfirmDisabled]} onPress={() => void confirmDelivery()} disabled={!deliveryChoice || deliverySubmitting}>
                  {deliverySubmitting ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.deliveryConfirmText}>{deliveryStatusUnknown ? 'Verificar y reintentar' : 'Confirmar entrega'}</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal visible={!!receiptPrompt} transparent animationType="fade" onRequestClose={() => !receiptSharing && setReceiptPrompt(null)}>
        <View style={styles.modalBackdrop}><View style={styles.receiptModal}>
          <View style={styles.deliveryHeader}>
            <View style={styles.assignmentModalIcon}><Ionicons name="document-text-outline" size={22} color={colors.primary} /></View>
            <View style={styles.assignmentModalTitleWrap}><Text style={styles.assignmentModalTitle}>Entrega registrada</Text><Text style={styles.assignmentModalHint}>{receiptPrompt?.data.code} · {receiptPrompt?.data.customer}</Text></View>
          </View>
          <Text style={styles.receiptSuccessText}>El pago y la entrega se registraron correctamente.</Text>
          <Text style={styles.receiptPromptText}>¿Querés compartir el comprobante PDF con el cliente?</Text>
          {receiptPrompt?.email ? <TouchableOpacity style={styles.receiptChannelButton} onPress={() => void shareReceipt('email')} disabled={!!receiptSharing}><Ionicons name="mail-outline" size={19} color={colors.primary} /><View style={styles.receiptChannelCopy}><Text style={styles.receiptChannelTitle}>Correo electrónico</Text><Text style={styles.receiptChannelTarget}>{receiptPrompt.email}</Text></View>{receiptSharing === 'email' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="chevron-forward" size={18} color={colors.primary} />}</TouchableOpacity> : <Text style={styles.receiptNoContact}>El cliente no tiene un correo registrado.</Text>}
          {receiptPrompt?.phone ? <TouchableOpacity style={styles.receiptChannelButton} onPress={() => void shareReceipt('whatsapp')} disabled={!!receiptSharing}><Ionicons name="logo-whatsapp" size={19} color={colors.success} /><View style={styles.receiptChannelCopy}><Text style={styles.receiptChannelTitle}>WhatsApp</Text><Text style={styles.receiptChannelTarget}>{receiptPrompt.phone}</Text></View>{receiptSharing === 'whatsapp' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="chevron-forward" size={18} color={colors.primary} />}</TouchableOpacity> : <Text style={styles.receiptNoContact}>El cliente no tiene un teléfono registrado.</Text>}
          <Text style={styles.receiptHint}>{Platform.OS === 'web' ? 'Se abrirá la impresión para guardar el PDF y después el correo o WhatsApp del cliente. Adjuntá el archivo antes de enviarlo.' : 'Se abrirá el menú para compartir el PDF con el contacto elegido.'}</Text>
          {!!receiptShareError && <Text style={styles.assignmentErrorText}>{receiptShareError}</Text>}
          <TouchableOpacity style={styles.receiptDismiss} onPress={() => setReceiptPrompt(null)} disabled={!!receiptSharing}><Text style={styles.confirmBackText}>Ahora no</Text></TouchableOpacity>
        </View></View>
      </Modal>
      <Modal
        visible={!!cancelConfirmOrder}
        transparent
        animationType="fade"
        onRequestClose={() => setCancelConfirmOrder(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIcon}><Ionicons name="close-circle-outline" size={26} color={colors.error} /></View>
            <Text style={styles.confirmTitle}>Cancelar pedido</Text>
            <Text style={styles.confirmMessage}>¿Querés cancelar {cancelConfirmOrder?.code}? Esta acción cambiará su estado.</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.confirmBack} onPress={() => setCancelConfirmOrder(null)} disabled={!!updatingOrderId}>
                <Text style={styles.confirmBackText}>Volver</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmDelete} onPress={() => cancelConfirmOrder && void updateStatus(cancelConfirmOrder, 'cancel')} disabled={!!updatingOrderId}>
                {updatingOrderId ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.confirmDeleteText}>Sí, cancelar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={productPickerOpen} transparent animationType="slide" onRequestClose={() => setProductPickerOpen(false)}>
        <View style={styles.selectorBackdrop}><View style={styles.selectorModal}>
          <View style={styles.selectorHeader}><View><Text style={styles.selectorEyebrow}>PRODUCTOS</Text><Text style={styles.selectorTitle}>Agregar al pedido</Text></View><TouchableOpacity onPress={() => setProductPickerOpen(false)} accessibilityLabel="Cerrar productos"><Ionicons name="close" size={23} color={colors.textPrimary} /></TouchableOpacity></View>
          <View style={styles.selectorSearch}><Ionicons name="search-outline" size={18} color={colors.textSecondary} /><TextInput style={styles.selectorSearchInput} value={productPickerSearch} onChangeText={setProductPickerSearch} placeholder="Buscar producto, código o categoría" placeholderTextColor={colors.textSecondary} maxLength={60} autoCorrect={false} />{!!productPickerSearch && <TouchableOpacity onPress={() => setProductPickerSearch('')} accessibilityLabel="Borrar búsqueda"><Ionicons name="close-circle" size={19} color={colors.textSecondary} /></TouchableOpacity>}</View>
          {!!productPickerError && <FormErrorBanner message={productPickerError} onRetry={() => void openCatalog()} disabled={loadingProductPicker} />}
          {loadingProductPicker ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : <ScrollView keyboardShouldPersistTaps="handled">
            {pagePickerProducts.map(product => {
              const key = String(product.id);
              const inCart = items.find(item => String(item.productId) === key)?.qty ?? 0;
              const quantity = productQuantities[key] ?? String(inCart);
              return <View key={key} style={styles.selectorOption}>
                <View style={styles.selectorOptionCopy}><Text style={styles.selectorOptionTitle}>{product.name}</Text><Text style={styles.selectorOptionSub}>{product.category.name} · {money(product.price)} / {product.unit}{product.sku ? ` · ${product.sku}` : ''}</Text><Text style={styles.selectorOptionSub}>En el pedido: {inCart} {product.unit}</Text></View>
                <View style={styles.productQuantityControls}>
                  <TextInput
                    style={styles.productQuantityInput}
                    value={quantity}
                    onChangeText={value => {
                      const digits = value.replace(/\D/g, '').slice(0, 6);
                      setProductQuantities(current => ({ ...current, [key]: digits }));
                      if (digits) setPickerProductQuantity(product, Number(digits));
                    }}
                    onEndEditing={() => {
                      const parsed = Number(quantity);
                      setPickerProductQuantity(product, Number.isInteger(parsed) ? parsed : 0);
                    }}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    maxLength={6}
                    accessibilityLabel={`Cantidad de ${product.name}`}
                  />
                  <View style={styles.productQuantityStepper}>
                    <TouchableOpacity style={styles.productStepButton} onPress={() => setPickerProductQuantity(product, Math.max(0, Number(quantity || 0) - 1))} accessibilityRole="button" accessibilityLabel={`Restar una unidad de ${product.name}`}><Ionicons name="remove" size={16} color={colors.primary} /></TouchableOpacity>
                    <TouchableOpacity style={styles.productStepButton} onPress={() => setPickerProductQuantity(product, Number(quantity || 0) + 1)} accessibilityRole="button" accessibilityLabel={`Sumar una unidad de ${product.name}`}><Ionicons name="add" size={16} color={colors.primary} /></TouchableOpacity>
                  </View>
                </View>
              </View>;
            })}
            {!visiblePickerProducts.length && <Text style={styles.selectorEmpty}>{availableProducts.length ? 'No hay productos que coincidan con la búsqueda.' : 'No hay productos activos disponibles.'}</Text>}
          </ScrollView>}
          {!loadingProductPicker && <PaginationControls page={productPickerPage} totalItems={visiblePickerProducts.length} onPageChange={setProductPickerPage} />}
          {!!items.length && <Text style={styles.selectorHint}>{items.length} {items.length === 1 ? 'producto' : 'productos'} en el pedido · {money(total())}</Text>}
        </View></View>
      </Modal>
      <Modal visible={clientPickerOpen} transparent animationType="slide" onRequestClose={() => setClientPickerOpen(false)}>
        <View style={styles.selectorBackdrop}><View style={styles.selectorModal}>
          <View style={styles.selectorHeader}><View><Text style={styles.selectorEyebrow}>CLIENTES</Text><Text style={styles.selectorTitle}>Elegir cliente</Text></View><TouchableOpacity onPress={() => setClientPickerOpen(false)}><Ionicons name="close" size={23} color={colors.textPrimary} /></TouchableOpacity></View>
          <View style={styles.selectorSearch}><Ionicons name="search-outline" size={18} color={colors.textSecondary} /><TextInput style={styles.selectorSearchInput} value={clientSearch} onChangeText={setClientSearch} placeholder="Buscar por nombre o CUIT" placeholderTextColor={colors.textSecondary} maxLength={40} autoCorrect={false} />{!!clientSearch && <TouchableOpacity onPress={() => setClientSearch('')} accessibilityLabel="Borrar búsqueda"><Ionicons name="close-circle" size={19} color={colors.textSecondary} /></TouchableOpacity>}</View>
          {canManageClients && <TouchableOpacity style={styles.newClientButton} onPress={() => { setClientPickerOpen(false); router.push({ pathname: '/(tabs)/clients/form' as any, params: { returnToOrder: '1' } }); }}><Ionicons name="person-add-outline" size={18} color={colors.primary} /><Text style={styles.newClientButtonText}>Registrar cliente nuevo</Text></TouchableOpacity>}
          <ScrollView keyboardShouldPersistTaps="handled">{pageClients.map(client => <TouchableOpacity key={client.id} style={styles.selectorOption} onPress={() => { setClientPickerOpen(false); void chooseClient(client); }}><View style={styles.selectorOptionCopy}><Text style={styles.selectorOptionTitle}>{client.businessName}</Text><Text style={styles.selectorOptionSub}>{client.taxId}</Text></View>{selectedClient?.id === client.id && <Ionicons name="checkmark-circle" size={21} color={colors.primary} />}</TouchableOpacity>)}{!visibleClients.length && <Text style={styles.selectorEmpty}>No se encontraron clientes con ese criterio.</Text>}</ScrollView>
          <PaginationControls page={clientPickerPage} totalItems={visibleClients.length} onPageChange={setClientPickerPage} />
        </View></View>
      </Modal>
      <Modal visible={addressPickerOpen} transparent animationType="slide" onRequestClose={() => setAddressPickerOpen(false)}>
        <View style={styles.selectorBackdrop}><View style={styles.selectorModal}>
          <View style={styles.selectorHeader}><View><Text style={styles.selectorEyebrow}>ENTREGA</Text><Text style={styles.selectorTitle}>Elegir dirección</Text></View><TouchableOpacity onPress={() => setAddressPickerOpen(false)}><Ionicons name="close" size={23} color={colors.textPrimary} /></TouchableOpacity></View>
          <ScrollView keyboardShouldPersistTaps="handled">{pageAddresses.map(address => <TouchableOpacity key={address.id} style={styles.selectorOption} onPress={() => { setSelectedAddress(address); setAddressPickerOpen(false); }}><View style={styles.addressPickerIcon}><Ionicons name="location-outline" size={18} color={colors.primary} /></View><View style={styles.selectorOptionCopy}><Text style={styles.selectorOptionTitle}>{address.label || 'Dirección'}</Text><Text style={styles.selectorOptionSub}>{address.street}{address.city ? `, ${address.city}` : ''}</Text></View>{selectedAddress?.id === address.id && <Ionicons name="checkmark-circle" size={21} color={colors.primary} />}</TouchableOpacity>)}
            {addingAddress ? <View style={styles.newAddressForm}><Text style={styles.selectorOptionTitle}>Agregar dirección</Text><TextInput style={styles.historyFilterInput} value={newAddressLabel} onChangeText={setNewAddressLabel} placeholder="Nombre (opcional)" placeholderTextColor={colors.textSecondary} maxLength={40} /><TextInput style={styles.historyFilterInput} value={newAddressStreet} onChangeText={setNewAddressStreet} placeholder="Calle y altura" placeholderTextColor={colors.textSecondary} maxLength={120} /><TextInput style={styles.historyFilterInput} value={newAddressCity} onChangeText={setNewAddressCity} placeholder="Localidad (opcional)" placeholderTextColor={colors.textSecondary} maxLength={80} /><TouchableOpacity style={styles.submitButton} onPress={() => void saveNewAddress()} disabled={savingAddress}>{savingAddress ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.submitText}>Guardar dirección</Text>}</TouchableOpacity></View> : <TouchableOpacity style={styles.newAddressButton} onPress={() => setAddingAddress(true)}><Ionicons name="add-circle-outline" size={19} color={colors.primary} /><Text style={styles.newAddressButtonText}>Agregar otra dirección</Text></TouchableOpacity>}
          </ScrollView>
          <PaginationControls page={addressPickerPage} totalItems={addresses.length} onPageChange={setAddressPickerPage} />
        </View></View>
      </Modal>
      <DatePickerCalendar visible={calendarOpen} value={deliveryDate} minDate={localToday()} title="Fecha de entrega" onSelect={date => { setDeliveryDate(date); setOrderError(null); }} onClose={() => setCalendarOpen(false)} />
      <Modal visible={truckPickerOpen} transparent animationType="slide" onRequestClose={() => setTruckPickerOpen(false)}>
        <View style={styles.selectorBackdrop}><View style={styles.selectorModal}>
          <View style={styles.selectorHeader}><View><Text style={styles.selectorEyebrow}>ENTREGA</Text><Text style={styles.selectorTitle}>Elegir camión</Text></View><TouchableOpacity onPress={() => setTruckPickerOpen(false)}><Ionicons name="close" size={23} color={colors.textPrimary} /></TouchableOpacity></View>
          <View style={styles.selectorSearch}><Ionicons name="search-outline" size={18} color={colors.textSecondary} /><TextInput style={styles.selectorSearchInput} value={truckSearch} onChangeText={setTruckSearch} placeholder="Buscar por patente o chofer" placeholderTextColor={colors.textSecondary} maxLength={40} autoCorrect={false} />{!!truckSearch && <TouchableOpacity onPress={() => setTruckSearch('')} accessibilityLabel="Borrar búsqueda"><Ionicons name="close-circle" size={19} color={colors.textSecondary} /></TouchableOpacity>}</View>
          <ScrollView keyboardShouldPersistTaps="handled">
            <TouchableOpacity style={styles.selectorOption} onPress={() => { setSelectedTruckId(null); setTruckPickerOpen(false); setOrderError(null); }}><View style={styles.selectorOptionCopy}><Text style={styles.selectorOptionTitle}>Sin asignar</Text><Text style={styles.selectorOptionSub}>Pedido sin camión</Text></View>{selectedTruckId === null && <Ionicons name="checkmark-circle" size={21} color={colors.primary} />}</TouchableOpacity>
            {pageTrucks.map(truck => <TouchableOpacity key={truck.id} style={styles.selectorOption} onPress={() => { setSelectedTruckId(truck.id); setTruckPickerOpen(false); setOrderError(null); }}><View style={styles.selectorOptionCopy}><Text style={styles.selectorOptionTitle}>{truck.licensePlate}</Text><Text style={styles.selectorOptionSub}>{truck.driverName ?? (truck.driverId ? `Chofer ID ${truck.driverId}` : 'Sin chofer asignado')}</Text></View>{selectedTruckId === truck.id && <Ionicons name="checkmark-circle" size={21} color={colors.primary} />}</TouchableOpacity>)}
            {!!truckSearch && !visibleTrucks.length && <Text style={styles.selectorEmpty}>No se encontraron camiones.</Text>}
          </ScrollView>
          <PaginationControls page={truckPickerPage} totalItems={visibleTrucks.length} onPageChange={setTruckPickerPage} />
        </View></View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  eyebrow: { ...typography.caption, color: colors.primary, fontWeight: '700', letterSpacing: 1.5 },
  title: { ...typography.heading, color: colors.textPrimary, marginTop: 2 },
  headingIcon: { width: 46, height: 46, borderRadius: radius.md, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  modeSwitch: { flexDirection: 'row', backgroundColor: '#ECE9E7', padding: 4, borderRadius: radius.md, marginBottom: spacing.lg },
  modeButton: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: radius.sm },
  modeButtonActive: { backgroundColor: colors.surface, shadowColor: '#261B18', shadowOpacity: 0.08, shadowRadius: 5, elevation: 2 },
  modeText: { ...typography.label, color: colors.textSecondary },
  modeTextActive: { color: colors.primary, fontWeight: '700' },
  section: { marginBottom: spacing.lg },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  sectionTitle: { ...typography.body, fontWeight: '700', color: colors.textPrimary },
  sectionHint: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  disabledStep: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.background },
  disabledStepText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  historyFilters: { gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  historyFilterTitle: { ...typography.label, color: colors.textPrimary },
  historyStatusFilters: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  historyStatusChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.full, backgroundColor: colors.surface },
  historyStatusChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  historyStatusText: { ...typography.caption, color: colors.textSecondary },
  historyStatusTextActive: { color: colors.primary, fontWeight: '700' },
  historyDateRow: { flexDirection: 'row', gap: spacing.sm },
  historyFilterInput: { minHeight: 42, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.sm, ...typography.caption, color: colors.textPrimary },
  successBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.success, borderRadius: radius.md, backgroundColor: colors.successLight },
  successBannerText: { ...typography.caption, color: colors.textPrimary, flex: 1, fontWeight: '600' },
  addProductsButton: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full, backgroundColor: colors.primaryLight },
  addProductsText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  pickerButton: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  pickerButtonCopy: { flex: 1, paddingVertical: spacing.sm },
  pickerValue: { ...typography.body, color: colors.textPrimary, fontWeight: '600' },
  pickerPlaceholder: { color: colors.textSecondary, fontWeight: '400' },
  pickerCaption: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  selectorBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  selectorModal: { backgroundColor: colors.surface, maxHeight: '82%', borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  selectorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  selectorEyebrow: { ...typography.caption, color: colors.primary, letterSpacing: 1, fontWeight: '700' },
  selectorTitle: { ...typography.subheading, color: colors.textPrimary },
  selectorSearch: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  selectorSearchInput: { flex: 1, color: colors.textPrimary, ...typography.body },
  newClientButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  newClientButtonText: { ...typography.label, color: colors.primary },
  selectorOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 58, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  selectorOptionCopy: { flex: 1 },
  selectorOptionTitle: { ...typography.label, color: colors.textPrimary },
  selectorOptionSub: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  productQuantityControls: { alignItems: 'center', gap: 3 },
  productQuantityInput: { width: 54, height: 40, textAlign: 'center', ...typography.label, color: colors.textPrimary, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  productQuantityStepper: { flexDirection: 'row', gap: spacing.xs },
  productStepButton: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight, borderRadius: radius.sm },
  selectorEmpty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', padding: spacing.xl },
  selectorHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', paddingTop: spacing.md },
  pendingPaymentBanner: { padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.errorLight },
  pendingPaymentText: { ...typography.body, color: colors.error },
  pendingPaymentButton: { alignSelf: 'flex-start', marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.error },
  pendingPaymentButtonText: { ...typography.label, color: colors.textInverse },
  calendarBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.45)' },
  calendarModal: { width: '100%', maxWidth: 380, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  calendarHeading: { flex: 1, alignItems: 'center' },
  calendarEyebrow: { ...typography.caption, color: colors.textSecondary, letterSpacing: 0.8, fontWeight: '700' },
  calendarMonth: { ...typography.subheading, color: colors.textPrimary, textTransform: 'capitalize', marginTop: 2 },
  calendarArrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.primaryLight },
  calendarArrowDisabled: { backgroundColor: colors.background },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarWeekday: { width: '14.2857%', textAlign: 'center', paddingVertical: spacing.sm, ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  calendarDayCell: { width: '14.2857%', height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full },
  calendarDaySelected: { backgroundColor: colors.primary },
  calendarDayDisabled: { opacity: 0.35 },
  calendarDayText: { ...typography.body, color: colors.textPrimary },
  calendarDayTextSelected: { color: colors.textInverse, fontWeight: '800' },
  calendarDayTextDisabled: { color: colors.textDisabled },
  calendarTodayButton: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.md, borderRadius: radius.full, backgroundColor: colors.primaryLight },
  calendarTodayText: { ...typography.label, color: colors.primary },
  loader: { paddingVertical: spacing.lg },
  addressOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  newAddressForm: { gap: spacing.sm, padding: spacing.md, marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.background },
  newAddressButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md },
  newAddressButtonText: { ...typography.label, color: colors.primary, fontWeight: '700' },
  addressPickerButton: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md },
  addressPickerIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight, borderRadius: radius.sm },
  changeAddressText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  addressOptionActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  addressTextWrap: { flex: 1 },
  addressLabel: { ...typography.label, color: colors.textPrimary },
  addressText: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  defaultTag: { ...typography.caption, color: colors.primary, fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  optionalLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '400' },
  dateLabel: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', marginBottom: spacing.xs },
  deliveryDateInput: { ...typography.body, color: colors.textPrimary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginBottom: spacing.xs },
  datePickerButton: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  datePickerValue: { flex: 1, ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  datePickerHint: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  cartSummary: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  cartSummaryCopy: { flex: 1 },
  cartSummaryTitle: { ...typography.label, color: colors.textPrimary },
  cartSummaryAmount: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  cartExpandButton: { flexDirection: 'row', alignItems: 'center', gap: 3, padding: spacing.xs },
  cartExpandText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  truckLabel: { ...typography.caption, color: colors.textPrimary, fontWeight: '700', marginTop: spacing.md, marginBottom: spacing.sm },
  truckChoices: { gap: spacing.sm },
  truckChoice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  truckChoiceActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  truckChoiceInfo: { flex: 1 },
  truckChoiceText: { ...typography.label, color: colors.textPrimary },
  truckChoiceTextActive: { color: colors.primary },
  truckDriver: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  itemCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  itemInfo: { flex: 1, paddingRight: spacing.md },
  itemName: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  itemDetails: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  itemSubtotal: { ...typography.label, color: colors.primary, marginTop: spacing.xs },
  counter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  counterButton: { width: 34, height: 34, borderRadius: radius.full, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  quantity: { ...typography.label, color: colors.textPrimary, minWidth: 18, textAlign: 'center' },
  footer: { marginTop: spacing.xs },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  totalLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '800', letterSpacing: 0.6 },
  totalNote: { ...typography.caption, color: colors.textSecondary, marginTop: 3, fontSize: 10 },
  totalAmount: { ...typography.heading, color: colors.primary },
  submitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md },
  submitDisabled: { backgroundColor: colors.textDisabled },
  submitText: { ...typography.body, fontWeight: '700', color: colors.textInverse },
  clearButton: { alignItems: 'center', paddingVertical: spacing.md },
  clearText: { ...typography.caption, color: colors.error, fontWeight: '600' },
  emptyCard: { alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.xl },
  emptyTitle: { ...typography.label, color: colors.textPrimary, marginTop: spacing.sm },
  emptyText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  emptyCatalogButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginTop: spacing.md },
  emptyCatalogButtonText: { ...typography.label, color: colors.textInverse, fontWeight: '700' },
  refreshButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight, borderRadius: radius.full },
  orderCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  orderTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  orderTitleWrap: { flex: 1 },
  orderCode: { ...typography.label, color: colors.textPrimary, fontWeight: '800' },
  orderClient: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
  statusPill: { backgroundColor: colors.warningLight, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.full },
  statusPending: { backgroundColor: colors.warningLight },
  statusInRoute: { backgroundColor: colors.infoLight },
  statusDelivered: { backgroundColor: colors.successLight },
  statusCancelled: { backgroundColor: colors.errorLight },
  statusText: { ...typography.caption, color: colors.warning, fontSize: 10, fontWeight: '700' },
  statusPendingText: { color: colors.warning },
  statusInRouteText: { color: colors.info },
  statusDeliveredText: { color: colors.success },
  statusCancelledText: { color: colors.error },
  orderMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  orderMetaText: { ...typography.caption, color: colors.textSecondary },
  orderTruckRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
  orderTruckText: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  orderTruckDriver: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
  truckAssignmentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  assignmentHint: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  assignmentButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: 38, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.sm, backgroundColor: colors.primaryLight },
  assignmentButtonText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  detailsAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, marginTop: spacing.sm },
  detailsActionText: { ...typography.caption, color: colors.primary, fontWeight: '700', flex: 1 },
  orderTotal: { ...typography.label, color: colors.primary, fontWeight: '800', marginLeft: 'auto' },
  orderActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  secondaryAction: { backgroundColor: colors.primaryLight, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  secondaryActionDisabled: { opacity: 0.5 },
  secondaryActionText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  cancelAction: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  cancelActionText: { ...typography.caption, color: colors.error, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20, 12, 10, 0.48)', justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  deliveryModal: { width: '100%', maxWidth: 460, maxHeight: '88%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  receiptModal: { width: '100%', maxWidth: 460, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  receiptPromptText: { ...typography.body, color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  receiptSuccessText: { ...typography.caption, color: colors.success, fontWeight: '700', marginTop: spacing.md },
  receiptChannelButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 62, padding: spacing.md, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  receiptChannelCopy: { flex: 1 },
  receiptChannelTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  receiptChannelTarget: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  receiptNoContact: { ...typography.caption, color: colors.textSecondary, paddingVertical: spacing.sm },
  receiptHint: { ...typography.caption, color: colors.textSecondary, lineHeight: 18, marginTop: spacing.md },
  receiptDismiss: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  deliveryHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  deliveryBody: { paddingTop: spacing.md, paddingBottom: spacing.xs },
  deliveryTotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primaryLight },
  deliveryTotalLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  deliveryTotalValue: { ...typography.subheading, color: colors.primary, fontWeight: '800' },
  deliveryPrompt: { ...typography.label, color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  deliveryChoice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  deliveryChoiceSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  deliveryChoiceDisabled: { opacity: 0.65 },
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
  assignmentModal: { width: '100%', maxWidth: 460, maxHeight: '82%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  detailsModal: { width: '100%', maxWidth: 520, maxHeight: '90%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg },
  detailsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  detailsScroll: { flexGrow: 0 },
  detailInfoGrid: { gap: spacing.sm, padding: spacing.md, marginBottom: spacing.md, borderRadius: radius.md, backgroundColor: colors.background },
  detailInfoCell: { gap: 2 },
  detailLabel: { ...typography.caption, color: colors.textSecondary, fontSize: 11 },
  detailValue: { ...typography.caption, color: colors.textPrimary, fontWeight: '600' },
  detailItemsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  detailItemsTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  detailItemsHint: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  detailProductRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  detailProductIcon: { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  detailProductInfo: { flex: 1 },
  detailProductName: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' },
  detailProductPrice: { ...typography.caption, color: colors.textSecondary, marginTop: 2, fontSize: 11 },
  detailProductSubtotal: { ...typography.caption, color: colors.primary, marginTop: 2, fontWeight: '700' },
  detailProductQuantity: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  editProductControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  removeEditProduct: { padding: spacing.xs, marginLeft: spacing.xs },
  addEditProductsSection: { padding: spacing.sm, marginTop: spacing.sm, borderRadius: radius.md, backgroundColor: colors.background },
  catalogProductOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderColor: colors.border },
  catalogProductInfo: { flex: 1 },
  detailTotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.md, marginTop: spacing.md, borderTopWidth: 1, borderColor: colors.border },
  detailTotalLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  detailTotalAmount: { ...typography.subheading, color: colors.primary, fontWeight: '800' },
  detailFooter: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md, marginTop: spacing.sm },
  assignmentModalHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  assignmentModalIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  assignmentModalTitleWrap: { flex: 1 },
  assignmentModalTitle: { ...typography.subheading, color: colors.textPrimary },
  assignmentModalHint: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  assignmentModalDescription: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md, marginBottom: spacing.sm, lineHeight: 19 },
  assignmentErrorText: { ...typography.caption, color: colors.error, padding: spacing.sm, marginBottom: spacing.sm, backgroundColor: colors.errorLight, borderRadius: radius.sm },
  assignmentTruckList: { flexGrow: 0, maxHeight: 380 },
  assignmentTruckOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 66, padding: spacing.sm, marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  assignmentTruckSelected: { borderColor: colors.success, backgroundColor: colors.successLight },
  assignmentTruckIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  assignmentTruckIconSelected: { backgroundColor: colors.success },
  assignmentTruckInfo: { flex: 1 },
  assignmentTruckPlate: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  assignmentTruckDriver: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  noTrucksCard: { alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.background },
  assignmentRetry: { ...typography.caption, color: colors.primary, fontWeight: '700', padding: spacing.xs },
  assignmentCloseButton: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.xs },
  assignmentCloseText: { ...typography.label, color: colors.textSecondary },
  confirmCard: { width: '100%', maxWidth: 380, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, alignItems: 'center' },
  confirmIcon: { width: 52, height: 52, borderRadius: radius.full, backgroundColor: colors.errorLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  confirmTitle: { ...typography.heading, color: colors.textPrimary, textAlign: 'center' },
  confirmMessage: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  confirmActions: { width: '100%', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  confirmBack: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  confirmBackText: { ...typography.label, color: colors.textPrimary },
  confirmDelete: { flex: 1, backgroundColor: colors.error, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', justifyContent: 'center' },
  confirmDeleteText: { ...typography.label, color: colors.textInverse },
});
