'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export default function useResponseAnimation(optimalPlan) {
  const [animationPhase, setAnimationPhase] = useState(0);
  const timerRef = useRef(null);

  const startAnimation = useCallback(() => {
    if (!optimalPlan) return;
    setAnimationPhase(0);

    // Fast phases — all done in ~4s
    setTimeout(() => setAnimationPhase(1), 200);
    setTimeout(() => setAnimationPhase(2), 1200);
    setTimeout(() => setAnimationPhase(3), 2200);
    timerRef.current = setTimeout(() => setAnimationPhase(4), 3200);
  }, [optimalPlan]);

  const resetAnimation = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAnimationPhase(0);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { animationPhase, startAnimation, resetAnimation };
}
