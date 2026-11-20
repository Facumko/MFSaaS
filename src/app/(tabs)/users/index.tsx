import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FormErrorBanner } from '../../../components/ui/FormErrorBanner';
import { PaginationControls, pageItems } from '../../../components/ui/PaginationControls';
import { ManagedRole, ManagedUser, UserWriteRequest, usersService } from '../../../services/api/usersService';
import { colors, radius, spacing, typography } from '../../../theme';
import { parseApiError } from '../../../utils/apiErrors';
import { usePermissions } from '../../../hooks/usePermissions';

type Draft = { fullName: string; email: string; roleId: string; password: string };
const emptyDraft: Draft = { fullName: '', email: '', roleId: '', password: '' };

export default function UsersScreen() {
  const router = useRouter();
  const { canManageUsers } = usePermissions();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [page, setPage] = useState(1);
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<ManagedUser | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [pendingAction, setPendingAction] = useState<{ user: ManagedUser; kind: 'deactivate' | 'delete' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [userResult, roleResult] = await Promise.allSettled([usersService.getUsers(), usersService.getRoles()]);
      if (userResult.status === 'rejected') throw userResult.reason;
      setUsers(userResult.value);
      setRoles(roleResult.status === 'fulfilled' ? roleResult.value : []);
    }
    catch (err) { setError(parseApiError(err, 'No se pudieron cargar los usuarios.').message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (!canManageUsers) router.replace('/(tabs)/profile' as any);
    else void load();
  }, [canManageUsers, load, router]);

  const openForm = (user?: ManagedUser) => {
    setTarget(user ?? null);
    setDraft(user ? { fullName: user.fullName, email: user.email, roleId: user.roleId, password: '' } : emptyDraft);
    setFieldErrors({}); setError(null); setModalOpen(true);
  };

  const save = async () => {
    const errors: Partial<Record<keyof Draft, string>> = {};
    const name = draft.fullName.trim(); const email = draft.email.trim(); const roleId = Number(draft.roleId.trim());
    if (!name) errors.fullName = 'Ingresá el nombre completo.';
    else if (name.length > 150) errors.fullName = 'No puede superar 150 caracteres.';
    if (!email) errors.email = 'Ingresá el correo.';
    else if (!/^\S+@\S+\.\S+$/.test(email)) errors.email = 'Ingresá un correo válido.';
    else if (email.length > 150) errors.email = 'No puede superar 150 caracteres.';
    else if (users.some(user => user.id !== target?.id && user.email.trim().toLocaleLowerCase() === email.toLocaleLowerCase())) errors.email = 'Ya existe un usuario con ese correo.';
    if ((!target && !draft.roleId.trim()) || (draft.roleId.trim() && (!Number.isInteger(roleId) || roleId < 1)) || (roles.length > 0 && !roles.some(role => role.id === draft.roleId))) errors.roleId = 'Seleccioná un rol válido.';
    if (!target && draft.password.length < 8) errors.password = 'La contraseña debe tener al menos 8 caracteres.';
    else if (draft.password && draft.password.length < 8) errors.password = 'La contraseña debe tener al menos 8 caracteres.';
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    const body: UserWriteRequest = { fullName: name, email, ...(draft.roleId.trim() ? { roleId } : {}) };
    if (draft.password) body.password = draft.password;
    setSaving(true); setError(null);
    try {
      if (target) await usersService.updateUser(target.id, body);
      else await usersService.createUser(body as UserWriteRequest & { roleId: number; password: string });
      setModalOpen(false); await load();
    } catch (err) {
      const message = parseApiError(err, 'No se pudo guardar el usuario.').message;
      if (/email.*(already|exist)|correo.*(ya existe|registrado)/i.test(message)) setFieldErrors(current => ({ ...current, email: 'Ya existe un usuario con ese correo.' }));
      else setError(message);
    }
    finally { setSaving(false); }
  };

  const deactivate = (user: ManagedUser) => setPendingAction({ user, kind: 'deactivate' });

  const activate = async (user: ManagedUser) => {
    try { setError(null); await usersService.activateUser(user.id); await load(); }
    catch (err) { setError(parseApiError(err, 'No se pudo activar el usuario.').message); }
  };

  const remove = (user: ManagedUser) => setPendingAction({ user, kind: 'delete' });

  const confirmUserAction = async () => {
    if (!pendingAction) return;
    const { user, kind } = pendingAction;
    setSaving(true); setError(null);
    try {
      if (kind === 'delete') await usersService.deleteUser(user.id);
      else {
        const roleId = Number(user.roleId);
        await usersService.updateUser(user.id, { fullName: user.fullName, email: user.email, ...(Number.isInteger(roleId) && roleId > 0 ? { roleId } : {}), active: false });
      }
      setPendingAction(null);
      await load();
    } catch (err) { setError(parseApiError(err, kind === 'delete' ? 'No se pudo eliminar el usuario.' : 'No se pudo desactivar el usuario.').message); }
    finally { setSaving(false); }
  };

  const updateDraft = (key: keyof Draft, value: string) => { setDraft(current => ({ ...current, [key]: value })); setFieldErrors(current => ({ ...current, [key]: undefined })); setError(null); };
  const selectedRole = roles.find(role => role.id === draft.roleId);
  const permissionCopy = (code: string) => {
    const key = code.toLowerCase().replace(/[:.-]/g, '_');
    const known: Record<string, string> = {
      view_catalog: 'Consultar el catálogo de productos.', manage_products: 'Crear, editar y cambiar el estado de productos.',
      manage_categories: 'Crear y administrar categorías.', manage_cart: 'Armar y modificar el carrito de pedidos.',
      register_sale: 'Registrar pedidos y ventas.', view_orders: 'Consultar pedidos y su estado.', view_stock: 'Consultar existencias.',
      manage_stock: 'Registrar movimientos y ajustar existencias.', view_clients: 'Consultar clientes y sus fichas.',
      manage_clients: 'Crear y editar clientes.', view_logistics: 'Consultar repartos y camiones.',
      manage_logistics: 'Administrar camiones, asignaciones y repartos.', view_reports: 'Consultar reportes de gestión.',
      'reports:read': 'Consultar reportes de gestión.', manage_users: 'Administrar usuarios y sus roles.', 'users:manage': 'Administrar usuarios y sus roles.',
    };
    return known[key] ?? `Acciones habilitadas por el permiso ${code}.`;
  };

  return <View style={styles.screen}>
    <View style={styles.header}><TouchableOpacity onPress={() => router.replace('/(tabs)/profile' as any)} accessibilityLabel="Volver al perfil"><Ionicons name="chevron-back" size={24} color={colors.textPrimary} /></TouchableOpacity><View><Text style={styles.eyebrow}>ADMINISTRACIÓN</Text><Text style={styles.title}>Usuarios</Text></View><TouchableOpacity style={styles.addButton} onPress={() => openForm()}><Ionicons name="person-add-outline" size={18} color={colors.textInverse} /><Text style={styles.addText}>Nuevo</Text></TouchableOpacity></View>
    {!!error && <View style={styles.banner}><FormErrorBanner message={error} onRetry={load} /></View>}
    {loading ? <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View> : <ScrollView contentContainerStyle={styles.list}>
      {pageItems(users, page).map(user => <View key={user.id} style={styles.card}>
        <View style={styles.userTop}><View style={styles.avatar}><Text style={styles.avatarText}>{user.fullName.slice(0, 1).toUpperCase() || '?'}</Text></View><View style={styles.userInfo}><Text style={styles.name}>{user.fullName}</Text><Text style={styles.email}>{user.email}</Text></View><View style={[styles.badge, user.active ? styles.activeBadge : styles.inactiveBadge]}><Text style={[styles.badgeText, user.active ? styles.activeText : styles.inactiveText]}>{user.active ? 'Activo' : 'Inactivo'}</Text></View></View>
        <Text style={styles.role}>{user.roleName || (user.roleId ? `Rol ID: ${user.roleId}` : 'Rol no informado')}</Text>
        <View style={styles.actions}><TouchableOpacity style={styles.actionButton} onPress={() => openForm(user)}><Ionicons name="create-outline" size={17} color={colors.primary} /><Text style={styles.actionText}>Editar</Text></TouchableOpacity>{user.active ? <TouchableOpacity style={styles.actionButton} onPress={() => deactivate(user)}><Ionicons name="pause-circle-outline" size={17} color={colors.warning} /><Text style={[styles.actionText, { color: colors.warning }]}>Desactivar</Text></TouchableOpacity> : <TouchableOpacity style={styles.actionButton} onPress={() => void activate(user)}><Ionicons name="checkmark-circle-outline" size={17} color={colors.success} /><Text style={[styles.actionText, { color: colors.success }]}>Activar</Text></TouchableOpacity>}<TouchableOpacity style={styles.actionButton} onPress={() => remove(user)}><Ionicons name="trash-outline" size={17} color={colors.error} /><Text style={[styles.actionText, { color: colors.error }]}>Eliminar</Text></TouchableOpacity></View>
      </View>)}
      {!users.length && <View style={styles.empty}><Ionicons name="people-outline" size={32} color={colors.textSecondary} /><Text style={styles.emptyText}>No hay usuarios para mostrar.</Text></View>}
    </ScrollView>}
    <PaginationControls page={page} totalItems={users.length} onPageChange={setPage} />
    <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => !saving && setModalOpen(false)}><View style={styles.modalBackdrop}><ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalWrap}><View style={styles.modal}>
      <View style={styles.modalHeader}><Text style={styles.modalTitle}>{target ? 'Editar usuario' : 'Crear usuario'}</Text><TouchableOpacity onPress={() => setModalOpen(false)} disabled={saving}><Ionicons name="close" size={23} color={colors.textPrimary} /></TouchableOpacity></View>
      {([['fullName', 'Nombre completo', 'Ej. María Pérez'], ['email', 'Correo', 'usuario@empresa.com']] as const).map(([key, label, placeholder]) => <View key={key} style={styles.field}><Text style={styles.label}>{label}</Text><TextInput value={draft[key]} onChangeText={value => updateDraft(key, value)} placeholder={placeholder} placeholderTextColor={colors.textDisabled} editable={!saving} autoCapitalize={key === 'email' ? 'none' : 'sentences'} style={[styles.input, !!fieldErrors[key] && styles.inputError]} />{!!fieldErrors[key] && <Text style={styles.fieldError}>{fieldErrors[key]}</Text>}</View>)}
      <View style={styles.field}><Text style={styles.label}>Rol</Text>{roles.length ? <View style={styles.roleChoices}>{roles.map(role => <TouchableOpacity key={role.id} style={[styles.roleChoice, draft.roleId === role.id && styles.roleChoiceActive]} onPress={() => updateDraft('roleId', role.id)} disabled={saving}><Text style={[styles.roleChoiceText, draft.roleId === role.id && styles.roleChoiceTextActive]}>{role.name}</Text></TouchableOpacity>)}</View> : <><TextInput value={draft.roleId} onChangeText={value => updateDraft('roleId', value)} placeholder="ID numérico del rol" placeholderTextColor={colors.textDisabled} editable={!saving} keyboardType="number-pad" style={[styles.input, !!fieldErrors.roleId && styles.inputError]} /><Text style={styles.helper}>No se pudo cargar la lista de roles. Ingresá el ID del rol.</Text></>}{!!fieldErrors.roleId && <Text style={styles.fieldError}>{fieldErrors.roleId}</Text>}{selectedRole && <View style={styles.roleDetail}><Text style={styles.roleDetailTitle}>{selectedRole.name}</Text><Text style={styles.helper}>{selectedRole.description || 'Funciones y accesos disponibles para este rol.'}</Text><Text style={styles.label}>Permisos y acciones habilitadas</Text>{selectedRole.permissions.length ? selectedRole.permissions.map(permission => <View key={permission.code} style={styles.permissionRow}><Ionicons name="checkmark-circle-outline" size={17} color={colors.success} /><View style={{ flex: 1 }}><Text style={styles.permissionTitle}>{permission.name}</Text><Text style={styles.helper}>{permission.description || permissionCopy(permission.code)}</Text></View></View>) : <Text style={styles.helper}>No hay permisos detallados para este rol.</Text>}</View>}</View>
      <View style={styles.field}><Text style={styles.label}>{target ? 'Nueva contraseña (opcional)' : 'Contraseña'}</Text><TextInput value={draft.password} onChangeText={value => updateDraft('password', value)} placeholder={target ? 'Dejar vacío para conservarla' : 'Mínimo 8 caracteres'} placeholderTextColor={colors.textDisabled} editable={!saving} secureTextEntry autoCapitalize="none" style={[styles.input, !!fieldErrors.password && styles.inputError]} />{!!fieldErrors.password && <Text style={styles.fieldError}>{fieldErrors.password}</Text>}</View>
      {!!error && <FormErrorBanner message={error} onRetry={save} />}
      <View style={styles.modalActions}><TouchableOpacity style={styles.cancelButton} onPress={() => setModalOpen(false)} disabled={saving}><Text style={styles.cancelText}>Cancelar</Text></TouchableOpacity><TouchableOpacity style={[styles.saveButton, saving && { opacity: 0.6 }]} onPress={() => void save()} disabled={saving}>{saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.saveText}>Guardar</Text>}</TouchableOpacity></View>
    </View></ScrollView></View></Modal>
    <Modal visible={!!pendingAction} transparent animationType="fade" onRequestClose={() => !saving && setPendingAction(null)}>
      <View style={styles.modalBackdrop}><View style={styles.modal}>
        <Text style={styles.modalTitle}>{pendingAction?.kind === 'delete' ? 'Eliminar usuario' : 'Desactivar usuario'}</Text>
        <Text style={styles.helper}>{pendingAction?.kind === 'delete' ? `Se eliminará ${pendingAction?.user.fullName}. Esta acción no se puede deshacer.` : `¿Querés desactivar a ${pendingAction?.user.fullName}?`}</Text>
        {!!error && <FormErrorBanner message={error} onRetry={() => void load()} />}
        <View style={styles.modalActions}><TouchableOpacity style={styles.cancelButton} onPress={() => setPendingAction(null)} disabled={saving}><Text style={styles.cancelText}>Cancelar</Text></TouchableOpacity><TouchableOpacity style={[styles.saveButton, { backgroundColor: colors.error }]} onPress={() => void confirmUserAction()} disabled={saving}>{saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.saveText}>{pendingAction?.kind === 'delete' ? 'Eliminar' : 'Desactivar'}</Text>}</TouchableOpacity></View>
      </View></View>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.lg, borderBottomWidth: 1, borderColor: colors.border }, eyebrow: { ...typography.caption, color: colors.textSecondary, letterSpacing: 1 }, title: { ...typography.heading, color: colors.textPrimary }, addButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, addText: { ...typography.label, color: colors.textInverse }, banner: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm }, center: { flex: 1, justifyContent: 'center', alignItems: 'center' }, list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxxl }, card: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, userTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, avatar: { width: 42, height: 42, borderRadius: radius.full, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' }, avatarText: { ...typography.subheading, color: colors.primary }, userInfo: { flex: 1 }, name: { ...typography.label, color: colors.textPrimary }, email: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, badge: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.full }, activeBadge: { backgroundColor: colors.successLight }, inactiveBadge: { backgroundColor: colors.errorLight }, badgeText: { ...typography.caption, fontWeight: '600' }, activeText: { color: colors.success }, inactiveText: { color: colors.error }, role: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md }, roleChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, roleChoice: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, roleChoiceActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, roleChoiceText: { ...typography.caption, color: colors.textPrimary }, roleChoiceTextActive: { color: colors.primary, fontWeight: '700' }, actions: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.xs, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderColor: colors.border }, actionButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: spacing.xs }, actionText: { ...typography.caption, color: colors.primary, fontWeight: '600' }, empty: { padding: spacing.xl, alignItems: 'center', gap: spacing.sm }, emptyText: { ...typography.body, color: colors.textSecondary },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center' }, modalScroll: { flex: 1 }, modalWrap: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg }, modal: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg }, modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg }, modalTitle: { ...typography.subheading, color: colors.textPrimary }, field: { marginBottom: spacing.md }, label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.xs }, input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, ...typography.body, color: colors.textPrimary }, inputError: { borderColor: colors.error }, fieldError: { ...typography.caption, color: colors.error, marginTop: spacing.xs }, helper: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }, roleDetail: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.background }, roleDetailTitle: { ...typography.label, color: colors.textPrimary }, permissionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm }, permissionTitle: { ...typography.caption, color: colors.textPrimary, fontWeight: '700' }, modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.md }, cancelButton: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.background }, cancelText: { ...typography.label, color: colors.textPrimary }, saveButton: { minWidth: 100, alignItems: 'center', justifyContent: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary }, saveText: { ...typography.label, color: colors.textInverse, fontWeight: '600' },
});
