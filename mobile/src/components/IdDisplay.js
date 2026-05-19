import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import theme from "../theme";
import sharedStyles from "../screens/sharedStyles";
import { shortText } from "../utils/format";

export default function IdDisplay({
  label,
  value,
  copyLabel = "Copy",
  emptyLabel = "Not available",
  start = 14,
  end = 8,
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const text = value === undefined || value === null || value === "" ? "" : String(value);

  const copy = async () => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View style={styles.wrap}>
      {label ? <Text style={sharedStyles.label}>{label}</Text> : null}
      <Pressable onPress={() => text && setExpanded((current) => !current)} accessibilityRole="button">
        <Text style={styles.value}>{text ? (expanded ? text : shortText(text, start, end)) : emptyLabel}</Text>
      </Pressable>
      {text ? (
        <View style={styles.actions}>
          <Pressable style={styles.smallButton} onPress={copy} accessibilityRole="button">
            <Text style={styles.buttonText}>{copied ? "Copied" : copyLabel}</Text>
          </Pressable>
          <Pressable style={styles.smallButton} onPress={() => setExpanded((current) => !current)} accessibilityRole="button">
            <Text style={styles.buttonText}>{expanded ? "Collapse" : "Expand"}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: theme.spacing.sm,
  },
  value: {
    color: theme.text,
    flexShrink: 1,
    fontSize: theme.fonts.small,
    lineHeight: 19,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
  },
  smallButton: {
    backgroundColor: theme.cardSoft,
    borderColor: theme.border,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: theme.spacing.sm,
  },
  buttonText: {
    color: theme.text,
    fontSize: theme.fonts.small,
    fontWeight: "800",
  },
});
