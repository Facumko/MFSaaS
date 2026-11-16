import { useAuthStore } from '../store';
import { PERMISSIONS } from '../utils/constants';

export function usePermissions() {
  const { hasPermission, user } = useAuthStore();
  const role = user?.role ?? 'unknown';
  // El perfil puede conservar el nombre original del backend (p. ej. ADMIN)
  // aunque `role` haya quedado como unknown en una sesión ya iniciada.
  const roleName = `${user?.roleName ?? ''} ${role}`.trim().toLowerCase();
  const isOwner = role === 'owner' || /owner|admin|propiet/.test(roleName);
  const isManager = role === 'manager' || /manager|gerent|encarg/.test(roleName);
  const isSeller = role === 'seller' || /seller|sales|vendedor|venta/.test(roleName);
  const isDelivery = role === 'delivery' || /delivery|driver|chofer|repart/.test(roleName);
  const isAdmin = isOwner || isManager;
  // When the backend supplies explicit roles, use a consistent UI policy even
  // if its permissions array is empty or incomplete. Keep permission-based
  // behavior for legacy/unknown profiles.
  const allowed = (permission: string, roles: string[]) =>
    isAdmin || roles.includes(role) || (role === 'unknown' && hasPermission(permission));
  return {
    canViewCatalog:     allowed(PERMISSIONS.VIEW_CATALOG, ['seller']),
    canManageProducts:  allowed(PERMISSIONS.MANAGE_PRODUCTS, []),
    canManageCategories: allowed(PERMISSIONS.MANAGE_CATEGORIES, ['seller']),
    canManageCategoryStatus: isAdmin || (role === 'unknown' && hasPermission(PERMISSIONS.MANAGE_CATEGORIES)),
    canManageCart:      allowed(PERMISSIONS.MANAGE_CART, ['seller']),
    canRegisterSale:    allowed(PERMISSIONS.REGISTER_SALE, ['seller']),
    canViewOrders:      allowed(PERMISSIONS.VIEW_ORDERS, ['seller', 'delivery']),
    canViewStock:       allowed(PERMISSIONS.VIEW_STOCK, []),
    canManageStock:     allowed(PERMISSIONS.MANAGE_STOCK, []),
    canViewClients:     allowed(PERMISSIONS.VIEW_CLIENTS, ['seller']),
    canManageClients:   allowed(PERMISSIONS.MANAGE_CLIENTS, ['seller']),
    canViewLogistics:   allowed(PERMISSIONS.VIEW_LOGISTICS, ['delivery']),
    canManageLogistics: allowed(PERMISSIONS.MANAGE_LOGISTICS, []),
    canAssignOrdersToTruck: allowed(PERMISSIONS.VIEW_ORDERS, ['seller']),
    canViewReports:     allowed(PERMISSIONS.VIEW_REPORTS, []),
    canManageUsers:     isOwner || isManager || (role === 'unknown' && hasPermission(PERMISSIONS.MANAGE_USERS)),
    role,
    isOwner,
    isManager,
    isSeller,
    isDelivery,
    isAdmin,
  };
}
