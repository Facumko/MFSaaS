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

const PRIVACY_SECTIONS = [
  ['Responsable y alcance', 'Esta política describe el uso de los datos personales dentro de la aplicación de gestión de MF Distribuciones. Aplica a las cuentas de usuario y a los datos de clientes, contactos y operaciones que el equipo registra en el sistema.'],
  ['Datos que se registran', 'Según las funciones utilizadas, el sistema puede contener nombre y correo de los usuarios; razón social, CUIT, teléfono, correo y direcciones de clientes; y datos de productos, pedidos, pagos, entregas, camiones y movimientos de stock. También se procesan los datos técnicos necesarios para iniciar sesión y utilizar la aplicación.'],
  ['Finalidad de uso', 'Estos datos se usan para administrar el acceso por roles y realizar tareas comerciales y operativas: mantener el catálogo y los clientes, preparar pedidos, registrar pagos, organizar entregas y consultar información de gestión.'],
  ['Acceso y comunicación', 'La información está disponible para las personas autorizadas de la organización de acuerdo con su rol. El servicio puede procesar datos mediante los sistemas técnicos necesarios para operar la aplicación. No se debe cargar información para fines ajenos a la actividad autorizada.'],
  ['Almacenamiento y cuidado', 'La información se gestiona mediante la aplicación y sus servicios conectados. El acceso debe limitarse a usuarios autorizados; cada usuario debe cuidar sus credenciales y avisar al administrador si detecta un acceso o uso inusual. Para conocer detalles sobre infraestructura, plazos de conservación o proveedores, contactá al administrador de MF Distribuciones.'],
  ['Solicitudes sobre datos personales', 'Para consultar, corregir o solicitar la actualización o eliminación de datos personales relacionados con el sistema, escribí a desarrollomf.arg@gmail.com e indicá qué dato querés revisar. Es posible que se solicite información para verificar tu identidad y que ciertos registros deban conservarse por motivos operativos o legales.'],
  ['Cambios a esta política', 'La política puede actualizarse cuando cambien las funciones o las prácticas de gestión de datos. La versión vigente estará disponible en esta pantalla.'],
];

export default function PrivacyScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Política de privacidad</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>Información sobre los datos utilizados por la aplicación de MF Distribuciones.</Text>
        {PRIVACY_SECTIONS.map(([heading, body]) => <View key={heading} style={styles.section}>
          <Text style={styles.heading}>{heading}</Text>
          <Text style={styles.body}>{body}</Text>
        </View>)}
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
  intro: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
});
