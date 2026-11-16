// src/app/(tabs)/catalog/index.tsx
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useCategories } from "../../../hooks";
import { productsService } from "../../../services/api/productsService";
import { useCartStore } from "../../../store/cartStore";
import { colors, radius, spacing, typography } from "../../../theme";
import { IProduct } from "../../../types/api.types";

export default function CatalogScreen() {
  const router = useRouter();

  // Categorías: conectadas al backend real (endpoint /category/get).
  // Se muestra el error real (en vez de confundirlo con "no hay categorías")
  // para poder reintentar sin perder el resto del filtro.
  const {
    categories,
    loading: loadingCategories,
    error: categoriesError,
    refetch: refetchCategories,
  } = useCategories();

  // Listado de productos conectado al backend.
  const [products, setProducts] = useState<IProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Buscador de productos (reactivo, con debounce)
  const [search, setSearch] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);

  // Filtro de categorías con selección múltiple desde un desplegable.
  const [appliedCategoryIds, setAppliedCategoryIds] = useState<string[]>([]);

  const itemCount = useCartStore((state) => state.itemCount());
  const totalCart = useCartStore((state) => state.total());

  const activeFilterCount = appliedCategoryIds.length;
  const visibleCategories = useMemo(() => {
    const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
    const query = normalize(categorySearch.trim());
    return query ? categories.filter(category => normalize(category.name).startsWith(query)) : categories;
  }, [categories, categorySearch]);

  // Cargar productos cada vez que cambia el buscador o el filtro aplicado
  useEffect(() => {
    const fetchCatalog = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await productsService.getProducts(
          search,
          appliedCategoryIds,
          categories,
          true,
        );
        setProducts(response.items);
      } catch (err: any) {
        setError(err.message || "Ocurrió un error al cargar el catálogo.");
      } finally {
        setLoading(false);
      }
    };

    const delayDebounce = setTimeout(() => {
      fetchCatalog();
    }, 300);

    return () => clearTimeout(delayDebounce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search, appliedCategoryIds.join(","), categories, reloadKey]);

  function toggleCategory(categoryId: string) {
    setAppliedCategoryIds((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId],
    );
  }

  function clearAllFilters() {
    setAppliedCategoryIds([]);
  }

  // Renders de soporte para estados de UI
  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>⚠️ {error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => setReloadKey(key => key + 1)}
        >
          <Text style={styles.retryButtonText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header con acceso a gestión de categorías */}
      <View style={styles.catalogHeader}>
        <Text style={styles.catalogHeaderTitle}>Catálogo</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.manageProductsButton}
            onPress={() => router.push("/(tabs)/catalog/products" as any)}
          >
            <Ionicons name="cube-outline" size={17} color={colors.primary} />
            <Text style={styles.manageCategoriesText}>Productos</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.manageCategoriesButton}
            onPress={() => router.push("/(tabs)/catalog/categories" as any)}
          >
            <Ionicons name="pricetags-outline" size={17} color={colors.primary} />
            <Text style={styles.manageCategoriesText}>Categorías</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Buscador */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar producto por nombre..."
          placeholderTextColor={colors.textDisabled}
          value={search}
          onChangeText={setSearch}
          maxLength={25}
        />
      </View>

      {/* Selector desplegable de categorías */}
      <View style={styles.filterBar}>
        {loadingCategories ? (
          <ActivityIndicator color={colors.primary} style={{ marginRight: spacing.sm }} />
        ) : categoriesError ? (
          <TouchableOpacity onPress={refetchCategories} style={styles.chipsErrorContainer}>
            <Text style={styles.errorSectionText}>
              No se pudieron cargar las categorías. Toca para reintentar.
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.categoryPickerButton} onPress={() => setCategoryPickerVisible(true)} accessibilityRole="button">
            <View style={styles.categoryPickerCopy}>
              <Text style={styles.categoryPickerLabel}>Categorías</Text>
              <Text style={styles.categoryPickerValue} numberOfLines={1}>{activeFilterCount ? `${activeFilterCount} seleccionada${activeFilterCount === 1 ? "" : "s"}` : "Todas las categorías"}</Text>
            </View>
            <Ionicons name="chevron-down" size={19} color={colors.textSecondary} />
          </TouchableOpacity>
        )}

        {activeFilterCount > 0 && (
          <TouchableOpacity onPress={clearAllFilters} style={styles.clearLink}>
            <Text style={styles.clearLinkText}>
              Limpiar{activeFilterCount > 1 ? ` (${activeFilterCount})` : ""}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Contador de resultados */}
      {!loading && (
        <Text style={styles.resultsCount}>
          {products.length} {products.length === 1 ? "producto" : "productos"}{" "}
          encontrado{products.length === 1 ? "" : "s"}
        </Text>
      )}

      {/* Listado Principal */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando catálogo...</Text>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            itemCount > 0 && { paddingBottom: 90 },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                No se encontraron productos disponibles.
              </Text>
              {activeFilterCount > 0 && (
                <TouchableOpacity onPress={clearAllFilters} style={{ marginTop: spacing.md }}>
                  <Text style={styles.clearLinkText}>Limpiar filtros</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const hasStockData = item.stock > 0 || item.minStock > 0;
            const isLowStock = hasStockData && item.stock > 0 && item.stock <= item.minStock;
            const isOutOfStock = hasStockData && item.stock <= 0;
            return (
              <TouchableOpacity
                style={styles.productCard}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/catalog/[productId]" as any,
                    params: { productId: item.id },
                  })
                }
              >
                <View style={styles.productInfo}>
                  <Text style={styles.productName}>{item.name}</Text>
                  <Text style={styles.productDescription} numberOfLines={2}>
                    {item.description}
                  </Text>
                  {hasStockData && <View style={styles.stockBadgeContainer}>
                    <Text
                      style={[
                        styles.stockText,
                        isOutOfStock
                          ? styles.stockOut
                          : isLowStock
                          ? styles.stockWarning
                          : styles.stockOk,
                      ]}
                    >
                      {isOutOfStock
                        ? "Sin stock"
                        : `Stock: ${item.stock} ${item.unit}`}
                    </Text>
                  </View>}
                </View>
                <View style={styles.productPriceContainer}>
                  <Text style={styles.productPrice}>
                    ${item.price.toLocaleString("es-AR")}
                  </Text>
                  <Text style={styles.priceUnit}>x {item.unit}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* BOTÓN FLOTANTE DEL CARRITO (Aparece solo si hay ítems) */}
      {itemCount > 0 && (
        <TouchableOpacity
          style={styles.cartFloatingButton}
          onPress={() => router.push("/(tabs)/orders" as any)}
        >
          <View style={styles.cartFloatingLeft}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{itemCount}</Text>
            </View>
            <Text style={styles.cartFloatingText}>Ver pedido actual</Text>
          </View>
          <Text style={styles.cartFloatingTotal}>
            ${totalCart.toLocaleString("es-AR")}
          </Text>
        </TouchableOpacity>
      )}
      <Modal visible={categoryPickerVisible} transparent animationType="slide" onRequestClose={() => setCategoryPickerVisible(false)}>
        <View style={styles.selectorBackdrop}>
          <View style={styles.selectorModal}>
            <View style={styles.selectorHeader}>
              <View><Text style={styles.selectorEyebrow}>CATÁLOGO</Text><Text style={styles.selectorTitle}>Filtrar categorías</Text></View>
              <TouchableOpacity onPress={() => setCategoryPickerVisible(false)} accessibilityLabel="Cerrar categorías"><Ionicons name="close" size={23} color={colors.textPrimary} /></TouchableOpacity>
            </View>
            <View style={styles.selectorSearch}>
              <Ionicons name="search-outline" size={18} color={colors.textSecondary} />
              <TextInput style={styles.selectorSearchInput} value={categorySearch} onChangeText={setCategorySearch} placeholder="Buscar categoría" placeholderTextColor={colors.textSecondary} maxLength={25} autoCorrect={false} />
              {!!categorySearch && <TouchableOpacity onPress={() => setCategorySearch("")} accessibilityLabel="Borrar búsqueda"><Ionicons name="close-circle" size={19} color={colors.textSecondary} /></TouchableOpacity>}
            </View>
            <ScrollView keyboardShouldPersistTaps="handled">
              {visibleCategories.map(category => {
                const active = appliedCategoryIds.includes(category.id);
                return <TouchableOpacity key={category.id} style={styles.selectorOption} onPress={() => toggleCategory(category.id)}>
                  <Text style={[styles.selectorOptionText, active && styles.selectorOptionTextActive]}>{category.name}</Text>
                  <Ionicons name={active ? "checkbox" : "square-outline"} size={21} color={active ? colors.primary : colors.textSecondary} />
                </TouchableOpacity>;
              })}
              {!visibleCategories.length && <Text style={styles.selectorEmpty}>No se encontraron categorías con ese criterio.</Text>}
            </ScrollView>
            <View style={styles.selectorActions}>
              <TouchableOpacity style={styles.selectorClearButton} onPress={clearAllFilters}><Text style={styles.selectorClearText}>Limpiar selección</Text></TouchableOpacity>
              <TouchableOpacity style={styles.selectorDoneButton} onPress={() => setCategoryPickerVisible(false)}><Text style={styles.selectorDoneText}>Listo</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  catalogHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    backgroundColor: colors.surface,
  },
  catalogHeaderTitle: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  manageProductsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
  },
  manageCategoriesButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.primaryLight,
  },
  manageCategoriesText: {
    color: colors.primary,
    ...typography.caption,
    fontWeight: "600",
  },
  searchContainer: {
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: {
    height: 45,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
  },
  filterBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  chipsErrorContainer: {
    flex: 1,
  },
  categoryPickerButton: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  categoryPickerCopy: { flex: 1 },
  categoryPickerLabel: { ...typography.caption, color: colors.textSecondary },
  categoryPickerValue: { ...typography.label, color: colors.textPrimary, marginTop: 1 },
  selectorBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" },
  selectorModal: { backgroundColor: colors.surface, maxHeight: "82%", borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg },
  selectorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  selectorEyebrow: { ...typography.caption, color: colors.primary, letterSpacing: 1, fontWeight: "700" },
  selectorTitle: { ...typography.subheading, color: colors.textPrimary },
  selectorSearch: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 46, paddingHorizontal: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  selectorSearchInput: { flex: 1, color: colors.textPrimary, ...typography.body },
  selectorOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 50, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  selectorOptionText: { ...typography.body, color: colors.textPrimary },
  selectorOptionTextActive: { color: colors.primary, fontWeight: "700" },
  selectorEmpty: { ...typography.body, color: colors.textSecondary, textAlign: "center", padding: spacing.xl },
  selectorActions: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  selectorClearButton: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  selectorClearText: { ...typography.label, color: colors.error },
  selectorDoneButton: { minWidth: 100, alignItems: "center", paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary },
  selectorDoneText: { ...typography.label, color: colors.textInverse, fontWeight: "700" },
  clearLink: {
    paddingHorizontal: spacing.xs,
  },
  clearLinkText: {
    color: colors.error,
    ...typography.caption,
    fontWeight: "600",
  },
  resultsCount: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
  },
  loadingText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: 15,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  productCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  productInfo: {
    flex: 1,
    paddingRight: spacing.lg,
  },
  productName: {
    ...typography.subheading,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  productDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  stockBadgeContainer: {
    alignSelf: "flex-start",
  },
  stockText: {
    fontSize: 12,
    fontWeight: "600",
  },
  stockOk: {
    color: colors.success,
  },
  stockWarning: {
    color: colors.warning,
  },
  stockOut: {
    color: colors.error,
  },
  productPriceContainer: {
    alignItems: "flex-end",
  },
  productPrice: {
    ...typography.price,
    color: colors.primary,
  },
  priceUnit: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  emptyContainer: {
    alignItems: "center",
    marginTop: 40,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  errorText: {
    color: colors.error,
    fontSize: 16,
    textAlign: "center",
    marginBottom: spacing.lg,
  },
  errorSectionText: {
    ...typography.caption,
    color: colors.error,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  retryButtonText: {
    color: colors.textInverse,
    fontWeight: "bold",
  },
  cartFloatingButton: {
    position: "absolute",
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  cartFloatingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  badge: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  badgeText: {
    color: colors.primary,
    fontWeight: "bold",
    fontSize: 14,
  },
  cartFloatingText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: "600",
  },
  cartFloatingTotal: {
    color: colors.textInverse,
    fontSize: 18,
    fontWeight: "bold",
  },
});
