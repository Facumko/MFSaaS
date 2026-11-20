import { client } from './client';

export interface ManagedUser {
  id: string;
  fullName: string;
  email: string;
  roleId: string;
  roleName: string;
  active: boolean;
}

export interface ManagedRole {
  id: string;
  name: string;
  description: string;
  permissions: { code: string; name: string; description: string }[];
}

export interface UserWriteRequest {
  fullName: string;
  email: string;
  roleId?: number;
  password?: string;
  active?: boolean;
}

export interface UserCreateRequest extends UserWriteRequest {
  roleId: number;
  password: string;
}

type RawUser = Record<string, any>;

function unwrapList(payload: unknown): RawUser[] {
  if (Array.isArray(payload)) return payload as RawUser[];
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  for (const key of ['items', 'content', 'data', 'users', 'roles']) {
    if (Array.isArray(obj[key])) return obj[key] as RawUser[];
  }
  return [];
}

function unwrapOne(payload: unknown): RawUser {
  if (!payload || typeof payload !== 'object') return {};
  const obj = payload as Record<string, unknown>;
  return obj.data && typeof obj.data === 'object' ? obj.data as RawUser : obj;
}

function toUser(dto: RawUser): ManagedUser {
  const role = dto.role && typeof dto.role === 'object' ? dto.role as RawUser : {};
  return {
    id: String(dto.id ?? dto.userId ?? ''),
    fullName: String(dto.fullName ?? dto.name ?? ''),
    email: String(dto.email ?? dto.username ?? ''),
    roleId: String(dto.roleId ?? role.id ?? ''),
    roleName: String(dto.roleName ?? role.name ?? role.roleName ?? ''),
    active: (dto.active ?? dto.isActive ?? true) === true || dto.active === 1 || dto.active === 'true',
  };
}

function toRole(dto: RawUser): ManagedRole {
  const rawPermissions = dto.permissions ?? dto.authorities ?? dto.permissionList ?? [];
  return {
    id: String(dto.id ?? dto.roleId ?? ''),
    name: String(dto.name ?? dto.roleName ?? dto.authority ?? ''),
    description: String(dto.description ?? dto.detail ?? ''),
    permissions: Array.isArray(rawPermissions) ? rawPermissions.map((item: any) => ({
      code: String(typeof item === 'string' ? item : item.code ?? item.name ?? item.permission ?? ''),
      name: String(typeof item === 'string' ? item : item.name ?? item.label ?? item.code ?? ''),
      description: String(typeof item === 'string' ? '' : item.description ?? item.detail ?? ''),
    })).filter((permission: { code: string }) => permission.code) : [],
  };
}

export const usersService = {
  async getRoles(): Promise<ManagedRole[]> {
    const response = await client.get<unknown>('/roles');
    return unwrapList(response.data).map(toRole).filter(role => role.id && role.name);
  },

  async getUsers(): Promise<ManagedUser[]> {
    const response = await client.get<unknown>('/users');
    return unwrapList(response.data).map(toUser);
  },

  async getUser(id: string): Promise<ManagedUser> {
    const response = await client.get<unknown>(`/users/${id}`);
    return toUser(unwrapOne(response.data));
  },

  async createUser(payload: UserCreateRequest): Promise<ManagedUser> {
    const response = await client.post<unknown>('/users', payload);
    return toUser(unwrapOne(response.data));
  },

  async updateUser(id: string, payload: UserWriteRequest): Promise<ManagedUser> {
    const response = await client.put<unknown>(`/users/${id}`, payload);
    return toUser(unwrapOne(response.data));
  },

  async activateUser(id: string): Promise<void> {
    await client.patch(`/users/${id}/activate`);
  },

  async deleteUser(id: string): Promise<void> {
    await client.delete(`/users/${id}`);
  },
};
