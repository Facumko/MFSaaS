import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

export const PAGE_SIZE = 10;

export function PaginationControls({ page, totalItems, onPageChange }: { page: number; totalItems: number; onPageChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  useEffect(() => { if (page > pageCount) onPageChange(pageCount); }, [page, pageCount, onPageChange]);
  if (pageCount <= 1) return null;
  return <View style={styles.container}>
    <TouchableOpacity style={[styles.button, page <= 1 && styles.disabled]} onPress={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} accessibilityLabel="Página anterior"><Ionicons name="chevron-back" size={18} color={page <= 1 ? colors.textDisabled : colors.primary} /></TouchableOpacity>
    <Text style={styles.label}>Página {page} de {pageCount}</Text>
    <TouchableOpacity style={[styles.button, page >= pageCount && styles.disabled]} onPress={() => onPageChange(Math.min(pageCount, page + 1))} disabled={page >= pageCount} accessibilityLabel="Página siguiente"><Ionicons name="chevron-forward" size={18} color={page >= pageCount ? colors.textDisabled : colors.primary} /></TouchableOpacity>
  </View>;
}

export const pageItems = <T,>(items: T[], page: number): T[] => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

const styles = StyleSheet.create({
  container: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  button: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  disabled: { opacity: 0.45 },
  label: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
});
