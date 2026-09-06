import type { IncidentCategory, Severity } from '@barleschailey/feed';

/** Dark, high-contrast palette for use in a car at night. */
export const colors = {
  bg: '#0b0c10',
  surface: '#15171e',
  surfaceRaised: '#1d2029',
  border: '#2a2e3a',
  text: '#f2f3f5',
  textMuted: '#9aa0ad',
  textDim: '#6b7280',
  primary: '#e53935',
  primaryText: '#ffffff',
  success: '#2ecc71',
  warning: '#f5a623',
  danger: '#e53935',
  info: '#3b82f6',
} as const;

export const categoryColor: Record<IncidentCategory, string> = {
  fire: '#e53935',
  rescue: '#f5a623',
  ems: '#3b82f6',
  hazmat: '#a855f7',
  service: '#6b7280',
  other: '#6b7280',
};

export const severityColor: Record<Severity, string> = {
  low: '#6b7280',
  normal: '#9aa0ad',
  high: '#f5a623',
  critical: '#e53935',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16 } as const;
export const font = {
  title: { fontSize: 22, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 17, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text },
  caption: { fontSize: 13, color: colors.textMuted },
  mono: { fontFamily: 'Menlo', fontSize: 13, color: colors.textMuted },
};
