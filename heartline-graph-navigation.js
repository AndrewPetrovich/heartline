export function enableGraphNavigation(viewport, svg, { min = .1, max = 3, initial = .82, onZoom = null, onClear = null } = {}) {
  let zoom = initial, panX = 0, panY = 0, dragging = false, dragPointer = null, lastX = 0, lastY = 0, spaceDown = false, pinchStart = null;
  const pointers = new Map();
  const apply = () => { svg.style.transformOrigin = '0 0'; svg.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`; onZoom?.(zoom); };
  const setZoom = (next, cursor = null) => {
    const previous = zoom; zoom = Math.max(min, Math.min(max, next));
    if (cursor && previous > 0) { const rect = viewport.getBoundingClientRect(); const cx = cursor.clientX - rect.left, cy = cursor.clientY - rect.top; panX = cx - (cx - panX) * zoom / previous; panY = cy - (cy - panY) * zoom / previous; }
    apply();
  };
  const fit = () => {
    const width = Number(svg.getAttribute('width')) || 1, height = Number(svg.getAttribute('height')) || 1, pad = 34;
    zoom = Math.max(min, Math.min(max, Math.min((viewport.clientWidth - pad * 2) / width, (viewport.clientHeight - pad * 2) / height, 1)));
    panX = Math.max(pad, (viewport.clientWidth - width * zoom) / 2); panY = Math.max(pad, (viewport.clientHeight - height * zoom) / 2); apply();
  };
  const focusNode = nodeId => {
    const escaped = window.CSS?.escape ? CSS.escape(nodeId) : nodeId.replace(/"/g, '\\"');
    const node = svg.querySelector(`[data-node-id="${escaped}"]`); if (!node) return false;
    const x = Number(node.dataset.x || 0), y = Number(node.dataset.y || 0), w = Number(node.dataset.w || 180), h = Number(node.dataset.h || 70);
    zoom = Math.max(min, Math.min(max, Math.max(zoom, .9))); panX = viewport.clientWidth / 2 - (x + w / 2) * zoom; panY = viewport.clientHeight / 2 - (y + h / 2) * zoom; apply(); return true;
  };
  const wheel = event => { event.preventDefault(); setZoom(zoom * (event.deltaY > 0 ? .9 : 1.1), event); };
  viewport.addEventListener('wheel', wheel, { passive: false });
  viewport.addEventListener('pointerdown', event => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) { const values = [...pointers.values()]; pinchStart = { distance: Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y), zoom }; return; }
    const canPan = event.button === 1 || (event.button === 0 && spaceDown) || event.pointerType === 'touch'; if (!canPan) return;
    event.preventDefault(); dragging = true; dragPointer = event.pointerId; lastX = event.clientX; lastY = event.clientY; viewport.setPointerCapture?.(event.pointerId); viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', event => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && pinchStart) { const values = [...pointers.values()]; const distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y); setZoom(pinchStart.zoom * distance / Math.max(1, pinchStart.distance), { clientX: (values[0].x + values[1].x) / 2, clientY: (values[0].y + values[1].y) / 2 }); return; }
    if (!dragging || dragPointer !== event.pointerId) return; panX += event.clientX - lastX; panY += event.clientY - lastY; lastX = event.clientX; lastY = event.clientY; apply();
  });
  const stop = event => { pointers.delete(event.pointerId); if (pointers.size < 2) pinchStart = null; if (dragPointer !== event.pointerId) return; dragging = false; dragPointer = null; viewport.classList.remove('dragging'); try { viewport.releasePointerCapture?.(event.pointerId); } catch (_) {} };
  viewport.addEventListener('pointerup', stop); viewport.addEventListener('pointercancel', stop);
  const keydown = event => { if (event.code === 'Space') { spaceDown = true; viewport.classList.add('space-pan'); event.preventDefault(); } if (event.key.toLowerCase() === 'f') { event.preventDefault(); fit(); } if (event.key === '0') { event.preventDefault(); setZoom(1); } if (event.key === 'Escape') onClear?.(); };
  const keyup = event => { if (event.code === 'Space') { spaceDown = false; viewport.classList.remove('space-pan'); } };
  viewport.addEventListener('keydown', keydown); viewport.addEventListener('keyup', keyup); viewport.addEventListener('blur', () => { spaceDown = false; viewport.classList.remove('space-pan'); });
  apply(); requestAnimationFrame(fit);
  return { zoomIn: () => setZoom(zoom * 1.15), zoomOut: () => setZoom(zoom / 1.15), reset: () => setZoom(1), fit, focusNode, currentZoom: () => zoom, destroy: () => { viewport.removeEventListener('wheel', wheel); viewport.removeEventListener('keydown', keydown); viewport.removeEventListener('keyup', keyup); } };
}
