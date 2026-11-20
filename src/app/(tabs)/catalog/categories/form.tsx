import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SelectField } from '../../../../components/ui/SelectField';
import { FormErrorBanner } from '../../../../components/ui/FormErrorBanner';
import { PaginationControls, pageItems } from '../../../../components/ui/PaginationControls';
import { catalogService } from '../../../../services/api/catalogService';
import { usePermissions } from '../../../../hooks/usePermissions';
import { colors, radius, spacing, typography } from '../../../../theme';
import { ICategory } from '../../../../types';
import { parseApiError } from '../../../../utils/apiErrors';

type CategoryFormData = {
  name: string;
  parentCategoryId: string; // '' = sin padre
};

export default function CategoryFormScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { canManageCategories, canManageCategoryStatus } = usePermissions();
  useEffect(() => { if (!canManageCategories) router.replace('/(tabs)/catalog' as any); }, [canManageCategories, router]);
  const { categoryId, newCategory } = useLocalSearchParams<{ categoryId?: string; newCategory?: string }>();
  const goBack = () => router.replace('/(tabs)/catalog/categories' as any);
  const isEditMode = !!categoryId && newCategory !== '1';

  const [loading, setLoading] = useState(isEditMode);
  // Antes, si este fetch fallaba, se mostraba un Alert y se hacía router.back()
  // a ciegas — eso era la "navegación errática": si no había una pantalla
  // anterior clara en el stack, back() terminaba en el catálogo o el home.
  // Ahora el error se muestra ACÁ, sin navegar, con botón para reintentar.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ICategory[]>([]);
  const [loadingCategories, setLoadingCategories] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [parentPickerOpen, setParentPickerOpen] = useState(false);
  const [parentSearch, setParentSearch] = useState('');
  const [parentPage, setParentPage] = useState(1);
  const [subcategoryMode, setSubcategoryMode] = useState(false);

  // Estado activo/inactivo de la categoría (solo relevante en edición)
  const [isActive, setIsActive] = useState(true);
  const [togglingActive, setTogglingActive] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    clearErrors,
    setFocus,
    formState: { errors, isValid, isSubmitted, touchedFields },
  } = useForm<CategoryFormData>({
    mode: 'onBlur',
    reValidateMode: 'onChange',
    shouldFocusError: true,
    defaultValues: { name: '', parentCategoryId: '' },
  });

  const selectedParentId = watch('parentCategoryId');
  const normalizedName = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const parentOptions = categories.filter(category => (!isEditMode || category.id !== categoryId) && !category.parentCategoryId);
  const visibleParentOptions = parentOptions.filter(category => normalizedName(category.name).startsWith(normalizedName(parentSearch)));
  const pageParentOptions = pageItems(visibleParentOptions, parentPage);
  useEffect(() => setParentPage(1), [parentSearch]);
  const isSubcategory = subcategoryMode;

  useFocusEffect(useCallback(() => {
    if (!canManageCategories) return;
    setParentPickerOpen(false);
    setParentSearch('');
    setSubcategoryMode(false);
    if (isEditMode && categoryId) void loadCategory(categoryId);
    else {
      reset({ name: '', parentCategoryId: '' });
      clearErrors();
      setServerError(null);
      setIsActive(true);
    }
    void loadCategories();
    // Form fields must reset each time the hidden route is opened for a new category.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageCategories, categoryId, isEditMode]));

  const loadCategories = async () => {
    try {
      setLoadingCategories(true);
      setCategoriesError(null);
      const result = await catalogService.getCategories();
      setCategories(result);
    } catch (err) {
      setCategoriesError(parseApiError(err, 'No se pudieron cargar las categorías padre.').message);
    } finally {
      setLoadingCategories(false);
    }
  };

  const loadCategory = async (id: string) => {
    try {
      setLoading(true);
      setLoadError(null);
      const category = await catalogService.getCategoryById(id);
      reset({
        name: category.name,
        parentCategoryId: category.parentCategoryId || '',
      });
      setSubcategoryMode(!!category.parentCategoryId);
      const active = category.active !== false;
      setIsActive(active);
    } catch (err) {
      setLoadError('No se pudo cargar la categoría. Revisá tu conexión e intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (value: boolean) => {
    if (!isEditMode || !categoryId) return;
    const previous = isActive;
    setIsActive(value); // feedback optimista
    setStatusError(null);
    setTogglingActive(true);
    try {
      if (value) {
        await catalogService.activateCategory(categoryId);
      } else {
        await catalogService.deactivateCategory(categoryId);
      }
    } catch (err) {
      setIsActive(previous); // revierte si falló
      setStatusError(parseApiError(err, `No se pudo ${value ? 'activar' : 'desactivar'} la categoría.`).message);
    } finally {
      setTogglingActive(false);
    }
  };

  const onSubmit = async (data: CategoryFormData) => {
    if (isSubcategory && !data.parentCategoryId) {
      setServerError('Elegí la categoría principal de esta subcategoría.');
      setParentPickerOpen(true);
      return;
    }
    if (!isEditMode && (loadingCategories || categoriesError)) {
      setServerError('Cargá las categorías existentes antes de crear una nueva.');
      return;
    }
    const duplicate = categories.some(category => (!isEditMode || category.id !== categoryId) && normalizedName(category.name) === normalizedName(data.name));
    if (duplicate) {
      setError('name', { type: 'validate', message: 'Ya existe una categoría con ese nombre.' });
      return;
    }
    try {
      setSubmitting(true);
      setServerError(null);
      clearErrors();

      const payload: Partial<ICategory> = {
        name: data.name.trim(),
        parentCategoryId: data.parentCategoryId || undefined,
      };

      if (isEditMode && categoryId) {
        await catalogService.updateCategory(categoryId, payload);
      } else {
        await catalogService.createCategory(payload);
      }

      goBack();
    } catch (err) {
      const parsed = parseApiError(err, 'No se pudo guardar la categoría. Revisá los datos e intentá de nuevo.');
      if (parsed.fields.name) setError('name', { type: 'server', message: parsed.fields.name });
      setServerError(parsed.fields.name ? null : parsed.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={goBack}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Editar categoría</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={[styles.centerContent, { flex: 1, paddingHorizontal: spacing.xl }]}>
          <Ionicons name="alert-circle" size={48} color={colors.error} />
          <Text style={styles.errorTitle}>{loadError}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => categoryId && loadCategory(categoryId)}
          >
            <Text style={styles.retryButtonText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={goBack}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isEditMode ? 'Editar categoría' : 'Crear categoría'}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing.xl + spacing.lg }}
      >
        <View style={styles.formContainer}>
          {/* Estado activo/inactivo (solo en edición) */}
          {isEditMode && canManageCategoryStatus && (
            <View style={styles.statusRow}>
              <View style={{ flex: 1 }}>
                <View style={styles.statusLabelRow}>
                  <Text style={styles.label}>Categoría activa</Text>
                  {!isActive && (
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusBadgeText}>Inactiva</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.helperText}>
                  {isActive
                    ? 'Visible en el catálogo y disponible para nuevos productos.'
                    : 'Oculta del catálogo. Los productos existentes no se eliminan.'}
                </Text>
              </View>
              {togglingActive ? (
                <ActivityIndicator color={colors.primary} style={{ marginLeft: spacing.md }} />
              ) : (
                <Switch
                  value={isActive}
                  onValueChange={handleToggleActive}
                  disabled={submitting || togglingActive}
                  trackColor={{ false: colors.border, true: colors.primaryLight }}
                  thumbColor={isActive ? colors.primary : colors.textDisabled}
                  style={{ marginLeft: spacing.md }}
                />
              )}
            </View>
          )}
          {!!statusError && <FormErrorBanner message={statusError} onRetry={() => handleToggleActive(!isActive)} />}

          {/* Name */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Nombre *</Text>
            <Controller
              control={control}
              name="name"
              rules={{ required: 'El nombre es obligatorio.', validate: value => !!value.trim() || 'El nombre no puede estar vacío.', minLength: { value: 2, message: 'Usá al menos 2 caracteres.' }, maxLength: { value: 50, message: 'No puede superar 50 caracteres.' } }}
              render={({ field: { value, onChange, onBlur, ref } }) => (
                <TextInput
                  ref={ref}
                  style={[styles.input, errors.name ? styles.inputError : touchedFields.name && styles.inputValid]}
                  placeholder="Ej: Carnes rojas"
                  placeholderTextColor={colors.textSecondary}
                  value={value}
                  onChangeText={value => { if (value.length > 50) Alert.alert('Límite alcanzado', 'El nombre de la categoría admite hasta 50 caracteres.'); onChange(value.slice(0, 50)); setServerError(null); }}
                  onBlur={onBlur}
                  editable={!submitting}
                />
              )}
            />
            {errors.name && <Text style={styles.errorText}>{errors.name.message}</Text>}
          </View>

          {/* Root/subcategory selection */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Tipo de categoría</Text>
            <Text style={styles.helperText}>Elegí si será una categoría principal o una subcategoría.</Text>
            <View style={styles.kindChoices}>
              <TouchableOpacity style={[styles.kindChoice, !isSubcategory && styles.kindChoiceActive]} onPress={() => { setSubcategoryMode(false); setValue('parentCategoryId', '', { shouldDirty: true }); setParentPickerOpen(false); }} disabled={submitting}>
                <Text style={[styles.kindChoiceText, !isSubcategory && styles.kindChoiceTextActive]}>Categoría principal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.kindChoice, isSubcategory && styles.kindChoiceActive]} onPress={() => { setSubcategoryMode(true); setParentPickerOpen(true); }} disabled={submitting}>
                <Text style={[styles.kindChoiceText, isSubcategory && styles.kindChoiceTextActive]}>Subcategoría</Text>
              </TouchableOpacity>
            </View>
            {loadingCategories ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} />
            ) : categoriesError ? (
              <FormErrorBanner message={categoriesError} onRetry={loadCategories} />
            ) : isSubcategory && <View>
              <TouchableOpacity style={styles.parentDropdown} onPress={() => setParentPickerOpen(open => !open)} disabled={submitting} accessibilityRole="button" accessibilityState={{ expanded: parentPickerOpen }}>
                <Text style={styles.parentDropdownText}>{parentOptions.find(category => category.id === selectedParentId)?.name ?? 'Buscar categoría principal'}</Text>
                <Ionicons name={parentPickerOpen ? 'chevron-up' : 'chevron-down'} size={19} color={colors.primary} />
              </TouchableOpacity>
              {parentPickerOpen && <View style={styles.parentPicker}>
              <TextInput style={styles.input} value={parentSearch} onChangeText={setParentSearch} placeholder="Buscar categoría principal" placeholderTextColor={colors.textSecondary} maxLength={40} autoCorrect={false} />
                <ScrollView style={styles.parentList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                  {pageParentOptions.map(category => <TouchableOpacity key={category.id} style={styles.parentOption} onPress={() => { setValue('parentCategoryId', category.id, { shouldDirty: true }); setParentSearch(''); setParentPickerOpen(false); }}><Text style={styles.parentOptionText}>{category.name}</Text>{category.id === selectedParentId && <Ionicons name="checkmark" size={18} color={colors.primary} />}</TouchableOpacity>)}
                  {!visibleParentOptions.length && <Text style={styles.helperText}>No hay categorías principales que coincidan.</Text>}
                </ScrollView><PaginationControls page={parentPage} totalItems={visibleParentOptions.length} onPageChange={setParentPage} />
              </View>}
            </View>}
          </View>

          {!!serverError && <FormErrorBanner message={serverError} onRetry={() => handleSubmit(onSubmit)()} />}
          <Text style={styles.requiredNote}>* campos obligatorios</Text>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={goBack}
          disabled={submitting}
        >
          <Text style={styles.cancelButtonText}>Cancelar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.submitButton}
          onPress={handleSubmit(onSubmit, invalid => {
            const first = Object.keys(invalid)[0] as keyof CategoryFormData | undefined;
            if (first) setTimeout(() => setFocus(first), 0);
          })}
          disabled={submitting || (isSubmitted && !isValid)}
        >
          {submitting ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.submitButtonText}>
              {isEditMode ? 'Actualizar' : 'Crear categoría'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  scrollView: {
    flex: 1,
  },
  formContainer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  fieldContainer: {
    marginBottom: spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  statusLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusBadge: {
    backgroundColor: colors.errorLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  statusBadgeText: {
    ...typography.caption,
    color: colors.error,
    fontWeight: '600',
  },
  errorTitle: {
    ...typography.subheading,
    color: colors.error,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: colors.error,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  retryButtonText: {
    ...typography.label,
    color: colors.textInverse,
    fontWeight: '600',
  },
  label: {
    ...typography.label,
    color: colors.textPrimary,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
  },
  inputError: {
    borderColor: colors.error,
  },
  inputValid: { borderColor: colors.success },
  errorText: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
  helperText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  kindChoices: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  kindChoice: { flex: 1, alignItems: 'center', padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  kindChoiceActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  kindChoiceText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600', textAlign: 'center' },
  kindChoiceTextActive: { color: colors.primary },
  parentDropdown: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  parentDropdownText: { ...typography.body, color: colors.textPrimary },
  parentPicker: { padding: spacing.sm, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  parentList: { maxHeight: 190, marginTop: spacing.xs },
  parentOption: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  parentOptionText: { ...typography.body, color: colors.textPrimary },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipText: {
    ...typography.label,
    color: colors.primary,
    fontWeight: '600',
  },
  chipTextActive: {
    color: colors.textInverse,
  },
  requiredNote: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelButtonText: {
    ...typography.label,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  submitButton: {
    flex: 1,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitButtonText: {
    ...typography.label,
    color: colors.textInverse,
    fontWeight: '600',
  },
});
