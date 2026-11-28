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

  // Habitat fork: the ordinary error listener delivers inline refusals once, in packet order.
  const inlineErrors = new WeakMap();
  function handleInlineError(socket, message, surface) {
    return inlineErrors.get(socket)?.(message, surface) === true;
  }
  function socketRequest(socket, event, data, receipt, { accept = () => true, refuses, inline = false }) {
    if (!socket?.connected) return Promise.resolve({ status: 'offline' });
    return new Promise(resolve => {
      const done = (status, message, general = false) => {
        clearTimeout(timer);
        socket.off(receipt, received);
        if (inline) inlineErrors.delete(socket);
        else socket.off('error-msg', failed);
        socket.off('disconnect', disconnected);
        resolve({ status, message, general });
      };
      const received = response => { if (accept(response)) done('received'); };
      const failed = (message, surface) => {
        // The flood limiter and preview backend use these messages across actions without a request ID.
        const general = !surface && (['Slow down: too many requests', 'Too many requests', 'Could not complete the request'].includes(message)
          || (message === 'Session expired' && event === 'rename-user')
          || (message === 'This feature is not available on this server yet'
            && ['set-banner-color', 'set-profile-theme', 'create-invite-code'].includes(event)));
        if (!general && !refuses(message, surface)) return false;
        done('refused', message, general);
        return true;
      };
      const disconnected = () => done('offline');
      const timer = setTimeout(() => done(socket.connected ? 'unconfirmed' : 'offline'), 8000);
      socket.on(receipt, received);
      if (inline) inlineErrors.set(socket, failed);
      else socket.on('error-msg', failed);
      socket.on('disconnect', disconnected);
      socket.emit(event, data);
    });
  }
  return { busy, invalid, clear, socketRequest, handleInlineError };
})();
