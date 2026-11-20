import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  Switch,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PaginationControls, pageItems } from "../../../../components/ui/PaginationControls";
import { useCategories } from "../../../../hooks";
import { usePermissions } from "../../../../hooks/usePermissions";
import { productsService } from "../../../../services/api/productsService";
import { colors, radius, spacing, typography } from "../../../../theme";
import { IProduct } from "../../../../types";

// Compara sin importar mayúsculas ni tildes: "jamon" encuentra "Jamón".
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();

export default function ProductManagementScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { canManageProducts } = usePermissions();
  useEffect(() => {
    if (!canManageProducts) router.replace("/(tabs)/catalog" as any);
  }, [canManageProducts, router]);
  const { categories } = useCategories(canManageProducts);
  const [products, setProducts] = useState<IProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortAsc, setSortAsc] = useState(true);
  const [categoryId, setCategoryId] = useState('');
  const [categoryListOpen, setCategoryListOpen] = useState(false);
  const [categoryPickerPage, setCategoryPickerPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);

  // Filtra por nombre o categoría y ordena alfabéticamente por nombre.
  const visibleProducts = useMemo(() => {
    const query = normalize(search);
    const filtered = (query
      ? products.filter(
          (product) =>
            normalize(product.name).startsWith(query) ||
            normalize(product.category.name).startsWith(query),
        )
        : products).filter(product => (!categoryId || product.category.id === categoryId) && (activeFilter === 'all' || product.active === (activeFilter === 'active')));
    const sorted = [...filtered].sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" }),
    );
    return sortAsc ? sorted : sorted.reverse();
  }, [products, search, sortAsc, categoryId, activeFilter]);
  const pageProducts = useMemo(() => pageItems(visibleProducts, page), [visibleProducts, page]);
  const pageCategories = useMemo(() => pageItems(categories, categoryPickerPage), [categories, categoryPickerPage]);
  useEffect(() => setPage(1), [search, categoryId, activeFilter, sortAsc]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await productsService.getProducts("", [], categories, activeFilter === 'all' ? undefined : activeFilter === 'active');
      setProducts(result.items);
    } catch (err: any) {
      setError(
        err?.response?.data?.message ||
          err.message ||
          "No se pudieron cargar los productos.",
      );
    } finally {
      setLoading(false);
    }
  }, [categories, activeFilter]);

  useFocusEffect(
    useCallback(() => {
      loadProducts();
    }, [loadProducts]),
  );

  const toggleActive = (product: IProduct) => {
    const activating = !product.active;
    void (async () => {
      setBusyId(product.id);
      setToggleError(null);
      try {
        if (activating) await productsService.activateProduct(product.id);
        else await productsService.deactivateProduct(product.id);
        await loadProducts();
      } catch (err: any) {
        const errorMessage = err?.response?.data?.message || "No se pudo cambiar el estado del producto.";
        setToggleError(errorMessage);
      } finally { setBusyId(null); }
    })();
  };

  const renderItem = ({ item }: { item: IProduct }) => (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.mainInfo}
        onPress={() => canManageProducts && router.push({
            pathname: "/(tabs)/catalog/products/form" as any,
            params: { productId: item.id },
          })}
      >
        <Text style={styles.name}>{item.name}</Text>
        <Text style={styles.meta}>
          {item.category.name} · {"$" + item.price.toLocaleString("es-AR")}
        </Text>
        {!!item.sku && <Text style={styles.sku}>Código: {item.sku}</Text>}
      </TouchableOpacity>
      <View style={styles.actions}>
        {busyId === item.id ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            {canManageProducts && <Switch
              accessibilityLabel={item.active ? "Desactivar producto" : "Activar producto"}
              value={!!item.active}
              onValueChange={() => toggleActive(item)}
              trackColor={{ false: colors.border, true: colors.primaryLight }}
              thumbColor={item.active ? colors.primary : colors.textDisabled}
            />}
          </>
        )}
      </View>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.replace('/(tabs)/catalog' as any)}
          accessibilityLabel="Volver"
        >
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Productos</Text>
        <View style={{ width: 24 }} />
      </View>
      <View style={styles.filterRow}>{(['all', 'active', 'inactive'] as const).map(filter => <TouchableOpacity key={filter} onPress={() => setActiveFilter(filter)} style={[styles.filterChip, activeFilter === filter && styles.filterChipActive]}><Text style={[styles.filterChipText, activeFilter === filter && styles.filterChipTextActive]}>{filter === 'all' ? 'Todos' : filter === 'active' ? 'Activos' : 'Inactivos'}</Text></TouchableOpacity>)}</View>
      <View style={styles.categoryFilter}><TouchableOpacity style={styles.categoryTrigger} onPress={() => setCategoryListOpen(open => !open)} accessibilityRole="button" accessibilityState={{ expanded: categoryListOpen }}><View><Text style={styles.categoryLabel}>Categoría</Text><Text style={styles.categoryValue}>{categories.find(category => category.id === categoryId)?.name ?? 'Todas las categorías'}</Text></View><Ionicons name={categoryListOpen ? 'chevron-up' : 'chevron-down'} size={19} color={colors.primary} /></TouchableOpacity>{categoryListOpen && <><ScrollView style={styles.categoryList} nestedScrollEnabled showsVerticalScrollIndicator keyboardShouldPersistTaps="handled"><TouchableOpacity style={styles.categoryOption} onPress={() => { setCategoryId(''); setCategoryListOpen(false); }}><Text style={[styles.categoryOptionText, !categoryId && styles.categoryOptionTextActive]}>Todas las categorías</Text>{!categoryId && <Ionicons name="checkmark" size={18} color={colors.primary} />}</TouchableOpacity>{pageCategories.map(category => <TouchableOpacity key={category.id} style={styles.categoryOption} onPress={() => { setCategoryId(category.id); setCategoryListOpen(false); }}><Text style={[styles.categoryOptionText, categoryId === category.id && styles.categoryOptionTextActive]}>{category.name}</Text>{category.id === categoryId && <Ionicons name="checkmark" size={18} color={colors.primary} />}</TouchableOpacity>)}</ScrollView><PaginationControls page={categoryPickerPage} totalItems={categories.length} onPageChange={setCategoryPickerPage} /></>}</View>
      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Ionicons
            name="search-outline"
            size={18}
            color={colors.textSecondary}
          />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            maxLength={40}
            placeholder="Buscar por nombre o categoría"
            placeholderTextColor={colors.textSecondary}
            autoCorrect={false}
            returnKeyType="search"
          />
          {!!search && (
            <TouchableOpacity
              onPress={() => setSearch("")}
              accessibilityLabel="Borrar búsqueda"
            >
              <Ionicons
                name="close-circle"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={styles.sortButton}
          onPress={() => setSortAsc((value) => !value)}
          accessibilityLabel={
            sortAsc ? "Ordenado de la A a la Z" : "Ordenado de la Z a la A"
          }
        >
          <Ionicons
            name={sortAsc ? "arrow-down" : "arrow-up"}
            size={14}
            color={colors.primary}
          />
          <Text style={styles.sortText}>{sortAsc ? "A-Z" : "Z-A"}</Text>
        </TouchableOpacity>
      </View>
      {!!toggleError && <Text style={styles.toggleError}>{toggleError}</Text>}
      {error ? (
        <View style={styles.center}>
          <Ionicons
            name="alert-circle-outline"
            size={44}
            color={colors.error}
          />
          <Text style={styles.error}>{error}</Text>
          <TouchableOpacity style={styles.retry} onPress={loadProducts}>
            <Text style={styles.retryText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : loading && products.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.helper}>Cargando productos…</Text>
        </View>
      ) : (
        <FlatList
          data={pageProducts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={
            visibleProducts.length ? styles.list : styles.center
          }
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={loadProducts}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <Text style={styles.helper}>
              {products.length
                ? "No hay productos que coincidan con la búsqueda."
                : "Todavía no hay productos."}
            </Text>
          }
        />
      )}
      <PaginationControls page={page} totalItems={visibleProducts.length} onPageChange={setPage} />
      {canManageProducts && <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + spacing.lg }]}
        onPress={() => router.push("/(tabs)/catalog/products/form" as any)}
      >
        <Ionicons name="add" size={25} color={colors.textInverse} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
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
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  sortButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
  },
  sortText: { ...typography.label, color: colors.primary },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  filterChipText: { ...typography.caption, color: colors.textSecondary },
  filterChipTextActive: { color: colors.primary, fontWeight: '700' },
  categoryFilter: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, backgroundColor: colors.surface },
  categoryTrigger: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 52, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background },
  categoryLabel: { ...typography.caption, color: colors.textSecondary },
  categoryValue: { ...typography.label, color: colors.textPrimary, marginTop: 2 },
  categoryList: { maxHeight: 180, marginTop: spacing.xs, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  categoryOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  categoryOptionText: { ...typography.body, color: colors.textPrimary },
  categoryOptionTextActive: { color: colors.primary, fontWeight: '700' },
  list: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  mainInfo: { flex: 1 },
  name: { ...typography.subheading, color: colors.textPrimary },
  meta: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  sku: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingLeft: spacing.md,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  helper: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  error: {
    ...typography.body,
    color: colors.error,
    marginTop: spacing.md,
    textAlign: "center",
  },
  toggleError: { ...typography.caption, color: colors.error, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  retry: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    marginTop: spacing.md,
  },
  retryText: { ...typography.label, color: colors.textInverse },
  fab: {
    position: "absolute",
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 6,
  },
});
