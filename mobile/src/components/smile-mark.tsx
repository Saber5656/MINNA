import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { makeSmileTargets } from '@/lib/smile';

interface SmileMarkProps {
  color: string;
  dotCount: number;
  filledDotCount: number;
  size?: number;
}

export function SmileMark({ color, dotCount, filledDotCount, size = 224 }: SmileMarkProps) {
  const safeCount = Math.max(32, Math.min(500, Math.floor(dotCount || 32)));
  const points = useMemo(() => makeSmileTargets(safeCount), [safeCount]);
  const dotSize = safeCount > 220 ? 3 : safeCount > 100 ? 4 : safeCount > 56 ? 6 : 8;

  return (
    <View
      accessibilityLabel={`ニッコリマーク ${Math.min(filledDotCount, safeCount)} / ${safeCount}ドット`}
      style={[styles.stage, { height: size, width: size }]}
    >
      {points.map((point, index) => {
        const filled = index < filledDotCount;
        return (
          <View
            key={`${point.x}-${point.y}-${index}`}
            style={[
              styles.dot,
              {
                backgroundColor: filled ? color : 'rgba(255,255,255,0.14)',
                height: dotSize,
                left: point.x * size - dotSize / 2,
                opacity: filled ? 1 : 0.75,
                top: point.y * size - dotSize / 2,
                width: dotSize,
              },
              filled && styles.filled,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    position: 'relative',
  },
  dot: {
    borderRadius: 999,
    position: 'absolute',
  },
  filled: {
    shadowColor: '#ffffff',
    shadowOpacity: 0.65,
    shadowRadius: 7,
  },
});
