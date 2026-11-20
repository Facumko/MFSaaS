import { client } from './client';

export type ApiOrderStatus = 'PENDING' | 'IN_ROUTE' | 'DELIVERED' | 'CANCELLED';
export type DeliveryPaymentMethod = 'CASH' | 'TRANSFER' | 'MIXED' | 'CURRENT_ACCOUNT';

export interface OrderDeliveryRequest {
  paymentMethod: DeliveryPaymentMethod;
  cashAmount?: number;
  transferAmount?: number;
  amountPaid?: number;
  idempotencyKey?: string;
}

export interface DeliveryAttempt {
  id: string;
  orderId: string;
  attemptNumber: number;
  status: 'IN_PROGRESS' | 'FAILED' | 'DELIVERED' | string;
  failureReason?: string;
  deliveryDate?: string;
  attemptedAt: string;
  completedAt?: string;
  recordedById?: string;
  recordedByName?: string;
}

export interface CreateOrderRequest {
  customerId: number;
  deliveryAddressId: number;
  truckId?: number;
  deliveryDate?: string;
  createdById?: number;
  items: { productId: number; quantity: number }[];
}

export interface OrderListItem {
  id: string;
  code: string;
  customerName: string;
  customerId?: string;
  status: ApiOrderStatus;
  total: number;
  amountPaid?: number;
  cashAmount?: number;
  transferAmount?: number;
  deliveredAt?: string;
  deliveredById?: string;
  itemCount: number;
  createdAt: string;
  deliveryDate?: string;
  truckId?: string;
  truckLicensePlate?: string;
  truckDriverName?: string;
  createdById?: string;
  createdByName?: string;
  deliveryAddress?: string;
  customerEmail?: string;
  customerPhone?: string;
  items?: { productId: string; productName: string; quantity: number; unit?: string }[];
}

type RawOrder = Record<string, any>;
const firstText = (...values: unknown[]) => {
  const value = values.find((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
  return value?.trim() || undefined;
};

function unwrapList(payload: unknown): RawOrder[] {
  if (Array.isArray(payload)) return payload as RawOrder[];
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ['items', 'content', 'data', 'orders', 'attempts', 'deliveryAttempts']) {
    if (Array.isArray(obj[key])) return obj[key] as RawOrder[];
    if (obj[key] && typeof obj[key] === 'object') {
      const nested = unwrapList(obj[key]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function unwrapOne(payload: unknown): RawOrder {
  if (!payload || typeof payload !== 'object') return {};
  const obj = payload as Record<string, unknown>;
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    return obj.data as RawOrder;
  }
  return obj;
}

function toOrderListItem(order: RawOrder): OrderListItem {
  const customer = order.customer ?? order.client ?? order.customerSummary ?? order.clientSummary ?? order.customerSnapshot ?? {};
  const customerDetails = customer.customer ?? customer.client ?? customer;
  const contactDetails = customerDetails.contact ?? customerDetails.contactInfo ?? customerDetails;
  const truck = order.truck ?? order.assignedTruck ?? order.deliveryTruck ?? {};
  const creator = order.createdBy ?? order.user ?? order.employee ?? {};
  const address = order.deliveryAddress ?? order.address ?? order.shippingAddress ?? {};
  const rawItems = order.items ?? order.orderItems ?? order.details;
  const items = Array.isArray(rawItems) ? rawItems : [];
  return {
    id: String(order.id ?? order.orderId ?? ''),
    code: String(order.code ?? order.orderNumber ?? order.id ?? 'Pedido'),
    customerName: String(order.customerName ?? order.customerBusinessName ?? order.clientBusinessName ?? order.customerLegalName ?? order.clientName ?? order.businessName ?? order.razonSocial ?? order.razon_social ?? customerDetails.businessName ?? customerDetails.business_name ?? customerDetails.companyName ?? customerDetails.legalName ?? customerDetails.razonSocial ?? customerDetails.razon_social ?? customerDetails.name ?? 'Cliente'),
    customerId: order.customerId == null && order.clientId == null && customer.id == null && customer.customerId == null ? undefined : String(order.customerId ?? order.clientId ?? customer.id ?? customer.customerId),
    status: String(order.status ?? order.orderStatus ?? order.state ?? 'PENDING').toUpperCase() as ApiOrderStatus,
    total: Number(order.totalAmount ?? order.total ?? order.amount ?? 0),
    amountPaid: Number(order.amountPaid ?? 0),
    cashAmount: Number(order.cashAmount ?? 0),
    transferAmount: Number(order.transferAmount ?? 0),
    deliveredAt: String(order.deliveredAt ?? '') || undefined,
    deliveredById: order.deliveredById == null ? undefined : String(order.deliveredById),
    itemCount: items.reduce((sum: number, item: RawOrder) => sum + Number(item.quantity ?? item.qty ?? 0), 0),
    createdAt: String(order.createdAt ?? order.createdDate ?? ''),
    deliveryDate: String(order.deliveryDate ?? '') || undefined,
    createdById: order.createdById == null && creator.id == null && order.userId == null ? undefined : String(order.createdById ?? creator.id ?? order.userId),
    createdByName: String(order.createdByName ?? creator.fullName ?? creator.name ?? order.userName ?? '') || undefined,
    truckId: order.truckId == null && order.assignedTruckId == null && truck.id == null && truck.truckId == null ? undefined : String(order.truckId ?? order.assignedTruckId ?? truck.id ?? truck.truckId),
    truckLicensePlate: String(order.truckLicensePlate ?? order.licensePlate ?? truck.licensePlate ?? truck.plate ?? truck.plateNumber ?? '') || undefined,
    truckDriverName: String(order.truckDriverName ?? truck.driverName ?? truck.driver?.fullName ?? truck.driver?.user?.fullName ?? truck.user?.fullName ?? '') || undefined,
    deliveryAddress: String(order.deliveryAddressSnapshot || order.deliveryAddressDescription || order.addressSnapshot || [address.label, address.streetAddress ?? address.street ?? address.address, address.city ?? address.locality].filter(Boolean).join(', ') || '') || undefined,
    customerEmail: String(order.customerEmail ?? order.clientEmail ?? customerDetails.email ?? customerDetails.mail ?? contactDetails.email ?? contactDetails.mail ?? order.email ?? '') || undefined,
    customerPhone: String(order.customerPhone ?? order.clientPhone ?? customerDetails.phone ?? customerDetails.phoneNumber ?? customerDetails.mobile ?? customerDetails.cellphone ?? contactDetails.phone ?? contactDetails.phoneNumber ?? contactDetails.mobile ?? contactDetails.cellphone ?? order.phone ?? order.phoneNumber ?? '') || undefined,
    items: items.map((item: RawOrder) => ({
      productId: String(item.productId ?? item.product?.id ?? ''),
      productName: String(item.productName ?? item.product?.name ?? item.name ?? 'Producto'),
      quantity: Number(item.quantity ?? item.qty ?? 0),
      unit: String(item.unit ?? item.product?.unit ?? '') || undefined,
    })),
  };
}

export const salesService = {
  async getOrders(filters: { customerId?: number; truckId?: number; status?: ApiOrderStatus } = {}): Promise<OrderListItem[]> {
    const response = await client.get<unknown>('/orders', { params: filters });
    return unwrapList(response.data).map(toOrderListItem);
  },

  async getOrdersWithTruckDetails(filters: { customerId?: number; truckId?: number; status?: ApiOrderStatus } = {}): Promise<OrderListItem[]> {
    const orders = await this.getOrders(filters);
    return Promise.all(orders.map(async order => {
      const needsCustomer = !order.customerName || order.customerName === 'Cliente';
      const needsTruck = !order.truckId || !order.truckLicensePlate;
      if (!order.id || (!needsCustomer && !needsTruck)) return order;
      try {
        const detail = toOrderListItem(await this.getOrder(order.id));
        return {
          ...order,
          customerName: needsCustomer ? detail.customerName : order.customerName,
          customerId: order.customerId ?? detail.customerId,
          truckId: detail.truckId ?? order.truckId,
          truckLicensePlate: detail.truckLicensePlate ?? order.truckLicensePlate,
          truckDriverName: detail.truckDriverName ?? order.truckDriverName,
        };
      } catch { return order; }
    }));
  },

  async getOrdersByTruck(truckId: number): Promise<OrderListItem[]> {
    const response = await client.get<unknown>(`/trucks/${truckId}/orders`);
    const orders = unwrapList(response.data).map(toOrderListItem);
    const detailed = await Promise.all(orders.map(async order => {
      if (!order.id) return order;
      let resolved = order;
      try {
        const detail = toOrderListItem(await this.getOrder(order.id));
        resolved = {
          ...order,
          customerName: detail.customerName !== 'Cliente' ? detail.customerName : order.customerName !== 'Cliente' ? order.customerName : 'Razón social no disponible',
          customerId: order.customerId ?? detail.customerId,
          deliveryAddress: detail.deliveryAddress ?? order.deliveryAddress,
          customerEmail: firstText(detail.customerEmail, order.customerEmail),
          customerPhone: firstText(detail.customerPhone, order.customerPhone),
          amountPaid: detail.amountPaid ?? order.amountPaid,
          cashAmount: detail.cashAmount ?? order.cashAmount,
          transferAmount: detail.transferAmount ?? order.transferAmount,
          deliveredAt: detail.deliveredAt ?? order.deliveredAt,
          deliveredById: detail.deliveredById ?? order.deliveredById,
          itemCount: detail.items?.length ? detail.items.reduce((sum, item) => sum + item.quantity, 0) : order.itemCount,
          items: detail.items?.length ? detail.items : order.items,
          truckId: order.truckId ?? detail.truckId,
        };
      }
      catch { /* Conserva los datos del endpoint de camiones. */ }
      if ((!resolved.customerEmail || !resolved.customerPhone) && resolved.customerId && /^\d+$/.test(resolved.customerId)) {
        try {
          const customer = unwrapOne((await client.get<unknown>(`/customers/${resolved.customerId}`)).data);
          const contact = customer.contact ?? customer.contactInfo ?? {};
          resolved = {
            ...resolved,
            customerEmail: firstText(resolved.customerEmail, customer.email, customer.mail, contact.email, contact.mail),
            customerPhone: firstText(resolved.customerPhone, customer.phone, customer.phoneNumber, customer.mobile, customer.cellphone, contact.phone, contact.phoneNumber, contact.mobile, contact.cellphone),
          };
        } catch { /* El endpoint del pedido sigue siendo la fuente de contactos si clientes no es accesible. */ }
      }
      return resolved;
    }));
    // The truck-specific endpoint is authoritative; include orders whose detail
    // omits truckId, while excluding any explicit assignment to another truck.
    return detailed.filter(order => !order.truckId || order.truckId === String(truckId));
  },

  async getOrder(id: string): Promise<RawOrder> {
    const response = await client.get<unknown>(`/orders/${id}`);
    return unwrapOne(response.data);
  },

  async createOrder(payload: CreateOrderRequest): Promise<OrderListItem> {
    const response = await client.post<unknown>('/orders', payload);
    return toOrderListItem(unwrapOne(response.data));
  },

  async updateOrder(id: string, payload: CreateOrderRequest): Promise<OrderListItem> {
    const response = await client.put<unknown>(`/orders/${id}`, payload);
    return toOrderListItem(unwrapOne(response.data));
  },

  /** Actualiza el pedido completo para asignarlo; el backend documenta PUT con OrderRequest obligatorio. */
  async assignOrderToTruck(id: string, truckId: number, resolvedDeliveryAddressId?: number): Promise<void> {
    const order = await this.getOrder(id);
    const customerId = Number(order.customerId ?? order.customer?.id ?? order.clientId ?? order.client?.id);
    const address = order.deliveryAddress ?? order.address ?? order.shippingAddress ?? {};
    const addressId = Number(resolvedDeliveryAddressId ?? order.deliveryAddressId ?? order.addressId ?? order.address?.id ?? order.deliveryAddress?.id ?? order.shippingAddressId ?? address.addressId);
    const rawItems = order.items ?? order.orderItems ?? order.details ?? order.lines;
    const items = Array.isArray(rawItems) ? rawItems.map((item: RawOrder) => ({
      productId: Number(item.productId ?? item.product?.id ?? item.product?.productId),
      quantity: Number(item.quantity ?? item.qty),
    })) : [];
    if (!Number.isInteger(customerId) || customerId < 1 || !Number.isInteger(addressId) || addressId < 1 || !items.length || items.some(item => !Number.isInteger(item.productId) || item.productId < 1 || !Number.isInteger(item.quantity) || item.quantity < 1)) {
      throw new Error('No se pudieron recuperar todos los datos del pedido. No se guardaron cambios para evitar modificarlo de forma incompleta.');
    }
    const createdById = Number(order.createdById ?? order.createdBy?.id ?? order.userId);
    await this.updateOrder(id, {
      customerId,
      deliveryAddressId: addressId,
      ...(Number.isInteger(createdById) && createdById > 0 ? { createdById } : {}),
      truckId,
      ...(typeof order.deliveryDate === 'string' && order.deliveryDate ? { deliveryDate: order.deliveryDate } : {}),
      items,
    });
  },

  async markInRoute(id: string): Promise<void> {
    await client.patch(`/orders/${id}/in-route`);
  },

  async markDelivered(id: string, payload: OrderDeliveryRequest): Promise<void> {
    await client.patch(`/orders/${id}/delivered`, payload);
  },

  async cancelOrder(id: string): Promise<void> {
    await client.patch(`/orders/${id}/cancelled`);
  },

  async markDeliveryAttemptFailed(id: string, reason: string, idempotencyKey: string): Promise<void> {
    await client.patch(`/orders/${id}/delivery-attempts/failed`, { reason, idempotencyKey });
  },

  async getDeliveryAttempts(id: string): Promise<DeliveryAttempt[]> {
    const response = await client.get<unknown>(`/orders/${id}/delivery-attempts`);
    return unwrapList(response.data).map(attempt => ({
      id: String(attempt.id ?? ''),
      orderId: String(attempt.orderId ?? id),
      attemptNumber: Number(attempt.attemptNumber ?? 0),
      status: String(attempt.status ?? '').toUpperCase(),
      failureReason: String(attempt.failureReason ?? '') || undefined,
      deliveryDate: String(attempt.deliveryDate ?? '') || undefined,
      attemptedAt: String(attempt.attemptedAt ?? ''),
      completedAt: String(attempt.completedAt ?? '') || undefined,
      recordedById: attempt.recordedById == null ? undefined : String(attempt.recordedById),
      recordedByName: String(attempt.recordedByName ?? '') || undefined,
    }));
  },

  async deleteOrder(id: string): Promise<void> {
    await client.delete(`/orders/${id}`);
  },
};
