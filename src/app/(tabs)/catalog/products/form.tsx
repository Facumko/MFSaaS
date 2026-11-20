import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FormErrorBanner } from "../../../../components/ui/FormErrorBanner";
import { SelectField } from "../../../../components/ui/SelectField";
import { PaginationControls, pageItems } from "../../../../components/ui/PaginationControls";
import { useCategories } from "../../../../hooks";
import { usePermissions } from "../../../../hooks/usePermissions";
import {
  ProductWriteRequest,
  productsService,
} from "../../../../services/api/productsService";
import { colors, radius, spacing, typography } from "../../../../theme";
import { parseApiError } from "../../../../utils/apiErrors";
import { PRODUCT_UNITS } from "../../../../utils/constants";

const DEFAULT_UNIT = "unidad";

// Algunos datos viejos usan 'u' en lugar de 'unidad'.
const normalizeUnit = (value?: string | null) => {
  const unit = (value || "").trim().toLowerCase();
  return !unit || unit === "u" ? DEFAULT_UNIT : unit;
};

export default function ProductFormScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { canManageProducts } = usePermissions();
  useEffect(() => {
    if (!canManageProducts) router.replace("/(tabs)/catalog" as any);
  }, [canManageProducts, router]);
  const params = useLocalSearchParams<{ productId?: string }>();
  const productId = Array.isArray(params.productId)
    ? params.productId[0]
    : params.productId;
  const editing = !!productId;
  const goBack = () => router.replace('/(tabs)/catalog/products' as any);
  const { categories } = useCategories();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sku, setSku] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState(DEFAULT_UNIT);
  const [categoryId, setCategoryId] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryPage, setCategoryPage] = useState(1);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const nameInput = React.useRef<TextInput>(null);
  const priceInput = React.useRef<TextInput>(null);
  // Evita que una carga lenta de otro producto pise un formulario nuevo.
  const loadToken = React.useRef(0);

  const validate = (field: string, value: string) => {
    if (field === "name")
      return !value.trim()
        ? "El nombre es obligatorio."
        : value.trim().length < 2
          ? "Usá al menos 2 caracteres."
          : value.length > 30
            ? "No puede superar 30 caracteres."
            : "";
    if (field === "price") {
      const digits = value.replace(/\D/g, "");
      return !digits ? "Ingresá un precio válido." : digits.length > 11 ? "El precio no puede superar 11 dígitos." : "";
    }
    if (field === "description")
      return value.length > 1000 ? "No puede superar 1000 caracteres." : "";
    if (field === "sku")
      return value.length > 50 ? "No puede superar 50 caracteres." : "";
    return "";
  };
  const formatPrice = (value: string) => {
    const rawDigits = value.replace(/\D/g, '');
    if (rawDigits.length > 11) Alert.alert('Límite alcanzado', 'El precio admite hasta 11 dígitos.');
    const digits = rawDigits.slice(0, 11);
    return digits ? Number(digits).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '';
  };
  const changePrice = (value: string) => {
    if (/[^\d.]/.test(value)) Alert.alert('Formato incorrecto', 'El precio solo admite números.');
    const formatted = formatPrice(value);
    setPrice(formatted);
    setFieldErrors(current => ({ ...current, price: attempted ? validate('price', formatted) : '' }));
    setServerError(null);
  };
  const visibleCategories = categories.filter(category => category.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().startsWith(categorySearch.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()));
  const pageCategories = pageItems(visibleCategories, categoryPage);
  useEffect(() => setCategoryPage(1), [categorySearch]);
  const changeField = (
    field: string,
    value: string,
    setter: (value: string) => void,
  ) => {
    setter(value);
    setFieldErrors((current) => ({
      ...current,
      [field]: attempted ? validate(field, value) : "",
    }));
    setServerError(null);
  };

  const resetFields = () => {
    setName("");
    setDescription("");
    setSku("");
    setPrice("");
    setUnit(DEFAULT_UNIT);
    setCategoryId("");
    setCategorySearch("");
    setCategoryPickerOpen(false);
    setFieldErrors({});
    setTouched({});
    setAttempted(false);
    setServerError(null);
  };

  const loadProduct = async () => {
    if (!productId) return;
    const token = ++loadToken.current;
    setLoading(true);
    setLoadError(null);
    try {
      const product = await productsService.getProductById(
        productId,
        categories,
      );
      if (token !== loadToken.current) return;
      setName(product.name);
      setDescription(product.description);
      setSku(product.sku || "");
      setPrice(formatPrice(String(product.price)));
      setUnit(normalizeUnit(product.unit));
      setCategoryId(product.category.id);
    } catch (err: any) {
      if (token !== loadToken.current) return;
      setLoadError(
        parseApiError(err, "No se pudo cargar el producto.").message,
      );
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  };

  // Esta pantalla es una tab oculta: React Navigation la mantiene montada al salir,
  // así que el estado sobrevive entre visitas. Por eso se resetea al entrar y al salir.
  // No depende de `categories`: si no, al terminar de cargar las categorías se borraría lo que se está escribiendo.
  useFocusEffect(
    useCallback(() => {
      if (productId) {
        loadProduct();
      } else {
        loadToken.current++;
        resetFields();
        setLoadError(null);
        setLoading(false);
      }
      return () => {
        loadToken.current++;
        resetFields();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]),
  );

  const unitOptions = PRODUCT_UNITS.some((option) => option.value === unit)
    ? PRODUCT_UNITS
    : [...PRODUCT_UNITS, { value: unit, label: unit }];
  const unitLabel = (
    unitOptions.find((option) => option.value === unit)?.label ?? unit
  ).toLowerCase();

  const categoryOptions = [
    { value: "", label: "Sin categoría" },
    ...categories.map((category) => ({
      value: category.id,
      label: category.name,
    })),
  ];

  const submit = async () => {
    setAttempted(true);
    const parsedPrice = Number(price.replace(/\D/g, ""));
    const nextErrors = {
      name: validate("name", name),
      price: validate("price", price),
      description: validate("description", description),
      sku: validate("sku", sku),
    };
    setFieldErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors).find(
      (key) => !!nextErrors[key as keyof typeof nextErrors],
    );
    if (firstInvalid) {
      (firstInvalid === "price" ? priceInput : nameInput).current?.focus();
      return;
    }
    setServerError(null);
    const payload: ProductWriteRequest = {
      name: name.trim(),
      description: description.trim() || undefined,
      sku: sku.trim() || undefined,
      unitPrice: parsedPrice,
      unit,
      categoryId: categoryId ? Number(categoryId) : null,
    };

    setSubmitting(true);
    try {
      if (productId) await productsService.updateProduct(productId, payload);
      else await productsService.createProduct(payload);
      Alert.alert(
        "Listo",
        editing ? "Producto actualizado." : "Producto creado.",
      );
      goBack();
    } catch (err: any) {
      const parsed = parseApiError(
        err,
        "No se pudo guardar el producto. Revisá los datos e intentá de nuevo.",
      );
      const knownFields = ["name", "price", "description", "sku"];
      const mapped = Object.fromEntries(
        Object.entries(parsed.fields).filter(([key]) =>
          knownFields.includes(key),
        ),
      );
      setFieldErrors((current) => ({ ...current, ...mapped }));
      setServerError(Object.keys(mapped).length ? null : parsed.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || loadError) {
    return (
      <View
        style={[styles.container, styles.center, { paddingTop: insets.top }]}
      >
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <>
            <Text style={styles.error}>{loadError}</Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={loadProduct}
            >
              <Text style={styles.primaryButtonText}>Reintentar</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          accessibilityLabel="Volver"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>
          {editing ? "Editar producto" : "Nuevo producto"}
        </Text>
        <View style={{ width: 24 }} />
      </View>
      <ScrollView
        contentContainerStyle={styles.form}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.label}>Nombre *</Text>
        <TextInput
          ref={nameInput}
          style={[
            styles.input,
            fieldErrors.name
              ? styles.inputError
              : touched.name && name.trim()
                ? styles.inputValid
                : null,
          ]}
          value={name}
          onChangeText={(value) => { if (value.length > 30) Alert.alert('Límite alcanzado', 'El nombre del producto admite hasta 30 caracteres.'); changeField('name', value.slice(0, 30), setName); }}
          onBlur={() => {
            setTouched((t) => ({ ...t, name: true }));
            setFieldErrors((e) => ({ ...e, name: validate("name", name) }));
          }}
          placeholder="Nombre del producto"
          editable={!submitting}
        />
        {!!fieldErrors.name && (
          <Text style={styles.fieldError}>{fieldErrors.name}</Text>
        )}

        <Text style={styles.label}>Se vende por</Text>
        <SelectField
          options={unitOptions}
          value={unit}
          onChange={setUnit}
          placeholder="Elegí una unidad"
          disabled={submitting}
        />

        <Text style={styles.label}>Precio por {unitLabel} *</Text>
        <TextInput
          ref={priceInput}
          style={[
            styles.input,
            fieldErrors.price
              ? styles.inputError
              : touched.price && price.trim()
                ? styles.inputValid
                : null,
          ]}
          value={price}
          onChangeText={changePrice}
          onBlur={() => {
            setTouched((t) => ({ ...t, price: true }));
            setFieldErrors((e) => ({ ...e, price: validate("price", price) }));
          }}
          placeholder="0"
          keyboardType="number-pad"
          editable={!submitting}
          maxLength={14}
        />
        {!!fieldErrors.price && (
          <Text style={styles.fieldError}>{fieldErrors.price}</Text>
        )}

        <Text style={styles.label}>Descripción</Text>
        <TextInput
          style={[
            styles.input,
            styles.multiline,
            fieldErrors.description
              ? styles.inputError
              : touched.description && styles.inputValid,
          ]}
          value={description}
          onChangeText={(value) =>
            changeField("description", value, setDescription)
          }
          onBlur={() => {
            setTouched((t) => ({ ...t, description: true }));
            setFieldErrors((e) => ({
              ...e,
              description: validate("description", description),
            }));
          }}
          placeholder="Descripción (opcional)"
          multiline
          editable={!submitting}
          maxLength={1000}
        />
        {!!fieldErrors.description && (
          <Text style={styles.fieldError}>{fieldErrors.description}</Text>
        )}

        <Text style={styles.label}>Código</Text>
        <TextInput
          style={[
            styles.input,
            fieldErrors.sku
              ? styles.inputError
              : touched.sku && sku.trim()
                ? styles.inputValid
                : null,
          ]}
          value={sku}
          onChangeText={(value) => {
            const clean = value.replace(/[^a-zA-Z0-9]/g, '');
            if (clean.length > 50) Alert.alert('Límite alcanzado', 'El código admite hasta 50 caracteres.');
            if (clean !== value) Alert.alert('Formato incorrecto', 'El código solo puede contener letras y números.');
            changeField('sku', clean.slice(0, 50), setSku);
          }}
          onBlur={() => {
            setTouched((t) => ({ ...t, sku: true }));
            setFieldErrors((e) => ({ ...e, sku: validate("sku", sku) }));
          }}
          placeholder="Código del producto (opcional)"
          editable={!submitting}
          autoCapitalize="characters"
        />
        {!!fieldErrors.sku && (
          <Text style={styles.fieldError}>{fieldErrors.sku}</Text>
        )}

        <Text style={styles.label}>Categoría</Text>
        <View style={styles.categorySelect}>
          <TouchableOpacity style={styles.categoryTrigger} onPress={() => setCategoryPickerOpen(open => !open)} disabled={submitting} accessibilityRole="button" accessibilityState={{ expanded: categoryPickerOpen }}>
            <Text style={styles.categoryTriggerText}>{categories.find(category => category.id === categoryId)?.name ?? 'Sin categoría'}</Text>
            <Ionicons name={categoryPickerOpen ? 'chevron-up' : 'chevron-down'} size={19} color={colors.primary} />
          </TouchableOpacity>
          {categoryPickerOpen && <View style={styles.categoryDropdown}>
            <View style={styles.categorySearchBox}><Ionicons name="search-outline" size={17} color={colors.textSecondary} /><TextInput style={styles.categorySearchInput} value={categorySearch} onChangeText={setCategorySearch} placeholder="Buscar categoría" placeholderTextColor={colors.textSecondary} maxLength={40} autoCorrect={false} /></View>
            <ScrollView style={styles.categoryOptions} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              <TouchableOpacity style={styles.categoryOption} onPress={() => { setCategoryId(''); setCategoryPickerOpen(false); setCategorySearch(''); }}><Text style={styles.categoryOptionText}>Sin categoría</Text>{!categoryId && <Ionicons name="checkmark" size={18} color={colors.primary} />}</TouchableOpacity>
              {pageCategories.map(category => <TouchableOpacity key={category.id} style={styles.categoryOption} onPress={() => { setCategoryId(category.id); setCategoryPickerOpen(false); setCategorySearch(''); }}><Text style={styles.categoryOptionText}>{category.name}</Text>{categoryId === category.id && <Ionicons name="checkmark" size={18} color={colors.primary} />}</TouchableOpacity>)}
              {!!categorySearch && !visibleCategories.length && <Text style={styles.categoryEmpty}>No se encontraron categorías.</Text>}
            </ScrollView><PaginationControls page={categoryPage} totalItems={visibleCategories.length} onPageChange={setCategoryPage} />
          </View>}
        </View>

        {!!serverError && (
          <FormErrorBanner message={serverError} onRetry={submit} />
        )}
      </ScrollView>
      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, spacing.md) },
        ]}
      >
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={goBack}
          disabled={submitting}
        >
          <Text style={styles.cancelText}>Cancelar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            attempted &&
              Object.values(fieldErrors).some(Boolean) &&
              styles.buttonDisabled,
          ]}
          onPress={submit}
          disabled={
            submitting ||
            (attempted && Object.values(fieldErrors).some(Boolean))
          }
        >
          {submitting ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.primaryButtonText}>
              {editing ? "Guardar cambios" : "Crear producto"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { ...typography.heading, color: colors.textPrimary },
  form: { padding: spacing.lg, paddingBottom: spacing.xl },
  label: {
    ...typography.label,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  inputError: { borderColor: colors.error },
  inputValid: { borderColor: colors.success },
  fieldError: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
  buttonDisabled: { opacity: 0.5 },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
  },
  chipSelected: { backgroundColor: colors.primary },
  chipText: { ...typography.caption, color: colors.primary, fontWeight: "600" },
  chipTextSelected: { color: colors.textInverse },
  categorySelect: { marginTop: spacing.xs },
  categoryTrigger: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  categoryTriggerText: { ...typography.body, color: colors.textPrimary },
  categoryDropdown: { padding: spacing.sm, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  categorySearchBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.background },
  categorySearchInput: { flex: 1, ...typography.body, color: colors.textPrimary },
  categoryOptions: { maxHeight: 190, marginTop: spacing.xs },
  categoryOption: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  categoryOptionText: { ...typography.body, color: colors.textPrimary },
  categoryEmpty: { ...typography.caption, color: colors.textSecondary, padding: spacing.md, textAlign: 'center' },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.lg,
  },
  error: {
    ...typography.body,
    color: colors.error,
    textAlign: "center",
    marginTop: spacing.md,
  },
  footer: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  cancelButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  cancelText: { ...typography.label, color: colors.textPrimary },
  primaryButton: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  primaryButtonText: { ...typography.label, color: colors.textInverse },
});
