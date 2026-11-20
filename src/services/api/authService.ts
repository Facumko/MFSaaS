/** Llamadas de autenticación del backend. */
import { client } from './client';
import { IUser } from '../../types';

export interface LoginResponse {
  token: string;
  tokenType?: string;
  expiresInSeconds?: number;
  username?: string;
}

export interface MeResponse {
  id: number | string;
  fullName?: string;
  email?: string;
  roleId?: number | string;
  roleName?: string;
  role?: string | { id?: number | string; name?: string; roleName?: string; authority?: string; permissions?: string[] };
  permissions?: string[];
  truckId?: number | string | null;
  truckLicensePlate?: string | null;
}

const ROLE_NAMES_BY_ID: Record<string, string> = {
  '1': 'OWNER',
  '2': 'ADMIN',
  '3': 'VENDEDOR',
  '4': 'REPARTIDOR',
  '5': 'DEPOSITO',
};

function resolveRoleName(profile: MeResponse): string | undefined {
  const role = profile.role;
  const roleObject = role && typeof role === 'object' ? role : undefined;
  const explicitName = profile.roleName
    ?? (typeof role === 'string' && !/^\d+$/.test(role) ? role : undefined)
    ?? roleObject?.roleName
    ?? roleObject?.name
    ?? roleObject?.authority;
  if (typeof explicitName === 'string' && explicitName.trim()) {
    return ROLE_NAMES_BY_ID[explicitName.trim()] ?? explicitName.trim();
  }
  const roleId = profile.roleId ?? roleObject?.id ?? (typeof role === 'string' ? role : undefined);
  return roleId == null ? undefined : ROLE_NAMES_BY_ID[String(roleId)];
}

function mapRole(roleName?: string, permissions: string[] = []): IUser['role'] {
  const normalized = (roleName ?? '').trim().toLowerCase();
  if (/owner|admin|propiet/.test(normalized)) return 'owner';
  if (/manager|gerent|encarg/.test(normalized)) return 'manager';
  if (/seller|sales|vendedor|venta/.test(normalized)) return 'seller';
  if (/delivery|driver|chofer|repart/.test(normalized)) return 'delivery';
  if (/depot|deposito|warehouse|almacen/.test(normalized)) return 'depot';
  // En el backend incluido, solo OWNER y ADMIN reciben users:manage.
  // Esto permite reconocer el rol aunque /auth/me no incluya roleName.
  if (permissions.includes('users:manage')) return 'owner';
  return 'unknown';
}

function normalizePermissions(permissions: string[] = []): string[] {
  const aliases: Record<string, string> = {
    'products:read': 'view_catalog',
    'products:write': 'manage_products',
    'customers:read': 'view_clients',
    'customers:write': 'manage_clients',
    'orders:read': 'view_orders',
    'orders:write': 'register_sale',
    'stock:read': 'view_stock',
    'stock:write': 'manage_stock',
    'ledger:read': 'view_clients',
    'ledger:write': 'manage_clients',
    'users:manage': 'manage_users',
  };
  return Array.from(new Set(permissions.flatMap(permission => [permission, aliases[permission]].filter((value): value is string => Boolean(value)))));
}

function unwrapProfile(payload: unknown): MeResponse {
  if (!payload || typeof payload !== 'object') throw new Error('El backend devolvió un perfil vacío.');
  const response = payload as Record<string, unknown>;
  const outerProfile = response.data && typeof response.data === 'object'
    ? response.data as Record<string, unknown>
    : response.profile && typeof response.profile === 'object'
      ? response.profile as Record<string, unknown>
      : response.user && typeof response.user === 'object'
        ? response.user as Record<string, unknown>
        : response;
  const roleValue = outerProfile.role;
  const roleObject = roleValue && typeof roleValue === 'object'
    ? roleValue as Record<string, unknown>
    : undefined;
  const permissions = Array.isArray(outerProfile.permissions)
    ? outerProfile.permissions
    : Array.isArray(roleObject?.permissions)
      ? roleObject.permissions
      : undefined;
  const profile = {
    ...outerProfile,
    permissions: Array.isArray(permissions)
      ? permissions.filter((permission): permission is string => typeof permission === 'string')
      : undefined,
  } as unknown as MeResponse;
  profile.roleName = resolveRoleName(profile);
  return profile;
}

export const authService = {
  async login(username: string, password: string): Promise<LoginResponse> {
    const response = await client.post<LoginResponse>('/auth/login', {
      username,
      password,
    });

    if (!response.data?.token) {
      const fields = response.data && typeof response.data === 'object'
        ? Object.keys(response.data).join(', ')
        : '';
      throw new Error(
        `El login respondió ${response.status}, pero no llegó el campo "token"${fields ? `. Campos recibidos: ${fields}` : '.'}`,
      );
    }

    // Algunas implementaciones ya devuelven "Bearer <jwt>" en token;
    // el interceptor agrega tokenType, así que guardamos siempre solo el JWT.
    return {
      ...response.data,
      token: response.data.token.trim().replace(/^Bearer\s+/i, ''),
      tokenType: response.data.tokenType?.replace(/\s+$/, '') || 'Bearer',
    };
  },

  async getCurrentUser(fallbackUsername = ''): Promise<IUser> {
    const response = await client.get<unknown>('/auth/me');
    const profile = unwrapProfile(response.data);
    const username = String(profile.email ?? fallbackUsername);
    return {
      id: String(profile.id ?? username),
      username,
      fullName: String(profile.fullName ?? username),
      role: mapRole(profile.roleName, profile.permissions),
      roleId: profile.roleId == null ? undefined : String(profile.roleId),
      roleName: profile.roleName,
      permissions: normalizePermissions(profile.permissions),
      tenantId: '',
      truckId: profile.truckId == null ? undefined : String(profile.truckId),
      truckLicensePlate: profile.truckLicensePlate ?? undefined,
    };
  },

  async logout(): Promise<void> {
    await client.post('/auth/logout');
  },
};
