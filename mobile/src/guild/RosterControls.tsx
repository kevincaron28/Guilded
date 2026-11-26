import { Pressable, Text, TextInput, View } from "react-native";
import { classLabel, roleLabel, t, type CopyKey, type Lang } from "../i18n";
import { ROLES, type RoleFilter } from "../rosterFilter";
import { colors } from "../ui";
import { common } from "../ui/common";

/** A search box, optional class and role chips, and sort chips for a roster list. */
export function RosterControls<S extends string>({ lang, search, onSearch, classes, className, onClass, role, onRole, sorts, sort, onSort }: {
  lang: Lang; search: string; onSearch: (value: string) => void;
  classes?: string[]; className?: string | null; onClass?: (value: string | null) => void;
  role?: RoleFilter | null; onRole?: (value: RoleFilter | null) => void;
  sorts: readonly { value: S; label: CopyKey }[]; sort: S; onSort: (value: S) => void;
}) {
  const chip = (key: string, label: string, on: boolean, press: () => void, spoken: string) =>
    <Pressable key={key} onPress={press} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={spoken} style={[common.chip, on && common.chipOn]}>
      <Text style={[common.chipText, on && common.chipTextOn]}>{label}</Text>
    </Pressable>;
  return <View>
    <TextInput value={search} onChangeText={onSearch} placeholder={t(lang, "searchPlaceholder")} placeholderTextColor={colors.muted} autoCorrect={false} autoCapitalize="none"
      accessibilityLabel={t(lang, "searchPlaceholder")} returnKeyType="search" clearButtonMode="while-editing" style={common.input} />
    {classes && classes.length > 1 && onClass ? <View style={common.chips} accessibilityLabel={t(lang, "filterClass")}>
      {chip("all-classes", t(lang, "filterAll"), !className, () => onClass(null), `${t(lang, "filterClass")}: ${t(lang, "filterAll")}`)}
      {classes.map((value) => chip(value, classLabel(value, lang), className === value, () => onClass(className === value ? null : value), `${t(lang, "filterClass")}: ${classLabel(value, lang)}`))}
    </View> : null}
    {onRole ? <View style={common.chips} accessibilityLabel={t(lang, "filterRole")}>
      {chip("all-roles", t(lang, "filterAll"), !role, () => onRole(null), `${t(lang, "filterRole")}: ${t(lang, "filterAll")}`)}
      {ROLES.map((value) => chip(value, roleLabel(value, lang), role === value, () => onRole(role === value ? null : value), `${t(lang, "filterRole")}: ${roleLabel(value, lang)}`))}
    </View> : null}
    <View style={common.chips} accessibilityLabel={t(lang, "sortBy")}>
      {sorts.map((option) => chip(option.value, t(lang, option.label), sort === option.value, () => onSort(option.value), `${t(lang, "sortBy")}: ${t(lang, option.label)}`))}
    </View>
  </View>;
}
