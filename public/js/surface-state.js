// Habitat fork: announce the status line without announcing every interactive row.
const HabitatSurface = (() => {
  function line(key, retry, values) {
    const node = document.createElement('div');
    node.className = 'surface-state';
    node.setAttribute('role', retry ? 'alert' : 'status');
    node.textContent = t(key, values);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-sm';
      button.textContent = t('history.retry');
      button.addEventListener('click', event => {
        // A retry may replace the button before an outside-click listener sees it.
        event.stopPropagation();
        retry();
      });
      node.appendChild(button);
    }
    return node;
  }

  // These socket reads send a separate event, without an acknowledgement or request ID.
  // Replacing the pending line on success, navigation or retry invalidates its deadline.
  function wait(host, errorKey, retry, socket) {
    if (!host) return;
    const pending = line('thread_list.loading');
    pending.dataset.surface = 'loading';
    host.replaceChildren(pending);
    const fail = () => {
      if (pending.parentElement !== host) return;
      const error = line(errorKey, retry);
      error.dataset.surface = 'failed';
      host.replaceChildren(error);
    };
    if (socket?.connected === false) fail();
    else setTimeout(fail, 10000);
  }
  return { line, wait };
})();
