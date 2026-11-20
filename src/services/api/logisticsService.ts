import { client } from './client';

export interface Truck {
  id: string;
  licensePlate: string;
  driverId?: string;
  driverName?: string;
  active: boolean;
}

export interface TruckWriteRequest {
  licensePlate: string;
  driverId?: number | null;
}

export interface TruckStockItem {
  id: string;
  productId: string;
  productName: string;
  deliveryDate: string;
  quantityLoaded: number;
  quantityReturned: number;
}

export interface TruckStockCreateRequest { productId: number; deliveryDate: string; quantityLoaded: number }
export interface TruckStockUpdateRequest { quantityLoaded: number; quantityReturned: number }

type RawObject = Record<string, any>;

function unwrapList(payload: unknown, keys: string[]): RawObject[] {
  if (Array.isArray(payload)) return payload as RawObject[];
  if (!payload || typeof payload !== 'object') return [];
  const object = payload as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(object[key])) return object[key] as RawObject[];
  }
  return [];
}

function unwrapOne(payload: unknown): RawObject {
  if (!payload || typeof payload !== 'object') return {};
  const object = payload as Record<string, unknown>;
  if (object.data && typeof object.data === 'object' && !Array.isArray(object.data)) return object.data as RawObject;
  return object;
}

function toTruck(dto: RawObject): Truck {
  const driver = dto.driver && typeof dto.driver === 'object' ? dto.driver as RawObject : {};
  const active = dto.active ?? dto.isActive ?? true;
  return {
    id: String(dto.id ?? dto.truckId ?? ''),
    licensePlate: String(dto.licensePlate ?? dto.plate ?? ''),
    driverId: dto.driverId == null && driver.id == null ? undefined : String(dto.driverId ?? driver.id),
    driverName: String(dto.driverName ?? driver.fullName ?? driver.name ?? dto.userName ?? '') || undefined,
    active: active === true || active === 1 || active === 'true',
  };
}

function toStockItem(dto: RawObject): TruckStockItem {
  const product = dto.product && typeof dto.product === 'object' ? dto.product as RawObject : {};
  return {
    id: String(dto.id ?? dto.stockId ?? ''),
    productId: String(dto.productId ?? product.id ?? ''),
    productName: String(dto.productName ?? product.name ?? dto.name ?? 'Producto'),
    deliveryDate: String(dto.deliveryDate ?? dto.date ?? ''),
    quantityLoaded: Number(dto.quantityLoaded ?? dto.loadedQty ?? 0),
    quantityReturned: Number(dto.quantityReturned ?? dto.returnedQty ?? 0),
  };
}

export const logisticsService = {
  async getTrucks(): Promise<Truck[]> {
    const response = await client.get<unknown>('/trucks');
    return unwrapList(response.data, ['items', 'content', 'data', 'trucks']).map(toTruck);
  },

  async getTruck(id: string): Promise<Truck> {
    const response = await client.get<unknown>(`/trucks/${id}`);
    return toTruck(unwrapOne(response.data));
  },

  async getActiveTrucks(): Promise<Truck[]> {
    const response = await client.get<unknown>('/trucks', { params: { active: true } });
    return unwrapList(response.data, ['items', 'content', 'data', 'trucks']).map(toTruck);
  },

  async createTruck(payload: TruckWriteRequest): Promise<void> {
    await client.post('/trucks', payload);
  },

  async updateTruck(id: string, payload: TruckWriteRequest): Promise<void> {
    await client.put(`/trucks/${id}`, payload);
  },

  async activateTruck(id: string): Promise<void> {
    await client.patch(`/trucks/${id}/activate`);
  },

  async deactivateTruck(id: string): Promise<void> {
    await client.delete(`/trucks/${id}`);
  },

  async deleteTruck(id: string): Promise<void> {
    await client.delete(`/trucks/${id}`);
  },
  async getTruckStock(truckId: string, date?: string): Promise<TruckStockItem[]> {
    const response = await client.get<unknown>(`/trucks/${truckId}/stock`, { params: date ? { date } : undefined });
    return unwrapList(response.data, ['items', 'content', 'data', 'stock']).map(toStockItem);
  },

  async loadProduct(truckId: string, payload: TruckStockCreateRequest): Promise<void> {
    await client.post(`/trucks/${truckId}/stock`, payload);
  },

  async updateStock(truckId: string, stockId: string, payload: TruckStockUpdateRequest): Promise<void> {
    await client.put(`/trucks/${truckId}/stock/${stockId}`, payload);
  },

  async deleteStock(truckId: string, stockId: string): Promise<void> {
    await client.delete(`/trucks/${truckId}/stock/${stockId}`);
  },

};
