import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing, typography } from '../../theme';

export interface SelectOption {
  value: string;
  label: string;
  /** Texto secundario opcional (por ejemplo un CUIT o un email). No participa de la búsqueda. */
  subtitle?: string;
}

interface BaseProps {
  options: SelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  error?: boolean;
  /** Alto máximo de la lista desplegada. */
  maxListHeight?: number;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  value: string | null | undefined;
  onChange: (value: string) => void;
}

interface MultiProps extends BaseProps {
  multiple: true;
  values: string[];
  onChangeValues: (values: string[]) => void;
}

export type SelectFieldProps = SingleProps | MultiProps;

// Ignora mayúsculas y tildes para que "cafe" encuentre "Café".
const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\s+/, '');

// Evita renderizar listas enormes de una sola vez.
const MAX_VISIBLE = 200;

/**
 * Desplegable con búsqueda. Al escribir solo se muestran las opciones cuyo texto
 * EMPIEZA con lo escrito (no las que simplemente lo contienen).
 * Se despliega dentro del flujo de la pantalla (sin overlays), así funciona bien
 * dentro de ScrollView y en web.
 */
export function SelectField(props: SelectFieldProps) {
  const {
    options,
    placeholder = 'Seleccionar',
    searchPlaceholder = 'Escribí para buscar...',
    emptyText = 'Sin coincidencias',
    disabled = false,
    error = false,
    maxListHeight = 220,
  } = props;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedValues: string[] = props.multiple
    ? props.values
    : props.value !== null && props.value !== undefined
      ? [props.value]
      : [];

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return options;
    return options.filter(option => normalize(option.label).startsWith(q));
  }, [options, query]);

  const visible = filtered.slice(0, MAX_VISIBLE);

  const selectedOptions = options.filter(option => selectedValues.includes(option.value));
  const displayText = (() => {
    if (!selectedOptions.length) return '';
    if (selectedOptions.length === 1) return selectedOptions[0].label;
    return `${selectedOptions[0].label} +${selectedOptions.length - 1}`;
  })();

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const toggleOpen = () => {
    if (disabled) return;
    if (open) close();
    else setOpen(true);
  };

  const choose = (value: string) => {
    if (props.multiple) {
      props.onChangeValues(
        props.values.includes(value)
          ? props.values.filter(current => current !== value)
          : [...props.values, value],
      );
      return;
    }
    props.onChange(value);
    close();
  };

  return (
    <View>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={toggleOpen}
        disabled={disabled}
        style={[
          styles.field,
          open && styles.fieldOpen,
          error && styles.fieldError,
          disabled && styles.fieldDisabled,
        ]}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled }}
      >
        {open ? (
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            placeholderTextColor={colors.textDisabled}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.searchInput}
          />
        ) : (
          <Text
            numberOfLines={1}
            style={[styles.valueText, !displayText && styles.placeholderText]}
          >
            {displayText || placeholder}
          </Text>
        )}
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {open && (
        <View style={styles.panel}>
          <ScrollView
            style={{ maxHeight: maxListHeight }}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
          >
            {visible.length ? (
              visible.map(option => {
                const selected = selectedValues.includes(option.value);
                return (
                  <TouchableOpacity
                    key={option.value || '__empty__'}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => choose(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                  >
                    <View style={styles.optionTextWrap}>
                      <Text
                        numberOfLines={1}
                        style={[styles.optionText, selected && styles.optionTextSelected]}
                      >
                        {option.label}
                      </Text>
                      {!!option.subtitle && (
                        <Text numberOfLines={1} style={styles.optionSubtitle}>
                          {option.subtitle}
                        </Text>
                      )}
                    </View>
                    {selected && (
                      <Ionicons name="checkmark" size={18} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })
            ) : (
              <Text style={styles.emptyText}>{emptyText}</Text>
            )}
            {filtered.length > MAX_VISIBLE && (
              <Text style={styles.moreHint}>Seguí escribiendo para acotar los resultados.</Text>
            )}
          </ScrollView>
          {props.multiple && (
            <TouchableOpacity style={styles.doneButton} onPress={close}>
              <Text style={styles.doneText}>Listo</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  fieldOpen: { borderColor: colors.borderFocus },
  fieldError: { borderColor: colors.error },
  fieldDisabled: { opacity: 0.5 },
  valueText: { flex: 1, ...typography.body, color: colors.textPrimary },
  placeholderText: { color: colors.textDisabled },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  panel: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  optionSelected: { backgroundColor: colors.primaryLight },
  optionTextWrap: { flex: 1 },
  optionText: { ...typography.body, color: colors.textPrimary },
  optionTextSelected: { color: colors.primary, fontWeight: '700' },
  optionSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  emptyText: {
    ...typography.caption,
    color: colors.textSecondary,
    padding: spacing.md,
    textAlign: 'center',
  },
  moreHint: {
    ...typography.caption,
    color: colors.textSecondary,
    padding: spacing.sm,
    textAlign: 'center',
  },
  doneButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  doneText: { ...typography.label, color: colors.primary },
});
