import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

interface DatePickerCalendarProps {
  visible: boolean;
  value?: string;
  minDate?: string;
  title?: string;
  onSelect: (date: string) => void;
  onClear?: () => void;
  onClose: () => void;
}

const isoDate = (year: number, month: number, day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function DatePickerCalendar({ visible, value, minDate, title = 'Elegir fecha', onSelect, onClear, onClose }: DatePickerCalendarProps) {
  const [month, setMonth] = useState(() => {
    const start = value ? new Date(`${value}T00:00:00`) : new Date();
    return new Date(start.getFullYear(), start.getMonth(), 1);
  });

  useEffect(() => {
    if (!visible) return;
    const start = value ? new Date(`${value}T00:00:00`) : new Date();
    if (!Number.isNaN(start.getTime())) setMonth(new Date(start.getFullYear(), start.getMonth(), 1));
  }, [visible, value]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return [...Array(offset).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  }, [month]);

  const previousMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1);
  const previousMonthEnd = isoDate(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0);
  const previousDisabled = Boolean(minDate && previousMonthEnd < minDate);
  const today = new Date();

  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={styles.backdrop}><View style={styles.modal}>
      <View style={styles.header}>
        <TouchableOpacity style={[styles.arrow, previousDisabled && styles.arrowDisabled]} onPress={() => setMonth(previousMonth)} disabled={previousDisabled} accessibilityLabel="Mes anterior"><Ionicons name="chevron-back" size={20} color={previousDisabled ? colors.textDisabled : colors.primary} /></TouchableOpacity>
        <View style={styles.heading}><Text style={styles.eyebrow}>{title.toLocaleUpperCase('es-AR')}</Text><Text style={styles.month}>{month.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}</Text></View>
        <TouchableOpacity style={styles.arrow} onPress={() => setMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))} accessibilityLabel="Mes siguiente"><Ionicons name="chevron-forward" size={20} color={colors.primary} /></TouchableOpacity>
      </View>
      <View style={styles.grid}>{['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day, index) => <Text key={`weekday-${index}`} style={styles.weekday}>{day}</Text>)}{cells.map((day, index) => {
        if (!day) return <View key={`empty-${index}`} style={styles.dayCell} />;
        const date = isoDate(month.getFullYear(), month.getMonth(), day);
        const disabled = Boolean(minDate && date < minDate);
        const selected = value === date;
        const isToday = date === isoDate(today.getFullYear(), today.getMonth(), today.getDate());
        return <TouchableOpacity key={date} style={[styles.dayCell, selected && styles.daySelected]} onPress={() => { onSelect(date); onClose(); }} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected, disabled }}><Text style={[styles.dayText, isToday && styles.dayToday, selected && styles.dayTextSelected, disabled && styles.dayTextDisabled]}>{day}</Text></TouchableOpacity>;
      })}</View>
      <View style={styles.footer}>{onClear && value ? <TouchableOpacity style={styles.footerAction} onPress={() => { onClear(); onClose(); }}><Text style={styles.clearText}>Quitar fecha</Text></TouchableOpacity> : <View style={styles.footerAction} />}<TouchableOpacity style={styles.footerAction} onPress={onClose}><Text style={styles.cancelText}>Cancelar</Text></TouchableOpacity></View>
    </View></View>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: 'rgba(0,0,0,0.45)' },
  modal: { width: '100%', maxWidth: 380, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  heading: { flex: 1, alignItems: 'center' },
  eyebrow: { ...typography.caption, color: colors.textSecondary, letterSpacing: 0.8, fontWeight: '700' },
  month: { ...typography.subheading, color: colors.textPrimary, textTransform: 'capitalize', marginTop: 2 },
  arrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: colors.primaryLight },
  arrowDisabled: { backgroundColor: colors.background },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: '14.2857%', textAlign: 'center', paddingVertical: spacing.sm, ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  dayCell: { width: '14.2857%', height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full },
  daySelected: { backgroundColor: colors.primary },
  dayText: { ...typography.body, color: colors.textPrimary },
  dayToday: { fontWeight: '800', color: colors.primary },
  dayTextSelected: { color: colors.textInverse, fontWeight: '800' },
  dayTextDisabled: { color: colors.textDisabled, opacity: 0.45 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md },
  footerAction: { minWidth: 100, alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.sm },
  cancelText: { ...typography.label, color: colors.textSecondary },
  clearText: { ...typography.label, color: colors.primary },
});
