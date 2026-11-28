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

  // Older socket handlers use named receipts and a shared error channel instead of acknowledgement callbacks.
  function socketRequest(app, event, data, receipt, { accept, refusal, active = () => true, profileText = false }) {
    const socket = app.socket;
    return new Promise(resolve => {
      let profileRefused = false;
      const done = ok => {
        clearTimeout(timer);
        socket?.off(receipt, received);
        socket?.off('error-msg', failed);
        socket?.off('disconnect', unavailable);
        if (profileText) socket?.off('automod-refused', moderated);
        resolve(ok);
      };
      const received = response => { if (accept(response)) done(true); };
      const moderated = notice => { profileRefused = notice?.surface === 'profile'; };
      const failed = message => {
        if (typeof message !== 'string') return;
        const field = refusal(message, profileRefused);
        if (!field) return;
        // A true result denotes an action-wide refusal already announced by the socket toast.
        if (field !== true && active()) invalid(field, message);
        done(false);
      };
      const unavailable = () => {
        if (active()) app._showToast(t('auth.errors.connection_error'), 'error');
        done(false);
      };
      const timer = setTimeout(unavailable, 15000);
      if (!socket?.connected) return unavailable();
      socket.on(receipt, received);
      socket.on('error-msg', failed);
      socket.on('disconnect', unavailable);
      if (profileText) socket.on('automod-refused', moderated);
      socket.emit(event, data);
    });
  }
  return { busy, invalid, clear, socketRequest };
})();
