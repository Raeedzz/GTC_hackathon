'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

export default function useResponseAnimation(optimalPlan) {
  const [animationPhase, setAnimationPhase] = useState(0);
  const timerRef = useRef(null);

  const startAnimation = useCallback(() => {
    if (!optimalPlan) return;
    setAnimationPhase(0);

    // Phase 1: Deployments at 0s
    setTimeout(() => setAnimationPhase(1), 500);
    // Phase 2: Evacuation at 3s
    setTimeout(() => setAnimationPhase(2), 3000);
    // Phase 3: Police + Medical at 6s
    setTimeout(() => setAnimationPhase(3), 6000);
    // Phase 4: Shelters at 9s
    timerRef.current = setTimeout(() => setAnimationPhase(4), 9000);
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
