import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ledgerService } from '../../../services/api/ledgerService';
import type { CustomerLedger, LedgerPaymentMethod } from '../../../services/api/ledgerService';
import { clientsService } from '../../../services/api/clientsService';
import { IClient } from '../../../types';
import { colors, radius, spacing, typography } from '../../../theme';
import { FormErrorBanner } from '../../../components/ui/FormErrorBanner';
import { PaginationControls, pageItems } from '../../../components/ui/PaginationControls';
import { parseApiError } from '../../../utils/apiErrors';
import { formatArgentineAmountInput, formatDateTime, parseArgentineAmountInput } from '../../../utils/formatters';
import { usePermissions } from '../../../hooks/usePermissions';

const money = (value: number) => `$${value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ClientLedgerScreen() {
  const router = useRouter();
  const { canViewClients } = usePermissions();
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const [customer, setCustomer] = useState<IClient | null>(null);
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<LedgerPaymentMethod>('cash');
  const [amount, setAmount] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [entriesPage, setEntriesPage] = useState(1);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true); setError(null);
    try {
      const [clientData, ledgerData] = await Promise.all([
        clientsService.getClientById(clientId),
        ledgerService.getCustomerLedger(clientId),
      ]);
      setCustomer(clientData); setLedger(ledgerData);
    } catch (err) {
      setError(parseApiError(err, 'No se pudo cargar la cuenta corriente.').message);
    } finally { setLoading(false); }
  }, [clientId]);

  useEffect(() => {
    if (!canViewClients) router.replace('/(tabs)/profile' as any);
    else void load();
  }, [canViewClients, load, router]);

  const submit = async () => {
    const parsed = parseArgentineAmountInput(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) { setFieldError('Ingresá un monto mayor que cero.'); return; }
    if (!ledger || ledger.balance == null || ledger.balance <= 0) { setFieldError('Este cliente no tiene deuda pendiente para registrar un pago.'); return; }
    if (parsed > ledger.balance) { setFieldError(`El pago no puede superar la deuda de ${money(ledger.balance)}.`); return; }
    if (!clientId) return;
    setSaving(true); setFieldError(''); setError(null);
    try {
      await ledgerService.registerPayment(clientId, parsed, paymentMethod);
      setPaymentOpen(false); setAmount('');
      setSuccessMessage('Pago registrado en la cuenta corriente.');
      await load();
    } catch (err) {
      setError(parseApiError(err, 'No se pudo registrar el movimiento. El importe sigue cargado para reintentar.').message);
    } finally { setSaving(false); }
  };

  if (loading && !ledger) return <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.replace({ pathname: '/(tabs)/clients/[clientId]' as any, params: { clientId } })} accessibilityLabel="Volver al cliente"><Ionicons name="chevron-back" size={24} color={colors.textPrimary} /></TouchableOpacity>
        <Text style={styles.title}>Cuenta corriente</Text>
        <TouchableOpacity onPress={() => void load()} accessibilityLabel="Actualizar"><Ionicons name="refresh" size={20} color={colors.primary} /></TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {customer && <Text style={styles.customerName}>{customer.businessName}</Text>}
        {!!successMessage && <View style={styles.successBanner}><Ionicons name="checkmark-circle" size={19} color={colors.success} /><Text style={styles.successBannerText}>{successMessage}</Text><TouchableOpacity onPress={() => setSuccessMessage(null)}><Ionicons name="close" size={17} color={colors.success} /></TouchableOpacity></View>}
        {!!error && <FormErrorBanner message={error} onRetry={load} />}
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Saldo actual</Text>
          <Text style={styles.balance}>{ledger?.balance == null ? 'No informado' : money(ledger.balance)}</Text>
          <Text style={styles.balanceHint}>El saldo se actualiza después de cada movimiento.</Text>
        </View>
        <View style={styles.flowHint}><Ionicons name="information-circle-outline" size={18} color={colors.info} /><Text style={styles.flowHintText}>Al entregar un pedido se registra el cargo. Usá “Registrar pago” cuando el cliente abone; el pago queda en Movimientos.</Text></View>
        {!!ledger && ledger.balance != null && ledger.balance > 0 && <TouchableOpacity style={styles.primaryButton} onPress={() => { setAmount(''); setFieldError(''); setPaymentMethod('cash'); setPaymentOpen(true); }}><Ionicons name="cash-outline" size={18} color={colors.textInverse} /><Text style={styles.primaryButtonText}>Registrar pago</Text></TouchableOpacity>}
        <Text style={styles.sectionTitle}>Movimientos</Text>
        {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} /> : ledger?.entries.length ? pageItems(ledger.entries, entriesPage).map(entry => {
          const positive = entry.amount >= 0;
          return <View key={entry.id} style={styles.entry}>
            <View style={[styles.entryIcon, positive ? styles.entryPositive : styles.entryNegative]}><Ionicons name={positive ? 'arrow-down' : 'arrow-up'} size={17} color={positive ? colors.success : colors.error} /></View>
            <View style={styles.entryMain}><Text style={styles.entryTitle}>{entry.description}</Text><Text style={styles.entryMeta}>{entry.type}{entry.date ? ` · ${formatDateTime(entry.date)}` : ''}</Text></View>
            <Text style={[styles.entryAmount, positive ? styles.amountPositive : styles.amountNegative]}>{money(entry.amount)}</Text>
          </View>;
        }) : <View style={styles.empty}><Ionicons name="receipt-outline" size={28} color={colors.textSecondary} /><Text style={styles.emptyText}>No hay movimientos disponibles.</Text></View>}
        <PaginationControls page={entriesPage} totalItems={ledger?.entries.length ?? 0} onPageChange={setEntriesPage} />
      </ScrollView>
      <Modal visible={paymentOpen} transparent animationType="fade" onRequestClose={() => !saving && setPaymentOpen(false)}>
        <View style={styles.modalBackdrop}><View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Registrar pago</Text>
          <Text style={styles.inputLabel}>Importe</Text>
          <TextInput value={formatArgentineAmountInput(amount)} onChangeText={value => { setAmount(value.replace(/\D/g, '').slice(0, 11)); setFieldError(''); setError(null); }} keyboardType="number-pad" maxLength={14} placeholder="0" placeholderTextColor={colors.textDisabled} editable={!saving} style={[styles.input, !!fieldError && styles.inputError]} />
          <Text style={styles.inputLabel}>Medio de pago</Text>
          <View style={styles.methodChoices}>{([['cash', 'Efectivo'], ['transfer', 'Transferencia']] as [LedgerPaymentMethod, string][]).map(([method, label]) => <TouchableOpacity key={method} style={[styles.methodChoice, paymentMethod === method && styles.methodChoiceActive]} onPress={() => setPaymentMethod(method)} disabled={saving}><Text style={[styles.methodChoiceText, paymentMethod === method && styles.methodChoiceTextActive]}>{label}</Text></TouchableOpacity>)}</View>
          {!!fieldError && <Text style={styles.fieldError}>{fieldError}</Text>}
          <Text style={styles.modalHint}>Ingresá el importe correspondiente al movimiento.</Text>
          {!!error && <FormErrorBanner message={error} onRetry={submit} />}
          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setPaymentOpen(false)} disabled={saving}><Text style={styles.cancelText}>Cancelar</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.primaryButton, { flex: 1 }]} onPress={() => void submit()} disabled={saving}>{saving ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.primaryButtonText}>Guardar</Text>}</TouchableOpacity>
          </View>
        </View></View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { padding: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: colors.border }, title: { ...typography.heading, color: colors.textPrimary }, content: { padding: spacing.lg, paddingBottom: spacing.xxxl }, customerName: { ...typography.subheading, color: colors.textPrimary, marginBottom: spacing.md },
  balanceCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.primary, marginBottom: spacing.md }, balanceLabel: { ...typography.caption, color: colors.textInverse, opacity: 0.85 }, balance: { ...typography.price, color: colors.textInverse, marginVertical: spacing.xs }, balanceHint: { ...typography.caption, color: colors.textInverse, opacity: 0.85 }, flowHint: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, marginBottom: spacing.lg, borderRadius: radius.md, backgroundColor: colors.infoLight }, flowHintText: { ...typography.caption, color: colors.textPrimary, flex: 1, lineHeight: 18 }, successBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.success, borderRadius: radius.md, backgroundColor: colors.successLight, marginBottom: spacing.md }, successBannerText: { ...typography.caption, color: colors.textPrimary, flex: 1 }, actions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl }, primaryButton: { alignSelf: 'stretch', flexDirection: 'row', gap: spacing.xs, alignItems: 'center', justifyContent: 'center', padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary }, primaryButtonText: { ...typography.label, color: colors.textInverse, fontWeight: '600' },
  sectionTitle: { ...typography.subheading, color: colors.textPrimary, marginBottom: spacing.md }, entry: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, marginBottom: spacing.sm, gap: spacing.md }, entryIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: radius.full }, entryPositive: { backgroundColor: colors.successLight }, entryNegative: { backgroundColor: colors.errorLight }, entryMain: { flex: 1 }, entryTitle: { ...typography.label, color: colors.textPrimary }, entryMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, entryAmount: { ...typography.label, fontWeight: '700' }, amountPositive: { color: colors.success }, amountNegative: { color: colors.error }, empty: { alignItems: 'center', gap: spacing.sm, padding: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.md }, emptyText: { ...typography.body, color: colors.textSecondary },
  methodChoices: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }, methodChoice: { flex: 1, alignItems: 'center', padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }, methodChoiceActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight }, methodChoiceText: { ...typography.caption, color: colors.textSecondary }, methodChoiceTextActive: { color: colors.primary, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg }, modalCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface }, modalTitle: { ...typography.subheading, color: colors.textPrimary, marginBottom: spacing.lg }, inputLabel: { ...typography.label, color: colors.textPrimary, marginBottom: spacing.xs }, input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.textPrimary, ...typography.body }, inputError: { borderColor: colors.error }, fieldError: { ...typography.caption, color: colors.error, marginTop: spacing.xs }, modalHint: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm }, modalActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end', marginTop: spacing.lg }, cancelButton: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.background }, cancelText: { ...typography.label, color: colors.textPrimary },
});
