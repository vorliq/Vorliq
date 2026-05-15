import { StyleSheet } from "react-native";
import theme from "../theme";

const sharedStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    padding: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: theme.spacing.lg,
  },
  title: {
    color: theme.text,
    fontSize: theme.fonts.title,
    fontWeight: "800",
  },
  subtitle: {
    color: theme.textSecondary,
    fontSize: theme.fonts.body,
    lineHeight: 24,
    marginTop: theme.spacing.sm,
  },
  card: {
    backgroundColor: theme.card,
    borderColor: theme.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: theme.spacing.md,
    padding: theme.spacing.md,
  },
  label: {
    color: theme.textSecondary,
    fontSize: theme.fonts.small,
    fontWeight: "700",
    marginBottom: theme.spacing.xs,
    textTransform: "uppercase",
  },
  value: {
    color: theme.text,
    fontSize: theme.fonts.body,
    flexShrink: 1,
    lineHeight: 24,
  },
  input: {
    backgroundColor: "#111122",
    borderColor: theme.border,
    borderRadius: 12,
    borderWidth: 1,
    color: theme.text,
    fontSize: theme.fonts.body,
    minHeight: 50,
    marginBottom: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
  },
  textArea: {
    minHeight: 110,
    paddingTop: theme.spacing.md,
    textAlignVertical: "top",
  },
  button: {
    alignItems: "center",
    backgroundColor: theme.accent,
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  secondaryButton: {
    backgroundColor: "transparent",
    borderColor: theme.border,
    borderWidth: 1,
  },
  dangerButton: {
    backgroundColor: theme.error,
  },
  buttonText: {
    color: theme.text,
    fontSize: theme.fonts.body,
    fontWeight: "800",
  },
  errorText: {
    color: theme.error,
    fontSize: theme.fonts.body,
    lineHeight: 24,
  },
  successText: {
    color: theme.success,
    fontSize: theme.fonts.body,
    lineHeight: 24,
  },
  warningText: {
    color: theme.warning,
    fontSize: theme.fonts.body,
    lineHeight: 24,
  },
  mutedText: {
    color: theme.textSecondary,
    fontSize: theme.fonts.body,
    lineHeight: 24,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  badgeText: {
    color: theme.text,
    fontSize: theme.fonts.small,
    fontWeight: "800",
    textTransform: "uppercase",
  },
});

export default sharedStyles;
