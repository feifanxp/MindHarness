import { PointerEventHandler, useEffect, useRef, useState } from 'react';

export type Pan = {
  translateX: number;
  translateY: number;
};

const INITIAL_PAN = {
  translateX: 0,
  translateY: 0,
};

export const usePan = (active: boolean) => {
  const [pan, setPan] = useState<Pan>(INITIAL_PAN);
  const [isPanning, setIsPanning] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    if (!active) {
      setPan(INITIAL_PAN);
      setIsPanning(false);
    }
  }, [active]);

  const onPointerDown: PointerEventHandler<HTMLElement> = (evt) => {
    if (evt.pointerType === 'mouse' && evt.button !== 0) return;
    // Track touches even before zooming so lifting one finger after a pinch
    // can continue as a drag without another pointerdown.
    pointers.current.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
    evt.currentTarget.setPointerCapture(evt.pointerId);
    if (evt.pointerType === 'mouse') evt.preventDefault();
    setIsPanning(active && pointers.current.size === 1);
  };

  const onPointerMove: PointerEventHandler<HTMLElement> = (evt) => {
    const previous = pointers.current.get(evt.pointerId);
    if (!previous) return;
    pointers.current.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
    // Keep each finger's position current during a pinch, but leave zooming
    // to useZoom until only one pointer remains.
    if (!active || pointers.current.size !== 1) return;
    const dx = evt.clientX - previous.x;
    const dy = evt.clientY - previous.y;
    setPan((current) => ({
      translateX: current.translateX + dx,
      translateY: current.translateY + dy,
    }));
    setIsPanning(true);
  };

  const onPointerUp: PointerEventHandler<HTMLElement> = (evt) => {
    if (!pointers.current.delete(evt.pointerId)) return;
    setIsPanning(active && pointers.current.size === 1);
  };

  return {
    pan,
    cursor: active ? (isPanning ? 'grabbing' : 'grab') : 'initial',
    isPanning,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onLostPointerCapture: onPointerUp,
  };
};
