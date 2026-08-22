import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

interface GlassPanelProps extends PropsWithChildren {
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
}

let liquidGlassAvailable = false;
try {
  liquidGlassAvailable =
    Platform.OS === 'ios' && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
} catch {
  liquidGlassAvailable = false;
}

export function GlassPanel({ children, interactive = false, style }: GlassPanelProps) {
  if (liquidGlassAvailable) {
    return (
      <GlassView
        colorScheme="dark"
        glassEffectStyle="regular"
        isInteractive={interactive}
        style={[styles.panel, style]}
      >
        {children}
      </GlassView>
    );
  }
  return <View style={[styles.panel, styles.fallback, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  panel: {
    borderColor: 'rgba(255,255,255,0.22)',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fallback: {
    backgroundColor: 'rgba(28,31,39,0.88)',
  },
});
