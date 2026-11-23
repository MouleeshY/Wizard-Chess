import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface CameraShakeHandle {
  trigger: (intensity?: number, duration?: number) => void;
}

export const CameraShakeRig = forwardRef<CameraShakeHandle>(
  function CameraShakeRig(_, ref) {
    const { camera } = useThree();
    const timeLeftRef = useRef(0);
    const totalDurationRef = useRef(0.34);
    const intensityRef = useRef(0);
    const phaseRef = useRef(0);
    const appliedOffsetRef = useRef(new THREE.Vector3());

    useImperativeHandle(ref, () => ({
      trigger(intensity = 0.065, duration = 0.34) {
        totalDurationRef.current = duration;
        timeLeftRef.current = duration;
        intensityRef.current = intensity;
        phaseRef.current = Math.random() * 10;
      },
    }));

    useEffect(() => {
      return () => {
        camera.position.sub(appliedOffsetRef.current);
        appliedOffsetRef.current.set(0, 0, 0);
      };
    }, [camera]);

    // Priority -2: remove last frame's offset before OrbitControls (-1) runs
    useFrame(({ camera: cam }) => {
      if (appliedOffsetRef.current.lengthSq() > 0) {
        cam.position.sub(appliedOffsetRef.current);
        appliedOffsetRef.current.set(0, 0, 0);
      }
    }, -2);

    // Priority 0: apply decaying impact shake before EffectComposer (1) renders
    useFrame(({ camera: cam }, delta) => {
      if (timeLeftRef.current <= 0) return;

      const dt = Math.min(delta, 0.05);
      timeLeftRef.current = Math.max(0, timeLeftRef.current - dt);

      const dur = totalDurationRef.current;
      const remaining = timeLeftRef.current / dur;
      const decay = remaining * remaining;
      const t = (dur - timeLeftRef.current) * 56 + phaseRef.current;
      const amp = intensityRef.current * decay;

      appliedOffsetRef.current.set(
        Math.sin(t * 1.13) * amp * 0.55,
        Math.cos(t * 1.47) * amp,
        Math.sin(t * 0.91) * amp * 0.55
      );
      cam.position.add(appliedOffsetRef.current);
    }, 0);

    return null;
  }
);
