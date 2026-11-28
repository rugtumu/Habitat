// Habitat fork: the auth page and the app share field descriptions and pending controls.
const HabitatForm = (() => {
  const errors = new WeakMap();
  function clear(field) {
    const error = errors.get(field);
    if (!error) return;
    const descriptions = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== error.id);
    if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '));
    else field.removeAttribute('aria-describedby');
    field.removeAttribute('aria-invalid');
    error.remove();
    errors.delete(field);
  }
  function invalid(field, message) {
    clear(field);
    const error = document.createElement('small');
    error.className = 'field-error';
    error.id = field.id + '-error';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    (field.closest('.haven-pw-wrap, label') || field).after(error);
    errors.set(field, error);
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '));
    field.focus();
  }
  document.addEventListener('input', e => {
    clear(e.target);
    const group = e.target.closest?.('[role="group"][aria-invalid="true"]');
    if (group) clear(group);
  });
  const previousDisabled = new WeakMap();
  function busy(button, waiting) {
    if (!button) return;
    if (waiting) {
      if (previousDisabled.has(button)) return;
      previousDisabled.set(button, button.disabled);
      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
    } else if (previousDisabled.has(button)) {
      button.removeAttribute('aria-busy');
      button.disabled = previousDisabled.get(button);
      previousDisabled.delete(button);
    }
  }

  // Habitat fork: these handlers have no request IDs and can stay silent even on a connected socket.
  function socketRequest(socket, event, data, receipt, accept = () => true) {
    if (!socket?.connected) return Promise.resolve({ status: 'offline' });
    return new Promise(resolve => {
      const done = (status, message) => {
        clearTimeout(timer);
        socket.off(receipt, received);
        socket.off('error-msg', failed);
        socket.off('disconnect', disconnected);
        resolve({ status, message });
      };
      const received = response => { if (accept(response)) done('received'); };
      const failed = message => done('refused', message);
      const disconnected = () => done('offline');
      const timer = setTimeout(() => done(socket.connected ? 'unconfirmed' : 'offline'), 2000);
      socket.on(receipt, received);
      socket.on('error-msg', failed);
      socket.on('disconnect', disconnected);
      socket.emit(event, data);
    });
  }
  return { busy, invalid, clear, socketRequest };
})();
