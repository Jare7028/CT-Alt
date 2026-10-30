'use client';

import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react';

/** A native disclosure menu with outside-click and Escape dismissal. */
export default function Dropdown(props: ComponentPropsWithoutRef<'details'>) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const dismissOutside = (event: Event) => {
      if (menu.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.open && menu.contains(document.activeElement)) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Capture also handles outside controls that stop propagation.
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('click', dismissOutside, true);
    menu.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('click', dismissOutside, true);
      menu.removeEventListener('keydown', dismissEscape);
    };
  }, []);

  return <details {...props} ref={ref} />;
}
