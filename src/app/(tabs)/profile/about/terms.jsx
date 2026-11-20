import { colors, spacing, typography } from '@/theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const TERMS = [
  ['Uso de la aplicación', 'La aplicación está destinada a apoyar la gestión de clientes, catálogo, pedidos, pagos y logística de MF Distribuciones. Cada persona debe usarla con la cuenta y los permisos que le fueron asignados.'],
  ['Cuentas y permisos', 'El usuario es responsable de mantener la confidencialidad de sus credenciales y de las acciones realizadas desde su cuenta. Si detecta un acceso que no reconoce, debe avisar al administrador de la organización.'],
  ['Información registrada', 'Quien carga o modifica información debe procurar que sea correcta y mantenerla actualizada. Los datos de clientes, productos, pedidos, pagos y entregas deben utilizarse únicamente para las tareas autorizadas de la organización.'],
  ['Disponibilidad y soporte', 'La disponibilidad puede depender de la conexión, los servicios externos y tareas de mantenimiento. Ante un problema, el usuario debe comunicarse con el administrador o con el canal de soporte que la organización tenga configurado.'],
  ['Vigencia', 'La organización puede actualizar estas condiciones cuando cambien las funciones o las reglas de uso. La versión vigente será la que se muestre dentro de la aplicación.'],
];

export default function TermsScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Términos y condiciones</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.notice}>Condiciones de uso interno para el equipo de MF Distribuciones.</Text>
        {TERMS.map(([heading, body]) => <View key={heading} style={styles.section}><Text style={styles.heading}>{heading}</Text><Text style={styles.body}>{body}</Text></View>)}
        <Text style={styles.note}>Para recibir el texto legal aprobado por la organización, consultá con el administrador del sistema.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerTitle: {
    ...typography.subheading,
    color: colors.textPrimary,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  section: { gap: spacing.xs },
  heading: { ...typography.label, color: colors.textPrimary },
  notice: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
  note: { ...typography.caption, color: colors.textDisabled, lineHeight: 20 },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
});
